import { BALANCE, ITEMS, ItemId, SingleSlot, SLOTS } from "./data/items";
import { RACES, UNITS, UnitId } from "./data/races";
import { cellKey, cellIndex, BuiltMap } from "./grid";
import type { Army, Cell, ItemEffects, RaceId } from "./types";

export interface ArmyRules {
  budget: number;
  mapSize: number;
  playerCount: number;
}

export type ArmyProblem =
  | "unknown-unit"
  | "wrong-race"
  | "no-stacks"
  | "too-many-stacks"
  | "bad-count"
  | "too-many-of-type"
  | "too-many-champions"
  | "unknown-item"
  | "wrong-slot"
  | "too-many-rings"
  | "gear-over-cap"
  | "over-budget";

export type ArmyCheck = { ok: true; unitPoints: number; gearPoints: number } | { ok: false; reason: ArmyProblem };

/** Design §2: 6 stacks, 5 on 10×10 maps with 3–4 players. */
export function maxStacks(mapSize: number, playerCount: number): number {
  return mapSize <= 10 && playerCount >= 3 ? BALANCE.maxStacks - 1 : BALANCE.maxStacks;
}

/** 2 champions (tier 10 units) at budget 1000, scaled with the budget, at least 1. */
export function maxChampions(budget: number): number {
  return Math.max(1, Math.floor((2 * budget) / BALANCE.defaultBudget));
}

/** Item prices are set for 1000 points and scale with the budget (design §2). */
export function itemCost(itemId: ItemId, budget: number): number {
  return Math.round((ITEMS[itemId].cost * budget) / BALANCE.defaultBudget);
}

export function gearCap(budget: number): number {
  return Math.floor(budget * BALANCE.gearCapShare);
}

export function equippedItems(army: Pick<Army, "items" | "rings">): ItemId[] {
  const singles = SLOTS.filter((slot): slot is SingleSlot => slot !== "ring")
    .map((slot) => army.items[slot])
    .filter((id): id is ItemId => id !== undefined);
  return [...singles, ...army.rings];
}

export function armyPoints(army: Army, budget: number): { unitPoints: number; gearPoints: number } {
  const unitPoints = army.stacks.reduce((sum, stack) => sum + (UNITS[stack.unitId]?.cost ?? 0) * stack.count, 0);
  const gearPoints = equippedItems(army).reduce((sum, id) => sum + (ITEMS[id] ? itemCost(id, budget) : 0), 0);
  return { unitPoints, gearPoints };
}

/**
 * Plan §6.7. Units, gear and the budget are checked in this order; the first problem wins.
 * TODO(plan §12.3): one shared budget with a 30% gear cap (as now) or a separate hero budget — only this function changes.
 */
export function validateArmy(army: Army, raceId: RaceId, rules: ArmyRules): ArmyCheck {
  if (army.stacks.length === 0) return { ok: false, reason: "no-stacks" };
  if (army.stacks.length > maxStacks(rules.mapSize, rules.playerCount)) return { ok: false, reason: "too-many-stacks" };
  const perType = new Map<UnitId, number>();
  let champions = 0;
  for (const stack of army.stacks) {
    const unit = Object.hasOwn(UNITS, stack.unitId) ? UNITS[stack.unitId] : undefined;
    if (!unit) return { ok: false, reason: "unknown-unit" };
    if (unit.raceId !== raceId) return { ok: false, reason: "wrong-race" };
    if (!Number.isInteger(stack.count) || stack.count < 1) return { ok: false, reason: "bad-count" };
    perType.set(unit.id, (perType.get(unit.id) ?? 0) + 1);
    if (perType.get(unit.id)! > 2) return { ok: false, reason: "too-many-of-type" };
    if (unit.tier === 10) champions += stack.count;
  }
  if (champions > maxChampions(rules.budget)) return { ok: false, reason: "too-many-champions" };

  for (const [slot, id] of Object.entries(army.items) as [SingleSlot, ItemId | undefined][]) {
    if (id === undefined) continue;
    if (!Object.hasOwn(ITEMS, id)) return { ok: false, reason: "unknown-item" };
    if (ITEMS[id].slot !== slot) return { ok: false, reason: "wrong-slot" };
  }
  if (army.rings.length > 2) return { ok: false, reason: "too-many-rings" };
  for (const id of army.rings) {
    if (!Object.hasOwn(ITEMS, id)) return { ok: false, reason: "unknown-item" };
    if (ITEMS[id].slot !== "ring") return { ok: false, reason: "wrong-slot" };
  }

  const { unitPoints, gearPoints } = armyPoints(army, rules.budget);
  if (gearPoints > gearCap(rules.budget)) return { ok: false, reason: "gear-over-cap" };
  if (unitPoints + gearPoints > rules.budget) return { ok: false, reason: "over-budget" };
  return { ok: true, unitPoints, gearPoints };
}

