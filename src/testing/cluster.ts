import http from "node:http";
import { AddressInfo } from "node:net";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import type { AnyGameModule } from "../games/gameModule";
import { SessionView } from "../models";
import { RealtimeHandle } from "../realtime/socketServer";
import { InMemoryBus, InMemoryBusHub } from "../realtime/sessionBus";
import { ActionAck } from "../realtime/socketTypes";
import { createRuntime, Runtime } from "../runtime";
import { InMemorySessionRepository } from "../services/sessionRepository.memory";
import { createSeededRng } from "../utils/random";
import { ApiClient, TestPlayer, waitFor } from "./harness";
import { testGameModule } from "./testGame";

/** Two Socket.IO "instances" in one process sharing a repository and a bus hub (moved from realtime.integration.test.ts). */
export const GRACE_MS = 150;
export interface Instance {
  runtime: Runtime;
  handle: RealtimeHandle;
  url: string;
}

export class TestClient {
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
export async function createCluster(options: { module?: AnyGameModule } = {}) {
  let offsetMs = 0;
  const clock = () => new Date(Date.now() + offsetMs);
  const repository = new InMemorySessionRepository({ clock });
  const hub = new InMemoryBusHub();
  let seed = 1;

  const startInstance = async (): Promise<Instance> => {
    const runtime = createRuntime({
      repository,
      bus: new InMemoryBus(hub),
      module: options.module ?? testGameModule,
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
    repository,
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
    async lobby(names: string[], settings?: Record<string, unknown>) {
      const host = await this.api.createPlayer(names[0], settings ? { settings } : {});
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

export type Cluster = Awaited<ReturnType<typeof createCluster>>;
