import { afterEach, describe, expect, it } from "vitest";
import { SessionView } from "../models";
import { Cluster, createCluster, GRACE_MS } from "../testing/cluster";
import { sleep, waitFor } from "../testing/harness";
import { TestGameView } from "../testing/testGame";

const gameOf = (view: SessionView) => view.game as TestGameView | null;

describe("realtime layer (two instances)", () => {
  let cluster: Cluster;

  afterEach(async () => {
    await cluster?.close();
  });

  it("keeps each player's secret off the other players' sockets, across instances", async () => {
    cluster = await createCluster();
    const { a, b } = cluster;
    const players = await cluster.lobby(["Ann", "Ben", "Cid"]);
    const clients = [
      await cluster.connect(a, players[0]),
      await cluster.connect(b, players[1]),
      await cluster.connect(a, players[2]),
    ];

    const started = await clients[0].action("lobby.start");
    if (!started.ok) throw new Error(started.error.message);
    await Promise.all(clients.map((client) => client.waitForState((view) => view.status === "in_progress")));

    const secrets = clients.map((client) => `secret-of-${client.player.nickname}`);
    const acks = await Promise.all(clients.map((client, i) => client.action("test-game.whisper", { text: secrets[i] })));
    expect(acks.every((ack) => ack.ok)).toBe(true);
    const counted = await clients[1].action("test-game.increment");
    expect(counted.ok).toBe(true);

    for (const [i, client] of clients.entries()) {
      const view = await client.waitForState((state) => gameOf(state)?.counter === 1, "counter");
      expect(gameOf(view)!.mySecret).toBe(secrets[i]);
      const traffic = JSON.stringify(client.events);
      secrets.filter((_, j) => j !== i).forEach((secret) => expect(traffic).not.toContain(secret));
    }
  });

  it("delivers an action sent through instance A to clients on instance B", async () => {
    cluster = await createCluster();
    const [ann, ben] = await cluster.lobby(["Ann", "Ben"]);
    const annClient = await cluster.connect(cluster.a, ann);
    const benClient = await cluster.connect(cluster.b, ben);

    const ack = await annClient.action("lobby.transferHost", { playerId: ben.playerId });
    if (!ack.ok) throw new Error(ack.error.message);
    const view = await benClient.waitForState((state) => state.version === ack.session.version);
    expect(view.me.isHost).toBe(true);
  });

  it("recovers a dropped relay message with the safety-net tick", async () => {
    cluster = await createCluster();
    const [ann, ben] = await cluster.lobby(["Ann", "Ben"]);
    const annClient = await cluster.connect(cluster.a, ann);
    const benClient = await cluster.connect(cluster.b, ben);
    const before = benClient.latest.version;

    cluster.hub.dropNextMessages(1);
    const ack = await annClient.action("lobby.transferHost", { playerId: ben.playerId });
    if (!ack.ok) throw new Error(ack.error.message);
    await sleep(150);
    expect(benClient.latest.version).toBe(before);

    await cluster.b.handle.tick.runOnce();
    await benClient.waitForState((state) => state.version === ack.session.version && state.me.isHost);
  });

  it("disconnects a player kicked on instance A from instance B", async () => {
    cluster = await createCluster();
    const [ann, ben, cid] = await cluster.lobby(["Ann", "Ben", "Cid"]);
    const annClient = await cluster.connect(cluster.a, ann);
    const benClient = await cluster.connect(cluster.b, ben);
    const cidClient = await cluster.connect(cluster.b, cid);

    const ack = await annClient.action("lobby.kick", { playerId: cid.playerId });
    expect(ack.ok).toBe(true);
    await waitFor(() => cidClient.hasEvent("player:removed"), "player:removed");
    expect(cidClient.events.find((entry) => entry.event === "player:removed")!.payload).toEqual({ reason: "kicked" });
    await waitFor(() => !cidClient.socket.connected, "kicked socket closed");
    await benClient.waitForState((state) => state.players.length === 2);
    expect(benClient.socket.connected).toBe(true);

    await expect(cluster.client(cluster.a, cid).connect()).rejects.toMatchObject({ data: { code: "kicked" } });
  });

  it("refuses sockets with bad credentials", async () => {
    cluster = await createCluster();
    const [ann] = await cluster.lobby(["Ann"]);
    await expect(cluster.client(cluster.a, { ...ann, playerToken: "nope" }).connect()).rejects.toMatchObject({
      data: { code: "unauthorized" },
    });
    await expect(cluster.client(cluster.a, { ...ann, code: "abcdef" }).connect()).rejects.toMatchObject({
      data: { code: "not-found" },
    });
  });

  it("hides a quick reconnect to the other instance and announces a real disconnect", async () => {
    cluster = await createCluster();
    const [ann, ben] = await cluster.lobby(["Ann", "Ben"]);
    const annClient = await cluster.connect(cluster.a, ann);
    const benClient = await cluster.connect(cluster.b, ben);
    const presenceMessages = () => cluster.hub.published.filter((entry) => entry.message.reason === "presence").length;
    const before = presenceMessages();

    benClient.socket.disconnect();
    const benAgain = await cluster.connect(cluster.a, ben);
    await sleep(GRACE_MS * 3);
    expect(presenceMessages()).toBe(before);
    expect(benAgain.latest.players.every((player) => player.isOnline)).toBe(true);

    benAgain.socket.disconnect();
    await waitFor(() => presenceMessages() === before + 1, "presence publish");
    await annClient.waitForState(
      (state) => state.players.find((player) => player.id === ben.playerId)?.isOnline === false,
      "Ben offline"
    );
  });

  it("answers actions through the ack and rejects oversized payloads", async () => {
    cluster = await createCluster();
    const [ann] = await cluster.lobby(["Ann"]);
    const annClient = await cluster.connect(cluster.a, ann);

    const rejected = await annClient.action("lobby.start");
    expect(rejected).toMatchObject({ ok: false, error: { code: "conflict" } });
    const invalid = await annClient.action("lobby.kick", {});
    expect(invalid).toMatchObject({ ok: false, error: { code: "bad-request" } });
    const huge = await annClient.action("lobby.kick", { playerId: "x".repeat(40 * 1024) });
    expect(huge).toMatchObject({ ok: false, error: { code: "bad-request", message: "Action payload is too large" } });
  });

  it("expires sessions: session:expired, disconnect, and refused reconnects", async () => {
    cluster = await createCluster();
    const [ann, ben] = await cluster.lobby(["Ann", "Ben"]);
    const annClient = await cluster.connect(cluster.a, ann);
    const benClient = await cluster.connect(cluster.a, ben);

    cluster.setClockOffset(24 * 60 * 60 * 1000 + 60_000);
    await cluster.a.handle.tick.runOnce();
    await waitFor(() => annClient.hasEvent("session:expired") && benClient.hasEvent("session:expired"), "session:expired");
    await waitFor(() => !annClient.socket.connected && !benClient.socket.connected, "disconnect");
    await expect(cluster.client(cluster.a, ann).connect()).rejects.toMatchObject({ data: { code: "gone" } });
  });

  it("disconnects idle sessions with session:idle", async () => {
    cluster = await createCluster();
    const [ann] = await cluster.lobby(["Ann"]);
    const annClient = await cluster.connect(cluster.b, ann);

    cluster.setClockOffset(21 * 60_000);
    await cluster.b.handle.tick.runOnce();
    await waitFor(() => annClient.hasEvent("session:idle"), "session:idle");
    await waitFor(() => !annClient.socket.connected, "disconnect");
  });
});
