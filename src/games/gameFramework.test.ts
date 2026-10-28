import { beforeEach, describe, expect, it } from "vitest";
import { createHttpHarness } from "../testing/harness";
import { TestGameView } from "../testing/testGame";

describe("game module framework", () => {
  let h: ReturnType<typeof createHttpHarness>;

  beforeEach(() => {
    h = createHttpHarness();
  });

  it("starts the game and routes namespaced actions to it", async () => {
    const host = await h.api.createPlayer("Host", { settings: { step: 2 } });
    const bob = await h.api.joinPlayer(host.code, "Bob");
    expect((await h.api.action(bob, "test-game.increment")).status).toBe(409);
    expect((await h.api.action(bob, "lobby.start")).status).toBe(403);

    let view = await h.api.act(host, "lobby.start");
    expect(view.status).toBe("in_progress");
    expect(view.settings).toEqual({ step: 2, maxPlayers: 20, allowJoinInProgress: true });
    expect(view.game).toEqual({ counter: 0, joined: [], removed: [], mySecret: null });

    view = await h.api.act(bob, "test-game.increment");
    expect((view.game as TestGameView).counter).toBe(2);
    view = await h.api.act(bob, "test-game.increment", { by: 5 });
    expect((view.game as TestGameView).counter).toBe(7);

    expect((await h.api.action(bob, "skirmora.act")).status).toBe(400);
    expect((await h.api.action(bob, "test-game.constructor")).status).toBe(400);
    expect((await h.api.action(bob, "test-game.increment", { by: "x" })).status).toBe(400);

    await h.api.act(bob, "test-game.whisper", { text: "psst" });
    expect(((await h.api.view(bob)).game as TestGameView).mySecret).toBe("psst");
    expect(((await h.api.view(host)).game as TestGameView).mySecret).toBeNull();

    const cat = await h.api.joinPlayer(host.code, "Cat");
    expect(((await h.api.view(host)).game as TestGameView).joined).toEqual([cat.playerId]);
    await h.api.act(host, "lobby.kick", { playerId: cat.playerId });
    expect(((await h.api.view(host)).game as TestGameView).removed).toEqual([cat.playerId]);

    const history = await h.api.history(bob);
    expect(history.body).toEqual(["counter=7"]);

    view = await h.api.act(host, "test-game.finish");
    expect(view.status).toBe("finished");
    expect(view.poll.intervalMs).toBe(10000);
    expect((await h.api.action(host, "test-game.increment")).status).toBe(409);
  });

  it("returns an empty history before the game starts", async () => {
    const host = await h.api.createPlayer("Host");
    expect((await h.api.history(host)).body).toEqual([]);
  });
});
