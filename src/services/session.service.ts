import { z } from "zod";
import { AnyGameModule } from "../games/gameModule";
import { ActionContext, actionRequestSchema } from "../models/action.model";
import { CreateSessionBody, JoinSessionBody } from "../models/session.schemas";
import {
  CoreSettings,
  failure,
  forwardFailure,
  isSessionExpired,
  PlayerRecord,
  PlayerSessionResult,
  Result,
  SessionDraft,
  SessionInfo,
  SessionRow,
  SessionView,
  success,
} from "../models";
import type { BusReason, SessionBus } from "../realtime/sessionBus";
import { createPlayerIdentity, hashPassword, sha256, verifyPassword } from "../utils/crypto";
import { logger } from "../utils/logger";
import { cryptoRng, Rng } from "../utils/random";
import { generateSessionCode, isValidSessionCode } from "../utils/sessionCode";
import { lobbyActions } from "./lobby.actions";
import { isPlayerOnline } from "./presence";
import { addPlayer, buildGameContext, getActivePlayers, isSameNickname, removePlayer, toDraft } from "./roster";
import { SessionRepository } from "./sessionRepository.service";
import { projectSessionView } from "./sessionView";

export const DEFAULT_MAX_PLAYERS = 20;
/** The polling fallback refreshes the caller's presence at most this often. */
export const PRESENCE_TOUCH_INTERVAL_MS = 10_000;
/** A burst of N simultaneous writers needs up to N rounds, so allow enough attempts plus jittered backoff. */
const DEFAULT_MAX_CAS_ATTEMPTS = 10;
const RETRY_BASE_DELAY_MS = 25;
const RETRY_MAX_DELAY_MS = 1000;

/** Exponential backoff with full jitter. */
function defaultRetryDelayMs(attempt: number): number {
  return Math.floor(Math.random() * Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)));
}

export interface SessionServiceDeps {
  repository: SessionRepository;
  module: AnyGameModule;
  bus: SessionBus;
  clock?: () => Date;
  rng?: Rng;
  maxCasAttempts?: number;
  /** Jittered pause before re-running a reducer after a lost compare-and-swap. */
  retryDelayMs?: (attempt: number) => number;
}

export interface AuthenticatedPlayer {
  row: SessionRow;
  player: PlayerRecord;
}

/** Local fast path: called with every saved row (the broadcaster emits to this instance's sockets). */
export type SessionSavedListener = (row: SessionRow, reason: BusReason) => void;

type Reducer = (row: SessionRow, now: Date) => Result<SessionDraft>;

export class SessionService {
  private readonly clock: () => Date;
  private readonly rng: Rng;
  private readonly maxCasAttempts: number;
  private readonly retryDelayMs: (attempt: number) => number;
  private onSaved?: SessionSavedListener;

  constructor(private readonly deps: SessionServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
    this.rng = deps.rng ?? cryptoRng;
    this.maxCasAttempts = deps.maxCasAttempts ?? DEFAULT_MAX_CAS_ATTEMPTS;
    this.retryDelayMs = deps.retryDelayMs ?? defaultRetryDelayMs;
  }

  setSavedListener(listener: SessionSavedListener): void {
    this.onSaved = listener;
  }

  project(row: SessionRow, viewerId: string, now = this.clock()): SessionView {
    return projectSessionView(row, viewerId, now, this.deps.module);
  }

  async create(input: CreateSessionBody): Promise<Result<PlayerSessionResult>> {
    const { module } = this.deps;
    const settings = resolveSettings(module, input.settings);
    if (!settings.isSuccess) {
      return forwardFailure(settings);
    }

    const now = this.clock();
    const identity = createPlayerIdentity();
    const player: PlayerRecord = {
      id: identity.playerId,
      nickname: input.nickname,
      tokenHash: identity.tokenHash,
      joinedAt: now.toISOString(),
      status: "active",
    };
    const passwordHash = input.password ? await hashPassword(input.password) : null;

    const inserted = await this.deps.repository.insertWithUniqueCode(
      {
        status: "pending",
        passwordHash,
        hostPlayerId: player.id,
        state: { players: [player], settings: settings.result!, game: null },
        presence: { [player.id]: now.toISOString() },
      },
      () => generateSessionCode(this.rng),
      now
    );
    if (!inserted.isSuccess) {
      return forwardFailure(inserted);
    }
    return success({ playerId: player.id, playerToken: identity.token, session: this.project(inserted.result!, player.id, now) });
  }

