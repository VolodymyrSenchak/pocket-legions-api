import { Hit, hooksOf, isMagicImmune, someHook } from "./abilities";
import { kad } from "./balance";
import { applyDamage, healStack } from "./effects";
import { distance, isAdjacent } from "./grid";
import { roll, rollRange } from "./rng";
import { areAllies, BattleCtx, BattleState, emit, getStatus, hasStatus, isAlive, livingStacks, StackState } from "./state";
import { attackOf, bonusesOf, defenceOf, hasAbility, isShooter, luckOf, raceOf, rangeOf, totalHp, unitOf } from "./stats";

// The damage pipeline, plan §6.4. One function, fixed order; `preview` runs the deterministic part.

export type ShotPenalty = "range" | "adjacent";

/** Druid shots count as magic (stone skin). Hero abilities are handled in heroes.ts. */
export function isMagicAttack(stack: StackState, mode: Hit["mode"]): boolean {
  return mode === "ranged" && hasAbility(stack, "magic_shot");
}

export function hasAdjacentEnemy(battle: BattleState, stack: StackState): boolean {
  return livingStacks(battle).some((other) => !areAllies(battle, other.seat, stack.seat) && isAdjacent(other, stack));
}

export function shotPenalties(battle: BattleState, shooter: StackState, target: StackState): ShotPenalty[] {
  const penalties: ShotPenalty[] = [];
  if (distance(shooter, target) > rangeOf(battle, shooter) && !someHook(shooter, (h) => h.ignoresRangePenalty)) {
    penalties.push("range");
  }
  if (hasAdjacentEnemy(battle, shooter) && !someHook(shooter, (h) => h.noMeleePenalty)) penalties.push("adjacent");
  return penalties;
}

/** Steps 3–6: everything except the dice. Damage = Σ rolls × this. */
export function damageMultiplier(battle: BattleState, hit: Hit): number {
  const { attacker, target } = hit;

  // 3–4: effective attack and defence, defence ignore, K_AD
  let defence = defenceOf(battle, target);
  for (const hooks of hooksOf(attacker)) defence *= hooks.defenceFactor?.(hit) ?? 1;
  let multiplier = kad(attackOf(battle, attacker), defence);

  // 5: ranged modifiers
  if (hit.mode === "ranged") {
    multiplier *= 0.5 ** shotPenalties(battle, attacker, target).length;
    for (const hooks of hooksOf(target)) multiplier *= hooks.takenFactor?.(hit) ?? 1;
    multiplier *= 1 + bonusesOf(battle, target.seat).fx.rangedTaken;
  } else if (isShooter(attacker) && !someHook(attacker, (h) => h.noMeleePenalty)) {
    multiplier *= 0.5;
  }

  // 6: attack modifiers and round buffs
  for (const hooks of hooksOf(attacker)) multiplier *= hooks.attackFactor?.(battle, hit) ?? 1;
  if (hasStatus(attacker, "battle_cry")) multiplier *= 1 + 0.25 * (getStatus(attacker, "battle_cry")!.value ?? 1);
  if (hasStatus(attacker, "scream")) multiplier *= 0.75;
  if (hasStatus(target, "heavenly_shield")) multiplier *= 1 - 0.5 * (getStatus(target, "heavenly_shield")!.value ?? 1);
  if (hit.magic && raceOf(battle, target) === "dwarves") multiplier *= 0.75;
  return multiplier * hit.factor;
}

export interface Preview {
  dmg: [number, number];
  kills: [number, number];
}

function killsFor(target: StackState, damage: number): number {
  const remaining = Math.max(0, totalHp(target) - damage);
  return target.count - (remaining > 0 ? Math.ceil(remaining / unitOf(target).hp) : 0);
}

/** Min/max damage and kills of one hit, without luck, evasion or on-hit effects (hints). */
export function preview(battle: BattleState, hit: Omit<Hit, "factor" | "splash" | "magic">): Preview {
  const full: Hit = { ...hit, factor: 1, splash: false, magic: isMagicAttack(hit.attacker, hit.mode) };
  const multiplier = damageMultiplier(battle, full);
  const [min, max] = unitOf(hit.attacker).dmg;
  const low = Math.max(1, Math.floor(hit.attacker.count * min * multiplier));
  const high = Math.max(1, Math.floor(hit.attacker.count * max * multiplier));
  return { dmg: [low, high], kills: [killsFor(hit.target, low), killsFor(hit.target, high)] };
}

/**
 * One hit, steps 1–9 (+ step 10 through `areaAfter`). Returns the damage dealt (0 on a miss).
 * Splash hits skip luck, criticals and on-hit effects.
 */
export function strike(ctx: BattleCtx, hit: Hit): number {
  const { attacker, target } = hit;
  if (!isAlive(attacker) || !isAlive(target)) return 0;
  // magical splash (the lich cloud) passes over magic-immune stacks
  if (hit.magic && hit.splash && isMagicImmune(target)) return 0;

  // 1: evasion
  const evasion = hooksOf(target).reduce((max, hooks) => Math.max(max, hooks.evasion ?? 0), 0);
  if (roll(ctx.rng, evasion)) {
    emit(ctx, { type: "missed", stackId: target.id, targetId: attacker.id });
    return 0;
  }

  // 2: base damage
  const [min, max] = unitOf(attacker).dmg;
  let damage = 0;
  for (let i = 0; i < attacker.count; i++) damage += rollRange(ctx.rng, min, max);

  // 3–6
  damage *= damageMultiplier(ctx.battle, hit);

  // 7: luck and criticals (main hits and retaliations only)
  if (!hit.splash) {
    const luck = luckOf(ctx.battle, attacker);
    if (roll(ctx.rng, 5 * Math.abs(luck))) {
      damage *= luck > 0 ? 2 : 0.5;
      emit(ctx, { type: "luck", stackId: attacker.id, detail: luck > 0 ? "double" : "half" });
    }
    for (const hooks of hooksOf(attacker)) {
      if (hooks.critical && roll(ctx.rng, hooks.critical.percent)) {
        damage *= hooks.critical.factor;
        emit(ctx, { type: "luck", stackId: attacker.id, detail: "critical" });
      }
    }
  }

  // 8: floor, min 1, apply
  const detail = hit.splash ? "splash" : hit.retaliation ? "retaliation" : undefined;
  const { dealt } = applyDamage(ctx, target, Math.max(1, Math.floor(damage)), { sourceId: attacker.id, detail });

  // 9: on-hit effects
  if (!hit.splash && dealt > 0) {
    for (const hooks of hooksOf(attacker)) hooks.onHit?.(ctx, hit, dealt);
    for (const hooks of hooksOf(target)) hooks.onHitTaken?.(ctx, hit, dealt);
    const bloodRing = bonusesOf(ctx.battle, attacker.seat).fx.meleeLifesteal;
    if (bloodRing > 0 && hit.mode === "melee" && !isShooter(attacker)) {
      healStack(ctx, attacker, Math.floor(dealt * bloodRing), false, "ring_blood");
    }
  }
  return dealt;
}

/** Step 10: area effects of the attacker's main hit. */
export function areaAfter(ctx: BattleCtx, hit: Hit): void {
  for (const hooks of hooksOf(hit.attacker)) {
    hooks.area?.(ctx, hit, (target, factor, magic) => {
      strike(ctx, { ...hit, target, factor, splash: true, magic, retaliation: false });
    });
  }
}
