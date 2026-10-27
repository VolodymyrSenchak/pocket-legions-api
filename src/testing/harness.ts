import { Application } from "express";
import request, { Response } from "supertest";
import { AnyGameModule } from "../games/gameModule";
import { SessionView } from "../models";
import { InMemoryBus, InMemoryBusHub } from "../realtime/sessionBus";
import { createRuntime } from "../runtime";
import { InMemorySessionRepository } from "../services/sessionRepository.memory";
import { createSeededRng } from "../utils/random";
import { testGameModule } from "./testGame";

export const TEST_START_TIME = Date.parse("2026-09-01T12:00:00.000Z");

export interface TestPlayer {
  code: string;
  playerId: string;
  playerToken: string;
  nickname: string;
}

export function expectStatus(res: Response, status: number, label: string): void {
  if (res.status !== status) {
    throw new Error(`${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
  }
}

export class ApiClient {
  constructor(readonly app: Application) {}

  create(body: Record<string, unknown>) {
    return request(this.app).post("/api/sessions").send(body);
  }

  info(code: string) {
    return request(this.app).get(`/api/sessions/${code}/info`);
  }

  join(code: string, body: Record<string, unknown>) {
    return request(this.app).post(`/api/sessions/${code}/join`).send(body);
  }

  state(player: TestPlayer, etag?: string) {
    const req = request(this.app).get(`/api/sessions/${player.code}/state`).set("X-Player-Token", player.playerToken);
    return etag ? req.set("If-None-Match", etag) : req;
  }

  action(player: TestPlayer, type: string, payload?: unknown) {
    return request(this.app)
      .post(`/api/sessions/${player.code}/actions`)
      .set("X-Player-Token", player.playerToken)
      .send({ type, payload });
  }

  history(player: TestPlayer) {
    return request(this.app).get(`/api/sessions/${player.code}/history`).set("X-Player-Token", player.playerToken);
  }

  async createPlayer(nickname: string, extra: Record<string, unknown> = {}): Promise<TestPlayer> {
    const res = await this.create({ nickname, ...extra });
    expectStatus(res, 201, `create by ${nickname}`);
    return { code: res.body.session.code, playerId: res.body.playerId, playerToken: res.body.playerToken, nickname };
  }

  async joinPlayer(code: string, nickname: string, extra: Record<string, unknown> = {}): Promise<TestPlayer> {
    const res = await this.join(code, { nickname, ...extra });
    expectStatus(res, 200, `join by ${nickname}`);
    return { code, playerId: res.body.playerId, playerToken: res.body.playerToken, nickname };
  }

  async act(player: TestPlayer, type: string, payload?: unknown): Promise<SessionView> {
    const res = await this.action(player, type, payload);
    expectStatus(res, 200, `${type} by ${player.nickname}`);
    return res.body;
  }

  async view(player: TestPlayer): Promise<SessionView> {
    const res = await this.state(player);
    expectStatus(res, 200, `state for ${player.nickname}`);
    return res.body;
  }
}

export interface HttpHarnessOptions {
  /** Defaults to the stub `test-game` module. */
  module?: AnyGameModule;
  repositoryLatencyMs?: number;
  /** Defaults to the production retry policy. */
  retryDelayMs?: (attempt: number) => number;
}

/** One in-process instance with an in-memory repository, a fake clock and a seeded rng. */
export function createHttpHarness(options: HttpHarnessOptions = {}) {
  let now = TEST_START_TIME;
  const clock = () => new Date(now);
  const repository = new InMemorySessionRepository({ clock, latencyMs: options.repositoryLatencyMs });
  const hub = new InMemoryBusHub();
  const runtime = createRuntime({
    repository,
    bus: new InMemoryBus(hub),
    module: options.module ?? testGameModule,
    clock,
    rng: createSeededRng(42),
    http: { rateLimits: false },
    service: { retryDelayMs: options.retryDelayMs },
  });

  return {
    runtime,
    repository,
    hub,
    api: new ApiClient(runtime.app),
    clock,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

export async function waitFor(predicate: () => boolean, label = "condition", timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await sleep(10);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