  async info(code: string): Promise<Result<SessionInfo>> {
    const found = await this.findLive(code);
    if (!found.isSuccess) {
      return forwardFailure(found);
    }
    const row = found.result!;
    const playerCount = getActivePlayers(row.state).length;
    return success({
      code: row.code,
      status: row.status,
      requiresPassword: row.passwordHash !== null,
      playerCount,
      maxPlayers: row.state.settings.maxPlayers,
      joinable: !isSessionExpired(row, this.clock()) && getJoinBlocker(row) === null && playerCount < row.state.settings.maxPlayers,
      expiresAt: row.expiresAt,
      ...this.deps.module.publicInfo?.(row.state.settings),
    });
  }

  async join(code: string, input: JoinSessionBody): Promise<Result<PlayerSessionResult>> {
    const found = await this.findLive(code);
    if (!found.isSuccess) {
      return forwardFailure(found);
    }
    const initial = found.result!;
    if (isSessionExpired(initial, this.clock())) {
      return failure("The session has expired", "gone");
    }
    if (initial.passwordHash !== null && !(await verifyPassword(input.password ?? "", initial.passwordHash))) {
      return failure("Wrong password", "unauthorized");
    }

    const identity = createPlayerIdentity();
    const saved = await this.mutate(code, initial, (row, now) => {
      const { module } = this.deps;
      const blocker = getJoinBlocker(row);
      if (blocker) {
        return blocker;
      }

      const holder = getActivePlayers(row.state).find((player) => isSameNickname(player.nickname, input.nickname));
      if (holder && isPlayerOnline(holder, row.presence, now)) {
        return failure("This nickname is already taken", "conflict", "nickname-taken");
      }
      const activeCount = getActivePlayers(row.state).length - (holder ? 1 : 0);
      if (activeCount >= row.state.settings.maxPlayers) {
        return failure("The session is full", "conflict", "session-full");
      }

      const env: ActionContext = { actorId: identity.playerId, now, rng: this.rng, module };
      const player: PlayerRecord = {
        id: identity.playerId,
        nickname: input.nickname,
        tokenHash: identity.tokenHash,
        joinedAt: now.toISOString(),
        status: "active",
      };
      // add first, so replacing the last (stale) player doesn't finish the session
      let draft = addPlayer(toDraft(row), player, env);
      if (holder) {
        draft = removePlayer(draft, holder.id, "replaced", env);
      }
      return success(draft);
    });
    if (!saved.isSuccess) {
      return forwardFailure(saved);
    }

    const now = this.clock();
    const row = await this.markOnline(saved.result!, identity.playerId, now);
    await this.publishChange(row, "state");
    return success({ playerId: identity.playerId, playerToken: identity.token, session: this.project(row, identity.playerId, now) });
  }

  /** Resolves the player behind a token: 404 / 410 / 401 / 403 kicked|left. */
  async authenticate(code: string, playerToken: string): Promise<Result<AuthenticatedPlayer>> {
    const found = await this.findLive(code);
    if (!found.isSuccess) {
      return forwardFailure(found);
    }
    const row = found.result!;
    if (isSessionExpired(row, this.clock())) {
      return failure("The session has expired", "gone");
    }
    const player = authenticatePlayer(row, playerToken);
    return player.isSuccess ? success({ row, player: player.result! }) : forwardFailure(player);
  }

  /** Polling fallback (§7.4). */
  async getView(code: string, playerToken: string): Promise<Result<SessionView>> {
    const auth = await this.authenticate(code, playerToken);
    if (!auth.isSuccess) {
      return forwardFailure(auth);
    }
    const { player } = auth.result!;
    let row = auth.result!.row;
    const now = this.clock();

    const lastSeenAt = row.presence[player.id];
    if (!lastSeenAt || now.getTime() - Date.parse(lastSeenAt) >= PRESENCE_TOUCH_INTERVAL_MS) {
      const wasOnline = isPlayerOnline(player, row.presence, now);
      row = await this.markOnline(row, player.id, now);
      if (!wasOnline) {
        await this.publishChange(row, "presence");
      }
    }
    return success(this.project(row, player.id, now));
  }