export interface HeroBonuses {
  atk: number;
  def: number;
  /** Hero + gear, capped at ±5. Racial luck is added per stack (stats.ts) under the same cap. */
  luck: number;
  morale: number;
  /** Summed special effects of the gear. */
  fx: Required<Omit<ItemEffects, "atk" | "def" | "luck" | "morale">>;
}

export const LUCK_MORALE_CAP = 5;

export function clampLuckMorale(value: number): number {
  return Math.max(-LUCK_MORALE_CAP, Math.min(LUCK_MORALE_CAP, value));
}

export function heroBonuses(raceId: RaceId, items: readonly ItemId[]): HeroBonuses {
  const hero = RACES[raceId].hero;
  const sum: Required<ItemEffects> = {
    atk: hero.atk,
    def: hero.def,
    luck: hero.luck,
    morale: hero.morale,
    rangedTaken: 0,
    heroPower: 0,
    heroUses: 0,
    spdRound1: 0,
    retaliations: 0,
    spdGround: 0,
    deployRows: 0,
    spdFly: 0,
    range: 0,
    shots: 0,
    meleeLifesteal: 0,
    heroDmgTaken: 0,
  };
  for (const id of items) {
    for (const [key, value] of Object.entries(ITEMS[id].fx) as [keyof ItemEffects, number][]) {
      sum[key] += value;
    }
  }
  const { atk, def, luck, morale, ...fx } = sum;
  return { atk, def, luck: clampLuckMorale(luck), morale: clampLuckMorale(morale), fx };
}

export interface Placement {
  stackIndex: number;
  x: number;
  y: number;
}

export type DeployProblem = "missing-stack" | "duplicate-stack" | "outside-zone" | "cell-blocked" | "cell-taken";

/** Every stack placed exactly once, inside the zone, on a free cell, one stack per cell. */
export function validateDeployment(
  map: BuiltMap,
  zone: readonly Cell[],
  stackCount: number,
  placements: readonly Placement[]
): { ok: true } | { ok: false; reason: DeployProblem } {
  const zoneKeys = new Set(zone.map(cellKey));
  const usedStacks = new Set<number>();
  const usedCells = new Set<string>();
  for (const placement of placements) {
    if (!Number.isInteger(placement.stackIndex) || placement.stackIndex < 0 || placement.stackIndex >= stackCount) {
      return { ok: false, reason: "missing-stack" };
    }
    if (usedStacks.has(placement.stackIndex)) return { ok: false, reason: "duplicate-stack" };
    usedStacks.add(placement.stackIndex);
    if (!zoneKeys.has(cellKey(placement))) return { ok: false, reason: "outside-zone" };
    if (map.blocked[cellIndex(map, placement)]) return { ok: false, reason: "cell-blocked" };
    if (usedCells.has(cellKey(placement))) return { ok: false, reason: "cell-taken" };
    usedCells.add(cellKey(placement));
  }
  return usedStacks.size === stackCount ? { ok: true } : { ok: false, reason: "missing-stack" };
}
