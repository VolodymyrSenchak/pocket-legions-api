import { equippedItems, heroBonuses } from "../engine/army";
import { stackId } from "../engine/battle";
import { UNITS } from "../engine/data/races";
import { getMap } from "../engine/grid";
import { HERO_USES } from "../engine/heroes";
import type { Rng } from "../engine/rng";
import { BattleCtx, BattleEnv, BattleState, StackState } from "../engine/state";
import { retaliationsPerRound, startingShots } from "../engine/stats";
import type { AbilityId, GameMode, ItemId, MapId, RaceId, UnitId } from "../engine/types";
import { RACES } from "../engine/data/races";

/**
 * Rng with fixed outcomes: every percent roll (`int(100)`) succeeds or fails, every damage roll is the min or max,
 * `pick` takes the first item.
 */
export function fixedRng(options: { chance?: boolean; dmg?: "min" | "max" } = {}): Rng {
  const chance = options.chance ?? false;
  return {
    int: (max) => (max === 100 ? (chance ? 0 : 99) : options.dmg === "max" ? max - 1 : 0),
    pick: (items) => items[0],
  };
}

export function testEnv(rng: Rng = fixedRng(), nowMs = Date.parse("2026-11-01T12:00:00.000Z")): BattleEnv {
  return { rng, nowMs, turnSeconds: 45 };
}

export interface TestSide {
  seat: number;
  raceId: RaceId;
  team?: 0 | 1;
  items?: ItemId[];
}

export interface TestStack {
  seat: number;
  unitId: UnitId;
  count: number;
  x: number;
  y: number;
  /** Override any field (activated, statuses, hpTop, …). */
  with?: Partial<StackState>;
}

/** A battle in the middle of round `round`, built directly (no deployment), on an obstacle-free part of the map. */
export function makeBattle(options: {
  map?: MapId;
  mode?: GameMode;
  sides: TestSide[];
  stacks: TestStack[];
  activeSeat?: number;
  round?: number;
}): BattleState {
  const mode = options.mode ?? "ffa";
  const order = [...options.sides].sort((a, b) => a.seat - b.seat).map((side) => side.seat);
  const activeSeat = options.activeSeat ?? order[0];
  const battle: BattleState = {
    mapId: options.map ?? "village",
    mode,
    round: options.round ?? 1,
    order,
    firstSeat: activeSeat,
    activeSeat,
    turnDeadline: "2026-11-01T12:00:45.000Z",
    turn: 1,
    bonusStackId: null,
    sides: options.sides.map((side) => ({
      seat: side.seat,
      team: mode === "teams" ? side.team ?? ((side.seat % 2) as 0 | 1) : null,
      raceId: side.raceId,
      items: side.items ?? [],
      eliminated: false,
    })),
    stacks: [],
    heroes: options.sides.map((side) => ({
      seat: side.seat,
      abilityId: RACES[side.raceId].hero.ability.id,
      usesLeft: HERO_USES + heroBonuses(side.raceId, side.items ?? []).fx.heroUses,
      readyRound: 1,
      usedThisTurn: false,
    })),
    walls: [],
    killedThisRound: [],
    events: [],
    nextSeq: 1,
    result: null,
  };
  const perSeat = new Map<number, number>();
  for (const stack of options.stacks) {
    const index = perSeat.get(stack.seat) ?? 0;
    perSeat.set(stack.seat, index + 1);
    const base = { seat: stack.seat, unitId: stack.unitId };
    battle.stacks.push({
      id: stackId(stack.seat, index),
      ...base,
      count: stack.count,
      hpTop: UNITS[stack.unitId].hp,
      startCount: stack.count,
      x: stack.x,
      y: stack.y,
      shots: startingShots(battle, base),
      retaliationsLeft: retaliationsPerRound(battle, base),
      activated: false,
      activations: 0,
      statuses: [],
      rage: 0,
      resurrectUsed: false,
      ...stack.with,
    });
  }
  return battle;
}

export function ctxFor(battle: BattleState, env: BattleEnv = testEnv()): BattleCtx {
  return { ...env, battle, map: getMap(battle.mapId), out: [] };
}

export function stack(battle: BattleState, id: string): StackState {
  const found = battle.stacks.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no stack ${id}`);
  return found;
}

/** Runs `fn` with a unit's ability list replaced, then restores it (for "with vs without" comparisons). */
export function withAbilities<T>(unitId: UnitId, abilities: AbilityId[], fn: () => T): T {
  const original = UNITS[unitId].abilities;
  UNITS[unitId].abilities = abilities;
  try {
    return fn();
  } finally {
    UNITS[unitId].abilities = original;
  }
}

export { equippedItems };