  async getHistory(code: string, playerToken: string): Promise<Result<unknown>> {
    const auth = await this.authenticate(code, playerToken);
    if (!auth.isSuccess) {
      return forwardFailure(auth);
    }
    const { row } = auth.result!;
    const { module } = this.deps;
    if (!module.getHistory || row.state.game === null) {
      return success([]);
    }
    return success(module.getHistory(row.state.game));
  }

  /** Action pipeline (§7.1), shared by the socket `action` event and `POST /actions`. */
  async dispatchAction(code: string, playerToken: string, request: unknown): Promise<Result<SessionView>> {
    const parsed = actionRequestSchema.safeParse(request);
    if (!parsed.success) {
      return failure(z.prettifyError(parsed.error), "bad-request");
    }
    const { type, payload } = parsed.data;
    const separator = type.indexOf(".");
    const namespace = separator > 0 ? type.slice(0, separator) : "";
    const name = separator > 0 ? type.slice(separator + 1) : "";
    const unknownAction = () => failure<SessionDraft>(`Unknown action '${type}'`, "bad-request");

    let actorId: string | null = null;
    const saved = await this.mutate(code, null, (row, now) => {
      const actor = authenticatePlayer(row, playerToken);
      if (!actor.isSuccess) {
        return forwardFailure(actor);
      }
      actorId = actor.result!.id;
      const rejected = this.rejectSession<SessionDraft>(row);
      if (rejected) {
        return rejected;
      }
      const { module } = this.deps;
      const env: ActionContext = { actorId, now, rng: this.rng, module };
      const draft = toDraft(row);

      if (namespace === "lobby") {
        const lobbyAction = Object.hasOwn(lobbyActions, name) ? lobbyActions[name] : undefined;
        if (!lobbyAction) {
          return unknownAction();
        }
        const lobbyPayload = lobbyAction.schema.safeParse(payload ?? {});
        if (!lobbyPayload.success) {
          return failure(z.prettifyError(lobbyPayload.error), "bad-request");
        }
        return lobbyAction.handle(env, draft, lobbyPayload.data);
      }

      if (namespace !== module.type) {
        return unknownAction();
      }
      const gameAction = Object.hasOwn(module.actions, name) ? module.actions[name] : undefined;
      if (!gameAction) {
        return unknownAction();
      }
      if (row.status !== "in_progress" || draft.state.game === null) {
        return failure("The game is not in progress", "conflict");
      }
      const gamePayload = gameAction.schema.safeParse(payload ?? {});
      if (!gamePayload.success) {
        return failure(z.prettifyError(gamePayload.error), "bad-request");
      }
      const transition = gameAction.handle(buildGameContext(draft, env), draft.state.game, gamePayload.data);
      if (!transition.isSuccess) {
        return forwardFailure(transition);
      }
      const { state: game, finished } = transition.result!;
      return success({ ...draft, status: finished ? "finished" : draft.status, state: { ...draft.state, game } });
    });
    if (!saved.isSuccess) {
      return forwardFailure(saved);
    }

    await this.publishChange(saved.result!, "state");
    return success(this.project(saved.result!, actorId!));
  }

  /** The module refuses this session (plan §8: `409 outdated` after a data change). */
  rejectSession<T>(row: SessionRow): Result<T> | null {
    const rejection = this.deps.module.rejectSession?.(row.state.settings);
    return rejection ? failure(rejection.message, "conflict", rejection.code) : null;
  }

