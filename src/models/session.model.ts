export type SessionStatus = "pending" | "in_progress" | "finished";
export type PlayerStatus = "active" | "left" | "kicked";
/** Why a player is no longer active. `replaced` = a rejoining player took over the stale nickname. */
export type RemovalReason = "left" | "kicked" | "replaced";

export interface PlayerRecord {
  id: string;
  nickname: string;
  /** sha256(playerToken) — never projected. */
  tokenHash: string;
  joinedAt: string;
  status: PlayerStatus;
  removalReason?: RemovalReason;
}

export interface CoreSettings {
  maxPlayers: number;
  allowJoinInProgress: boolean;
}

export interface SessionState<TGame = unknown, TSettings = Record<string, unknown>> {
  players: PlayerRecord[];
  settings: CoreSettings & TSettings;
  /** null while pending; owned by the game module. */
  game: TGame | null;
}

/** `{ playerId: lastSeenAt ISO | null }` — updated without a version bump. */
export type PresenceMap = Record<string, string | null>;

export interface SessionRow {
  id: string;
  code: string;
  status: SessionStatus;
  passwordHash: string | null;
  hostPlayerId: string;
  state: SessionState;
  presence: PresenceMap;
  version: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export type NewSessionRow = Pick<SessionRow, "status" | "passwordHash" | "hostPlayerId" | "state" | "presence">;

/** The part of a session that reducers change and compare-and-swap writes. */
export interface SessionDraft {
  status: SessionStatus;
  hostPlayerId: string;
  state: SessionState;
}

export interface SessionVersionInfo {
  id: string;
  version: number;
  status: SessionStatus;
  expiresAt: string;
}

export interface SessionPlayerView {
  id: string;
  nickname: string;
  isHost: boolean;
  isOnline: boolean;
  joinedAt: string;
}

export interface SessionView<TGameView = unknown> {
  code: string;
  status: SessionStatus;
  version: number;
  createdAt: string;
  expiresAt: string;
  hostPlayerId: string;
  me: { playerId: string; nickname: string; isHost: boolean };
  players: SessionPlayerView[];
  settings: unknown;
  poll: { intervalMs: number };
  game: TGameView | null;
}

export interface SessionInfo {
  code: string;
  status: SessionStatus;
  requiresPassword: boolean;
  playerCount: number;
  maxPlayers: number;
  joinable: boolean;
  expiresAt: string;
}

export interface PlayerSessionResult {
  playerId: string;
  playerToken: string;
  session: SessionView;
}

export const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;

export function isSessionExpired(row: Pick<SessionRow, "expiresAt">, now: Date): boolean {
  return Date.parse(row.expiresAt) <= now.getTime();
}
