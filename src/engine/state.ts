import type { BuiltMap } from "./grid";
import type { Rng } from "./rng";
import type { AbilityId, Cell, GameMode, HeroAbilityId, ItemId, MapId, RaceId, UnitId } from "./types";

/**
 * Timed effects on a stack. `untilRound`: removed at the end of that round.
 * `untilActivation`: removed when the stack finishes (or skips) its activation number N (see `StackState.activations`).
 */
export type StatusId =
  | "defending"
  | "skip_next"
  | "blinded"
  | "entangled"
  | "maimed"
  | "diseased"
  | "burning"
  | "war_drum"
  | "rune_shield"
  | "scream"
  | "heavenly_shield"
  | "battle_cry";

export interface Status {
  id: StatusId;
  untilRound?: number;
  untilActivation?: number;
  /** Strength: burn damage per round, hero ability power multiplier, … */
  value?: number;
}

export interface StackState {
  /** `s<seat>_<index>`, unique per battle. */
  id: string;
  seat: number;
  unitId: UnitId;
  /** Living units; 0 = dead (the cell is free). */
  count: number;
  /** HP of the top (wounded) unit, 1..unit.hp while alive. */
  hpTop: number;
  /** Count at battle start: the revive cap for resurrection and lifesteal. */
  startCount: number;
  x: number;
  y: number;
  shots: number;
  retaliationsLeft: number;
  activated: boolean;
  /** Activations started so far (skipped ones included). */
  activations: number;
  statuses: Status[];
  /** Rage (Молотобоєць): +2 attack per hit taken, up to +6. */
  rage: number;
  /** Resurrection is once per battle. */
  resurrectUsed: boolean;
}

export interface SideState {
  seat: number;
  team: 0 | 1 | null;
  raceId: RaceId;
  /** Every equipped item, rings included. */
  items: ItemId[];
  eliminated: boolean;
}

export interface HeroState {
  seat: number;
  abilityId: HeroAbilityId;
  usesLeft: number;
  /** The first round in which the ability can be used again (3-round cooldown). */
  readyRound: number;
  /** One hero ability per turn, before `act`. */
  usedThisTurn: boolean;
}

export interface Wall extends Cell {
  /** Removed at the end of this round. */
  untilRound: number;
}

export type GameEventType =
  | "battleStarted"
  | "roundStarted"
  | "turnStarted"
  | "moved"
  | "attacked"
  | "shot"
  | "damaged"
  | "missed"
  | "retaliated"
  | "abilityUsed"
  | "heroAbility"
  | "healed"
  | "resurrected"
  | "raised"
  | "statusApplied"
  | "skipped"
  | "defended"
  | "stackDied"
  | "morale"
  | "luck"
  | "wallBuilt"
  | "timedOut"
  | "surrendered"
  | "playerEliminated"
  | "battleOver";

/** Flat on purpose: every field except seq/round/type is optional and depends on `type`. */
export interface GameEvent {
  seq: number;
  round: number;
  type: GameEventType;
  seat?: number;
  stackId?: string;
  targetId?: string;
  path?: Cell[];
  cell?: Cell;
  cells?: Cell[];
  /** Damage dealt, HP healed, units raised, … */
  amount?: number;
  kills?: number;
  abilityId?: AbilityId | HeroAbilityId;
  statusId?: StatusId;
  /** luck: `double` | `half`; morale: `again` | `skip`; damaged: `retaliation` | `splash` | `burn` | `reflect` | `lightning` | `hero`. */
  detail?: string;
  winnerSeats?: number[];
  reason?: string;
  points?: number[];
}

export type BattleEndReason = "elimination" | "round-limit" | "surrender";

export interface BattleResult {
  winnerSeats: number[];
  reason: BattleEndReason;
  /** Round limit only: points of living army per seat, in `order`. */
  points?: number[];
}

export interface BattleState {
  mapId: MapId;
  mode: GameMode;
  round: number;
  /** Seats in turn order (clockwise; in 2 vs 2 the teams alternate). */
  order: number[];
  /** Seat that opens the current round; rotates every round. */
  firstSeat: number;
  activeSeat: number;
  /** ISO; set when a turn starts (plan §3.5). */
  turnDeadline: string;
  /** Turn counter, so a client can tell turns apart even when the same seat plays twice in a row. */
  turn: number;
  /** Morale bonus: this stack acts once more before the turn passes. */
  bonusStackId: string | null;
  sides: SideState[];
  stacks: StackState[];
  heroes: HeroState[];
  walls: Wall[];
  /** HP of units killed this round, per victim seat (vampire necromancy). */
  killedThisRound: { seat: number; hp: number }[];
  /** The last EVENTS_IN_STATE events (plan §3.4). */
  events: GameEvent[];
  nextSeq: number;
  result: BattleResult | null;
}

export const EVENTS_IN_STATE = 64;
export const ROUND_LIMIT = 30;

/** What the caller supplies for one engine step. */
export interface BattleEnv {
  rng: Rng;
  /** Server time in ms, used only to compute turn deadlines. */
  nowMs: number;
  turnSeconds: number;
}

/** Working context for one engine step. The engine mutates `battle` in place; callers pass a copy. */
export interface BattleCtx extends BattleEnv {
  battle: BattleState;
  map: BuiltMap;
  /** Every event of this step, uncapped (the game layer appends them to `history`). */
  out: GameEvent[];
}

export function emit(ctx: BattleCtx, event: Omit<GameEvent, "seq" | "round">): GameEvent {
  const full: GameEvent = { seq: ctx.battle.nextSeq++, round: ctx.battle.round, ...event };
  ctx.battle.events.push(full);
  if (ctx.battle.events.length > EVENTS_IN_STATE) {
    ctx.battle.events.splice(0, ctx.battle.events.length - EVENTS_IN_STATE);
  }
  ctx.out.push(full);
  return full;
}

export function isAlive(stack: StackState): boolean {
  return stack.count > 0;
}

export function livingStacks(battle: BattleState): StackState[] {
  return battle.stacks.filter(isAlive);
}

export function findStack(battle: BattleState, id: string): StackState | undefined {
  return battle.stacks.find((stack) => stack.id === id);
}

export function sideOf(battle: BattleState, seat: number): SideState {
  const side = battle.sides.find((candidate) => candidate.seat === seat);
  if (!side) {
    throw new Error(`No side for seat ${seat}`);
  }
  return side;
}

/** Own seat, or the teammate in 2 vs 2. */
export function areAllies(battle: BattleState, seatA: number, seatB: number): boolean {
  if (seatA === seatB) return true;
  if (battle.mode !== "teams") return false;
  return sideOf(battle, seatA).team === sideOf(battle, seatB).team;
}

export function stackAt(battle: BattleState, cell: Cell): StackState | undefined {
  return battle.stacks.find((stack) => isAlive(stack) && stack.x === cell.x && stack.y === cell.y);
}

export function cellOf(stack: StackState): Cell {
  return { x: stack.x, y: stack.y };
}

export function hasStatus(stack: StackState, id: StatusId): boolean {
  return stack.statuses.some((status) => status.id === id);
}

export function getStatus(stack: StackState, id: StatusId): Status | undefined {
  return stack.statuses.find((status) => status.id === id);
}

/** Replaces an existing status of the same id. */
export function setStatus(stack: StackState, status: Status): void {
  stack.statuses = stack.statuses.filter((existing) => existing.id !== status.id);
  stack.statuses.push(status);
}

export function removeStatus(stack: StackState, id: StatusId): void {
  stack.statuses = stack.statuses.filter((status) => status.id !== id);
}
