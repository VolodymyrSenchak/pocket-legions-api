import http from "node:http";
import { AddressInfo } from "node:net";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { SessionView } from "../models";
import { createRuntime, Runtime } from "../runtime";
import { InMemorySessionRepository } from "../services/sessionRepository.memory";
import { ApiClient, sleep, TestPlayer, waitFor } from "../testing/harness";
import { TestGameView, testGameModule } from "../testing/testGame";
import { createSeededRng } from "../utils/random";
import { InMemoryBus, InMemoryBusHub } from "./sessionBus";
import { RealtimeHandle } from "./socketServer";
import { ActionAck } from "./socketTypes";

const GRACE_MS = 150;
const gameOf = (view: SessionView) => view.game as TestGameView | null;

interface Instance {
  runtime: Runtime;
  handle: RealtimeHandle;
  url: string;
}

class TestClient {
  readonly socket: ClientSocket;
  readonly states: SessionView[] = [];
  readonly events: { event: string; payload: unknown }[] = [];

  constructor(url: string, readonly player: TestPlayer) {
    this.socket = ioClient(url, {
      path: "/socket.io",
      transports: ["websocket"],
      auth: { code: player.code, playerToken: player.playerToken },
      reconnection: false,
      forceNew: true,
      autoConnect: false,
    });
    this.socket.onAny((event: string, payload: unknown) => {
      this.events.push({ event, payload });
      if (event === "session:state") {
        this.states.push(payload as SessionView);
      }
    });
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once("connect", () => resolve());
      this.socket.once("connect_error", reject);
      this.socket.connect();
    });
  }

  get latest(): SessionView {
    return this.states[this.states.length - 1];
  }

  async action(type: string, payload?: unknown): Promise<ActionAck> {
    const ack: ActionAck = await this.socket.timeout(5000).emitWithAck("action", { type, payload });
    this.events.push({ event: "ack", payload: ack });
    return ack;
  }

  async waitForState(predicate: (view: SessionView) => boolean, label = "state"): Promise<SessionView> {
    await waitFor(() => this.states.some(predicate), `${this.player.nickname}: ${label}`);
    return [...this.states].reverse().find(predicate)!;
  }

  hasEvent(event: string): boolean {
    return this.events.some((entry) => entry.event === event);
  }
}

/** Two "instances" in one process sharing a repository and a bus hub. */
async function createCluster() {
  let offsetMs = 0;
  const clock = () => new Date(Date.now() + offsetMs);
  const repository = new InMemorySessionRepository({ clock });
  const hub = new InMemoryBusHub();
  let seed = 1;

  const startInstance = async (): Promise<Instance> => {
    const runtime = createRuntime({
      repository,
      bus: new InMemoryBus(hub),
      module: testGameModule,
      clock,
      rng: createSeededRng(seed++),
      http: { rateLimits: false },
      realtime: { startTimers: false, graceMs: GRACE_MS },
    });
    const server = http.createServer(runtime.app);
    const handle = runtime.attachRealtime(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { runtime, handle, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  };

  const a = await startInstance();
  const b = await startInstance();
  const clients: TestClient[] = [];

  return {
    a,
    b,
    hub,
    api: new ApiClient(a.runtime.app),
    setClockOffset: (ms: number) => {
      offsetMs = ms;
    },
    client(instance: Instance, player: TestPlayer) {
      const client = new TestClient(instance.url, player);
      clients.push(client);
      return client;
    },
    async connect(instance: Instance, player: TestPlayer) {
      const client = this.client(instance, player);
      await client.connect();
      await client.waitForState(() => true, "initial snapshot");
      return client;
    },
    async lobby(names: string[]) {
      const host = await this.api.createPlayer(names[0]);
      const others = [];
      for (const name of names.slice(1)) {
        others.push(await this.api.joinPlayer(host.code, name));
      }
      return [host, ...others];
    },
    async close() {
      clients.forEach((client) => client.socket.disconnect());
      await Promise.all([a.handle.close(), b.handle.close()]);
    },
  };
}

type Cluster = Awaited<ReturnType<typeof createCluster>>;

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