  /** Load → reduce → compare-and-swap, re-running the (pure) reducer when another write won. */
  private async mutate(code: string, initial: SessionRow | null, reduce: Reducer): Promise<Result<SessionRow>> {
    for (let attempt = 1; attempt <= this.maxCasAttempts; attempt++) {
      let row = attempt === 1 ? initial : null;
      if (!row) {
        const found = await this.findLive(code);
        if (!found.isSuccess) {
          return forwardFailure(found);
        }
        row = found.result!;
      }

      const now = this.clock();
      if (isSessionExpired(row, now)) {
        return failure("The session has expired", "gone");
      }
      const draft = reduce(row, now);
      if (!draft.isSuccess) {
        return forwardFailure(draft);
      }

      const saved = await this.deps.repository.compareAndSwap(row.id, row.version, draft.result!);
      if (!saved.isSuccess) {
        return forwardFailure(saved);
      }
      if (saved.result) {
        return success(saved.result);
      }
      if (attempt < this.maxCasAttempts) {
        await sleep(this.retryDelayMs(attempt));
      }
    }
    logger.warn("cas-retries-exhausted", { code, attempts: this.maxCasAttempts });
    return failure("The session was changed by someone else at the same time, please retry", "conflict");
  }

  private async findLive(code: string): Promise<Result<SessionRow>> {
    if (!isValidSessionCode(code)) {
      return failure("Session not found", "not-found");
    }
    const found = await this.deps.repository.findLiveByCode(code);
    if (!found.isSuccess) {
      return forwardFailure(found);
    }
    return found.result ? success(found.result) : failure("Session not found", "not-found");
  }

  /** Presence write, reflected in the returned row copy (the RPC doesn't return the row). */
  private async markOnline(row: SessionRow, playerId: string, now: Date): Promise<SessionRow> {
    const result = await this.deps.repository.setPresence(row.id, [playerId], true);
    if (!result.isSuccess) {
      logger.warn("presence-update-failed", { sessionId: row.id, playerId });
      return row;
    }
    return { ...row, presence: { ...row.presence, [playerId]: now.toISOString() } };
  }

  private async publishChange(row: SessionRow, reason: BusReason): Promise<void> {
    try {
      this.onSaved?.(row, reason);
    } catch (error) {
      logger.error("local-emit-failed", { sessionId: row.id, error });
    }
    try {
      await this.deps.bus.publish(row.id, { version: row.version, reason });
    } catch (error) {
      logger.error("relay-publish-failed", { sessionId: row.id, version: row.version, reason, error });
    }
  }
}

function authenticatePlayer(row: SessionRow, playerToken: string): Result<PlayerRecord> {
  if (!playerToken) {
    return failure("Player token is required", "unauthorized");
  }
  const tokenHash = sha256(playerToken);
  const player = row.state.players.find((candidate) => candidate.tokenHash === tokenHash);
  if (!player) {
    return failure("Unknown player token", "unauthorized");
  }
  if (player.status === "kicked") {
    return failure("You were kicked from this session", "forbidden", "kicked");
  }
  if (player.status === "left") {
    return failure("You are no longer in this session", "forbidden", "left");
  }
  return success(player);
}

/** Reasons a session doesn't accept new players (capacity is checked separately). */
function getJoinBlocker(row: SessionRow): Result<SessionDraft> | null {
  if (row.status === "finished") {
    return failure("The game has finished", "conflict", "session-finished");
  }
  if (row.status === "in_progress" && !row.state.settings.allowJoinInProgress) {
    return failure("The game has already started", "conflict", "session-started");
  }
  return null;
}

function resolveSettings(
  module: AnyGameModule,
  input: Record<string, unknown> = {}
): Result<CoreSettings & Record<string, unknown>> {
  const coreSchema = z.object({
    maxPlayers: z
      .number()
      .int()
      .min(module.minPlayers)
      .max(module.maxPlayers)
      .default(Math.min(DEFAULT_MAX_PLAYERS, module.maxPlayers)),
    allowJoinInProgress: module.allowJoinInProgress === false ? z.literal(false).default(false) : z.boolean().default(true),
  });
  const core = coreSchema.safeParse(input);
  if (!core.success) {
    return failure(z.prettifyError(core.error), "bad-request");
  }
  const game = module.settingsSchema.safeParse({ ...module.defaultSettings, ...input });
  if (!game.success) {
    return failure(z.prettifyError(game.error), "bad-request");
  }
  return success({ ...(game.data as Record<string, unknown>), ...core.data });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
