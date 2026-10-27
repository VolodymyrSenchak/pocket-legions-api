import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpHarness, TestPlayer } from "../testing/harness";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("sessions over HTTP", () => {
  let h: ReturnType<typeof createHttpHarness>;

  beforeEach(() => {
    h = createHttpHarness();
  });

  it("creates a session and exposes public info without secrets", async () => {
    const res = await h.api.create({ nickname: " Alice ", password: "secret" });
    expect(res.status).toBe(201);
    const { session, playerId, playerToken } = res.body;
    expect(session.code).toMatch(/^[0-9]{6}$/);
    expect(playerToken).toEqual(expect.any(String));
    expect(session).toMatchObject({ status: "pending", version: 1, hostPlayerId: playerId, game: null, poll: { intervalMs: 3000 } });
    expect(session.me).toEqual({ playerId, nickname: "Alice", isHost: true });
    expect(session.settings).toEqual({ step: 1, maxPlayers: 20, allowJoinInProgress: true });
    const json = JSON.stringify(res.body.session);
    expect(json).not.toContain("tokenHash");
    expect(json).not.toContain("scrypt");

    const info = await h.api.info(session.code);
    expect(info.status).toBe(200);
    expect(info.body).toEqual({
      code: session.code,
      status: "pending",
      requiresPassword: true,
      playerCount: 1,
      maxPlayers: 20,
      joinable: true,
      expiresAt: session.expiresAt,
    });
  });

  it("rejects invalid requests with the error envelope", async () => {
    const bad = await h.api.create({ nickname: "" });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: { code: "bad-request", message: expect.any(String) } });
    expect((await h.api.create({ nickname: "x".repeat(21) })).status).toBe(400);
    expect((await h.api.create({ nickname: "Al", settings: { step: 0 } })).status).toBe(400);
    expect((await h.api.create({ nickname: "Al", settings: { maxPlayers: 1 } })).status).toBe(400);
    expect((await h.api.create({ nickname: "Al", password: "p".repeat(65) })).status).toBe(400);
    const malformed = await request(h.runtime.app).post("/api/sessions").set("Content-Type", "application/json").send("{bad");
    expect(malformed.status).toBe(400);
    expect((await h.api.info("12ab")).status).toBe(404);

    const host = await h.api.createPlayer("Host");
    const noToken = await request(h.runtime.app).get(`/api/sessions/${host.code}/state`);
    expect(noToken.status).toBe(401);
    expect((await h.api.state({ ...host, playerToken: "bogus" })).body.error.code).toBe("unauthorized");
    expect((await h.api.action(host, "lobby.dance")).status).toBe(400);
    expect((await h.api.action(host, "lobby.toString")).status).toBe(400);
    expect((await h.api.action(host, "nonsense")).status).toBe(400);
    expect((await h.api.action(host, "test-game.increment")).status).toBe(409);
    expect((await h.api.action(host, "lobby.start")).body.error.message).toMatch(/At least 2 players/);
  });

  it("joins by code and password", async () => {
    const host = await h.api.createPlayer("Host", { password: "pw" });
    expect((await h.api.join(host.code, { nickname: "Bob" })).status).toBe(401);
    expect((await h.api.join(host.code, { nickname: "Bob", password: "nope" })).status).toBe(401);
    expect((await h.api.join("999999", { nickname: "Bob" })).status).toBe(404);

    const bob = await h.api.joinPlayer(host.code, "Bob", { password: "pw" });
    const view = await h.api.view(bob);
    expect(view.me).toEqual({ playerId: bob.playerId, nickname: "Bob", isHost: false });
    expect(view.players.map((player) => [player.nickname, player.isHost, player.isOnline])).toEqual([
      ["Host", true, true],
      ["Bob", false, true],
    ]);
    expect(view.version).toBe(2);
  });

  it("rejects the nickname of an online player and replaces a stale one", async () => {
    const host = await h.api.createPlayer("Host");
    const bob = await h.api.joinPlayer(host.code, "Bob");
    const taken = await h.api.join(host.code, { nickname: "BOB" });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("nickname-taken");

    h.advance(31_000);
    const newBob = await h.api.joinPlayer(host.code, "bob");
    const old = await h.api.state(bob);
    expect(old.status).toBe(403);
    expect(old.body.error.code).toBe("left");
    expect((await h.api.view(newBob)).players.map((player) => player.nickname)).toEqual(["Host", "bob"]);
  });

  it("keeps the session alive when the only (stale) player is replaced", async () => {
    const host = await h.api.createPlayer("Host");
    h.advance(31_000);
    const again = await h.api.joinPlayer(host.code, "host");
    const view = await h.api.view(again);
    expect(view.status).toBe("pending");
    expect(view.me.isHost).toBe(true);
    expect(view.players).toHaveLength(1);
  });

  it("lets players join a game in progress", async () => {
    const host = await h.api.createPlayer("Host");
    await h.api.joinPlayer(host.code, "Bob");
    await h.api.joinPlayer(host.code, "Cat");
    const started = await h.api.act(host, "lobby.start");
    expect(started.status).toBe("in_progress");
    expect(started.poll.intervalMs).toBe(1500);

    const dan = await h.api.joinPlayer(host.code, "Dan");
    const view = await h.api.view(dan);
    expect(view.status).toBe("in_progress");
    expect((view.game as any).joined).toContain(dan.playerId);
    expect((await h.api.info(host.code)).body).toMatchObject({ playerCount: 4, joinable: true });
  });

  it("rejects joins when the session is full", async () => {
    const host = await h.api.createPlayer("Host", { settings: { maxPlayers: 3 } });
    await h.api.joinPlayer(host.code, "Bob");
    await h.api.joinPlayer(host.code, "Cat");
    const full = await h.api.join(host.code, { nickname: "Dan" });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe("session-full");
    expect((await h.api.info(host.code)).body.joinable).toBe(false);
  });

  it("expires 24 hours after creation", async () => {
    const host = await h.api.createPlayer("Host");
    const bob = await h.api.joinPlayer(host.code, "Bob");
    h.advance(DAY_MS + 1000);

    expect((await h.api.join(host.code, { nickname: "Late" })).status).toBe(410);
    expect((await h.api.state(bob)).status).toBe(410);
    expect((await h.api.action(host, "lobby.kick", { playerId: bob.playerId })).status).toBe(410);
    expect((await h.api.history(bob)).status).toBe(410);
    const info = await h.api.info(host.code);
    expect(info.status).toBe(200);
    expect(info.body.joinable).toBe(false);
  });

  it("reuses a code only after its session expired", async () => {
    const sameCode = () => "004213";
    const row = {
      status: "pending" as const,
      passwordHash: null,
      hostPlayerId: "host",
      state: { players: [], settings: { maxPlayers: 20, allowJoinInProgress: true }, game: null },
      presence: {},
    };
    const first = await h.repository.insertWithUniqueCode(row, sameCode, h.clock());
    expect(first.result!.code).toBe("004213");
    expect(await h.repository.insertWithUniqueCode(row, sameCode, h.clock())).toMatchObject({ errorStatus: "conflict" });

    h.advance(DAY_MS + 1000);
    const second = await h.repository.insertWithUniqueCode(row, sameCode, h.clock());
    expect(second.isSuccess).toBe(true);
    expect(h.repository.getAll().map((saved) => [saved.id === first.result!.id, saved.archived])).toEqual([
      [true, true],
      [false, false],
    ]);
  });

  it("kicks a player", async () => {
    const host = await h.api.createPlayer("Host");
    const bob = await h.api.joinPlayer(host.code, "Bob");
    const cat = await h.api.joinPlayer(host.code, "Cat");

    expect((await h.api.action(bob, "lobby.kick", { playerId: cat.playerId })).status).toBe(403);
    expect((await h.api.action(host, "lobby.kick", { playerId: host.playerId })).status).toBe(400);
    expect((await h.api.action(host, "lobby.kick", { playerId: "nobody" })).status).toBe(404);

    const view = await h.api.act(host, "lobby.kick", { playerId: cat.playerId });
    expect(view.players.map((player) => player.nickname)).toEqual(["Host", "Bob"]);
    const kicked = await h.api.state(cat);
    expect(kicked.status).toBe(403);
    expect(kicked.body.error.code).toBe("kicked");
    expect((await h.api.action(cat, "lobby.leave")).body.error.code).toBe("kicked");
  });

  it("transfers the host when the host leaves, and on request", async () => {
    const host = await h.api.createPlayer("Host");
    const bob = await h.api.joinPlayer(host.code, "Bob");
    const cat = await h.api.joinPlayer(host.code, "Cat");

    await h.api.act(host, "lobby.leave");
    expect((await h.api.view(bob)).hostPlayerId).toBe(bob.playerId);
    expect((await h.api.state(host)).body.error.code).toBe("left");

    expect((await h.api.action(cat, "lobby.transferHost", { playerId: cat.playerId })).status).toBe(403);
    await h.api.act(bob, "lobby.transferHost", { playerId: cat.playerId });
    expect((await h.api.view(cat)).me.isHost).toBe(true);
  });

  it("finishes the session when the last player leaves", async () => {
    const host = await h.api.createPlayer("Host");
    const view = await h.api.act(host, "lobby.leave");
    expect(view.status).toBe("finished");
    expect((await h.api.info(host.code)).body).toMatchObject({ status: "finished", joinable: false });
    expect((await h.api.join(host.code, { nickname: "Bob" })).body.error.code).toBe("session-finished");
  });

  it("ends a game in progress (host only)", async () => {
    const host = await h.api.createPlayer("Host");
    const bob = await h.api.joinPlayer(host.code, "Bob");
    await h.api.joinPlayer(host.code, "Cat");
    expect((await h.api.action(host, "lobby.end")).status).toBe(409);
    await h.api.act(host, "lobby.start");
    expect((await h.api.action(bob, "lobby.end")).status).toBe(403);
    const ended = await h.api.act(host, "lobby.end");
    expect(ended.status).toBe("finished");
    expect(ended.game).not.toBeNull();
    expect((await h.api.action(host, "test-game.increment")).status).toBe(409);
  });

  it("keeps all players when 10 join concurrently despite write conflicts", async () => {
    const host = await h.api.createPlayer("Host");
    h.repository.forceConflicts(3);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => h.api.join(host.code, { nickname: `Player${i}` }))
    );
    expect(results.map((res) => res.status)).toEqual(Array(10).fill(200));
    const view = await h.api.view(host);
    expect(view.players).toHaveLength(11);
    expect(view.version).toBe(11);
  });

  it("returns 409 when the compare-and-swap keeps losing", async () => {
    const quick = createHttpHarness({ retryDelayMs: () => 0 });
    const host = await quick.api.createPlayer("Host");
    quick.repository.forceConflicts(10);
    const res = await quick.api.join(host.code, { nickname: "Unlucky" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("conflict");
  });

  describe("polling fallback", () => {
    let host: TestPlayer;
    let bob: TestPlayer;

    beforeEach(async () => {
      host = await h.api.createPlayer("Host");
      bob = await h.api.joinPlayer(host.code, "Bob");
    });

    it("answers 304 while nothing changed and 200 with a new ETag after a change", async () => {
      const first = await h.api.state(bob);
      expect(first.status).toBe(200);
      expect(first.headers["cache-control"]).toBe("private, no-cache");
      const etag = first.headers.etag;
      expect(etag).toBeTruthy();

      expect((await h.api.state(bob, etag)).status).toBe(304);

      await h.api.act(host, "lobby.transferHost", { playerId: bob.playerId });
      const changed = await h.api.state(bob, etag);
      expect(changed.status).toBe(200);
      expect(changed.headers.etag).not.toBe(etag);
      expect(changed.body.me.isHost).toBe(true);
    });

    it("refreshes the caller's presence at most once per 10 s", async () => {
      const setPresence = vi.spyOn(h.repository, "setPresence");
      await h.api.view(bob);
      expect(setPresence).toHaveBeenCalledTimes(0);
      h.advance(11_000);
      await h.api.view(bob);
      expect(setPresence).toHaveBeenCalledTimes(1);
      h.advance(5_000);
      await h.api.view(bob);
      expect(setPresence).toHaveBeenCalledTimes(1);
      h.advance(6_000);
      await h.api.view(bob);
      expect(setPresence).toHaveBeenCalledTimes(2);
    });

    it("shows a returning player online again and announces it", async () => {
      h.advance(40_000);
      const hostView = await h.api.view(host);
      expect(hostView.players.find((player) => player.id === bob.playerId)!.isOnline).toBe(false);

      const published = h.hub.published.length;
      await h.api.view(bob);
      expect(h.hub.published.slice(published).map((entry) => entry.message.reason)).toEqual(["presence"]);
      const after = await h.api.view(host);
      expect(after.players.find((player) => player.id === bob.playerId)!.isOnline).toBe(true);
    });
  });
});
