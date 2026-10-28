import type { z } from "zod";
import type { ErrorCode, Result } from "../models/result";
import type { PlayerRecord, SessionStatus } from "../models/session.model";
import type { Rng } from "../engine/rng";

/**
 * Everything a game needs to plug into the session infrastructure.
 * The core handles players, lobby, host, expiry, presence, persistence and delivery.
 *
 * Handlers must be pure: no DB, no sockets, no clock reads or Math.random: use ctx.now and ctx.rng.
 */
export interface GameModule<TState, TSettings, TView> {
  /** Action namespace: wire type `<type>.<name>`. */
  type: string;
  minPlayers: number;
  maxPlayers: number;
  /** `false` pins `settings.allowJoinInProgress` to false (no joining after `lobby.start`). Default: the host chooses. */
  allowJoinInProgress?: boolean;

  /** Validated on create. Unknown keys are stripped. */
  settingsSchema: z.ZodType<TSettings>;
  defaultSettings: TSettings;

  /** Called by lobby `start`. */
  createInitialState(ctx: GameContext<TSettings>): Result<TState>;

  /** Action handlers keyed by action name (wire type: `<type>.<name>`). */
  actions: Record<string, GameAction<TState, TSettings>>;

  /** Keep the game consistent when the roster changes mid-game. ctx.activePlayers already reflects the change. */
  onPlayerJoined?(ctx: GameContext<TSettings>, state: TState, playerId: string): TState;
  onPlayerRemoved?(ctx: GameContext<TSettings>, state: TState, playerId: string): GameTransition<TState>;

  /** Per-viewer view of the state. The ONLY way game data leaves the server. Must be deterministic (ETag). */
  project(state: TState, viewerId: string, ctx: GameContext<TSettings>): TView;

  /** Optional game-specific history for `GET /history`. */
  getHistory?(state: TState): unknown;

  /** A session the module can no longer play (e.g. created with other game data): every action and socket handshake gets `409 code`. */
  rejectSession?(settings: TSettings): { message: string; code: ErrorCode } | null;

  /** Extra public fields for `GET /info` (no secrets: anyone with the code sees them). */
  publicInfo?(settings: TSettings): Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameModule = GameModule<any, any, unknown>;

export interface GameContext<TSettings> {
  /** Player performing the action / viewing. */
  actorId: string;
  hostPlayerId: string;
  /** Players with status 'active', in join order. */
  activePlayers: PlayerRecord[];
  settings: TSettings;
  status: SessionStatus;
  now: Date;
  rng: Rng;
}

export interface GameTransition<TState> {
  state: TState;
  /** The module can end the game → session.status = 'finished'. */
  finished?: boolean;
}

export interface GameAction<TState, TSettings> {
  schema: z.ZodType;
  handle(ctx: GameContext<TSettings>, state: TState, payload: unknown): Result<GameTransition<TState>>;
}

/** Binds a payload schema to a handler that receives the parsed payload type. */
export function defineGameAction<TState, TSettings, TPayload>(
  schema: z.ZodType<TPayload>,
  handle: (ctx: GameContext<TSettings>, state: TState, payload: TPayload) => Result<GameTransition<TState>>
): GameAction<TState, TSettings> {
  return { schema, handle: (ctx, state, payload) => handle(ctx, state, payload as TPayload) };
}
