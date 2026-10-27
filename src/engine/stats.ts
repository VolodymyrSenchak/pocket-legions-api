import { clampLuckMorale, heroBonuses, HeroBonuses } from "./army";
import type { AbilityId } from "./data/abilities";
import { UNITS } from "./data/races";
import { isAdjacent } from "./grid";
import { areAllies, BattleState, getStatus, hasStatus, isAlive, sideOf, StackState } from "./state";
import type { UnitDef } from "./types";

// Effective stats of a stack: unit + hero + gear + racial trait + statuses (plan §6.4 step 3).

/** Units whose morale is always 0 (design §3) besides the undead race. */
export const MECHANISMS = new Set(["gyrocopter", "golem"]);

export function unitOf(stack: StackState): UnitDef {
  return UNITS[stack.unitId];
}

export function hasAbility(stack: StackState, id: AbilityId): boolean {
  return unitOf(stack).abilities.includes(id);
}

export function bonusesOf(battle: BattleState, seat: number): HeroBonuses {
  const side = sideOf(battle, seat);
  return heroBonuses(side.raceId, side.items);
}

export function raceOf(battle: BattleState, stack: StackState) {
  return sideOf(battle, stack.seat).raceId;
}

export function isUndead(battle: BattleState, stack: StackState): boolean {
  return raceOf(battle, stack) === "vampires";
}

export function isShooter(stack: StackState): boolean {
  return unitOf(stack).ranged !== undefined;
}

/** Barbarian Лють: +1 attack per lost unit, up to +4. */
export function furyBonus(battle: BattleState, stack: StackState): number {
  return raceOf(battle, stack) === "barbarians" ? Math.min(4, Math.max(0, stack.startCount - stack.count)) : 0;
}

export function attackOf(battle: BattleState, stack: StackState): number {
  let attack = unitOf(stack).atk + bonusesOf(battle, stack.seat).atk + furyBonus(battle, stack) + stack.rage;
  if (hasStatus(stack, "war_drum")) attack += 4;
  if (hasStatus(stack, "diseased")) attack -= 3;
  return Math.max(0, attack);
}

/** Knight Стрій: +2 defence while another allied stack stands next to it. */
export function formationBonus(battle: BattleState, stack: StackState): number {
  if (raceOf(battle, stack) !== "knights") return 0;
  const guarded = battle.stacks.some(
    (other) => other !== stack && isAlive(other) && areAllies(battle, other.seat, stack.seat) && isAdjacent(other, stack)
  );
  return guarded ? 2 : 0;
}

export function defenceOf(battle: BattleState, stack: StackState): number {
  let defence = unitOf(stack).def + bonusesOf(battle, stack.seat).def + formationBonus(battle, stack);
  if (hasStatus(stack, "rune_shield")) defence += 5;
  defence = Math.max(0, defence);
  if (hasStatus(stack, "defending")) defence *= raceOf(battle, stack) === "dwarves" ? 1.5 : 1.3;
  return defence;
}

export function luckOf(battle: BattleState, stack: StackState): number {
  const race = raceOf(battle, stack);
  let luck = bonusesOf(battle, stack.seat).luck;
  if (race === "demons") luck += 1;
  if (race === "elves" && isShooter(stack)) luck += 1;
  luck = clampLuckMorale(luck);
  // demons never roll negative luck
  return race === "demons" ? Math.max(0, luck) : luck;
}

export function moraleOf(battle: BattleState, stack: StackState): number {
  if (isUndead(battle, stack) || MECHANISMS.has(stack.unitId)) return 0;
  return bonusesOf(battle, stack.seat).morale;
}

export function rangeOf(battle: BattleState, stack: StackState): number {
  const ranged = unitOf(stack).ranged;
  if (!ranged) return 0;
  const elves = raceOf(battle, stack) === "elves" ? 1 : 0;
  return ranged.range + elves + bonusesOf(battle, stack.seat).fx.range;
}

export function startingShots(battle: BattleState, stack: Pick<StackState, "seat" | "unitId">): number {
  const ranged = UNITS[stack.unitId].ranged;
  return ranged ? ranged.shots + bonusesOf(battle, stack.seat).fx.shots : 0;
}

export function speedOf(battle: BattleState, stack: StackState): number {
  if (hasStatus(stack, "entangled")) return 0;
  const unit = unitOf(stack);
  const fx = bonusesOf(battle, stack.seat).fx;
  let speed = unit.spd + (unit.fly ? fx.spdFly : fx.spdGround);
  if (battle.round === 1) speed += fx.spdRound1;
  if (hasStatus(stack, "maimed")) speed -= 2;
  return Math.max(1, speed);
}

export function retaliationsPerRound(battle: BattleState, stack: Pick<StackState, "seat">): number {
  return 1 + bonusesOf(battle, stack.seat).fx.retaliations;
}

/** Hero ability strength: 1, or 1.5 with the mantle. */
export function heroPower(battle: BattleState, seat: number): number {
  return 1 + bonusesOf(battle, seat).fx.heroPower;
}

export function statusValue(stack: StackState, id: Parameters<typeof getStatus>[1], fallback = 1): number {
  return getStatus(stack, id)?.value ?? fallback;
}

export function totalHp(stack: StackState): number {
  return stack.count > 0 ? (stack.count - 1) * unitOf(stack).hp + stack.hpTop : 0;
}

/** Points of a living stack for the round-limit score: units × cost. */
export function stackPoints(stack: StackState): number {
  return stack.count * unitOf(stack).cost;
}
