import { z } from "zod";
import type { Placement } from "../engine/army";
import { MAP_IDS, MAPS } from "../engine/data/maps";
import type { BattleState, GameEvent } from "../engine/state";
import type { Army, GameMode, MapId, RaceId } from "../engine/types";
import { DATA_VERSION } from "../engine/version";
import type { GameContext } from "../games/gameModule";
import type { CoreSettings } from "../models/session.model";
import type { ErrorCode, ErrorStatus, Result } from "../models/result";

export const GAME_TYPE = "pocket-legions";
// TODO(plan §12.5): 3000 events ≈ 260 KB per row, above the 100 KB target; smaller cap or a separate log?
export const HISTORY_LIMIT = 3000;
/** Plan §3.5. TODO(plan §12.1): 3 timed-out turns in a row vs the design's "back within 2 minutes". */
export const AUTO_SURRENDER_TIMEOUTS = 3;

export const BUDGETS = [500, 1000, 1500, 2000] as const;

export const settingsSchema = z.object({
  mapId: z.enum(MAP_IDS as [MapId, ...MapId[]]).default("valley"),
  budget: z.union([z.literal(500), z.literal(1000), z.literal(1500), z.literal(2000)]).default(1000),
  mode: z.enum(["ffa", "teams"]).default("ffa"),
  turnSeconds: z.number().int().min(30).max(90).default(45),
  // set by the server on create: whatever the client sends is replaced
  dataVersion: z.unknown().transform(() => DATA_VERSION),
});

export interface PocketLegionsSettings {
  mapId: MapId;
  budget: (typeof BUDGETS)[number];
  mode: GameMode;
  turnSeconds: number;
  dataVersion: string;
}

export const defaultSettings: PocketLegionsSettings = {
  mapId: "valley",
  budget: 1000,
  mode: "ffa",
  turnSeconds: 45,
  dataVersion: DATA_VERSION,
};

export type Settings = PocketLegionsSettings & CoreSettings;
export type Ctx = GameContext<Settings>;

export interface Seat {
  playerId: string;
  /** 0..3 in join order: decides the deploy zone and the colour. */
  seat: number;
  team: 0 | 1 | null;
  raceId: RaceId | null;
  army: Army | null;
  armyReady: boolean;
  deployment: Placement[] | null;
  deployReady: boolean;
  eliminated: boolean;
  timeoutsInRow: number;
}

export type GameEndReason = "elimination" | "round-limit" | "surrender" | "not-enough-players";

export interface GameResult {
  winnerSeats: number[];
  reason: GameEndReason;
  points?: number[];
}

export interface PocketLegionsState {
  phase: "army" | "deploy" | "battle" | "over";
  seats: Seat[];
  battle: BattleState | null;
  result: GameResult | null;
  /** The full event log, capped at HISTORY_LIMIT (`GET /history`). */
  history: GameEvent[];
}

export function mapDef(mapId: MapId) {
  return MAPS.find((map) => map.id === mapId)!;
}

/** Player count allowed to start: FFA within the map's range, 2 vs 2 exactly 4. */
export function startProblem(settings: PocketLegionsSettings, players: number): string | null {
  if (settings.mode === "teams") {
    if (!mapDef(settings.mapId).teams) return "This map has no 2 vs 2 mode";
    return players === 4 ? null : "2 vs 2 needs exactly 4 players";
  }
  const [min, max] = mapDef(settings.mapId).ffaPlayers;
  return players >= min && players <= max ? null : `This map is for ${min === max ? min : `${min}–${max}`} players`;
}

export function createInitialState(ctx: Ctx): Result<PocketLegionsState> {
  const problem = startProblem(ctx.settings, ctx.activePlayers.length);
  if (problem) return fail(problem, "conflict");
  return ok({
    phase: "army",
    seats: ctx.activePlayers.map((player, seat) => ({
      playerId: player.id,
      seat,
      // default teams: seats 0+2 vs 1+3
      team: ctx.settings.mode === "teams" ? ((seat % 2) as 0 | 1) : null,
      raceId: null,
      army: null,
      armyReady: false,
      deployment: null,
      deployReady: false,
      eliminated: false,
      timeoutsInRow: 0,
    })),
    battle: null,
    result: null,
    history: [],
  });
}

export function seatOf(state: PocketLegionsState, playerId: string): Seat | undefined {
  return state.seats.find((seat) => seat.playerId === playerId);
}

export function appendHistory(state: PocketLegionsState, events: GameEvent[]): GameEvent[] {
  const history = [...state.history, ...events];
  return history.length > HISTORY_LIMIT ? history.slice(history.length - HISTORY_LIMIT) : history;
}

// Result helpers: the same shape as models/result.ts, built here so game/ keeps only type imports from models/.

export function ok<T>(result: T): Result<T> {
  return { result, isSuccess: true };
}

export function fail<T>(error: string, errorStatus: ErrorStatus, errorCode?: ErrorCode, errorReason?: string): Result<T> {
  return {
    error,
    errorStatus,
    ...(errorCode ? { errorCode } : {}),
    ...(errorReason ? { errorReason } : {}),
    isSuccess: false,
  };
}
