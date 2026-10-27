"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMagicAttack = isMagicAttack;
exports.hasAdjacentEnemy = hasAdjacentEnemy;
exports.shotPenalties = shotPenalties;
exports.damageMultiplier = damageMultiplier;
exports.preview = preview;
exports.strike = strike;
exports.areaAfter = areaAfter;
const abilities_1 = require("./abilities");
const balance_1 = require("./balance");
const effects_1 = require("./effects");
const grid_1 = require("./grid");
const rng_1 = require("./rng");
const state_1 = require("./state");
const stats_1 = require("./stats");
/** Druid shots count as magic (stone skin). Hero abilities are handled in heroes.ts. */
function isMagicAttack(stack, mode) {
    return mode === "ranged" && (0, stats_1.hasAbility)(stack, "magic_shot");
}
function hasAdjacentEnemy(battle, stack) {
    return (0, state_1.livingStacks)(battle).some((other) => !(0, state_1.areAllies)(battle, other.seat, stack.seat) && (0, grid_1.isAdjacent)(other, stack));
}
function shotPenalties(battle, shooter, target) {
    const penalties = [];
    if ((0, grid_1.distance)(shooter, target) > (0, stats_1.rangeOf)(battle, shooter) && !(0, abilities_1.someHook)(shooter, (h) => h.ignoresRangePenalty)) {
        penalties.push("range");
    }
    if (hasAdjacentEnemy(battle, shooter) && !(0, abilities_1.someHook)(shooter, (h) => h.noMeleePenalty))
        penalties.push("adjacent");
    return penalties;
}
/** Steps 3–6: everything except the dice. Damage = Σ rolls × this. */
function damageMultiplier(battle, hit) {
    const { attacker, target } = hit;
    // 3–4: effective attack and defence, defence ignore, K_AD
    let defence = (0, stats_1.defenceOf)(battle, target);
    for (const hooks of (0, abilities_1.hooksOf)(attacker))
        defence *= hooks.defenceFactor?.(hit) ?? 1;
    let multiplier = (0, balance_1.kad)((0, stats_1.attackOf)(battle, attacker), defence);
    // 5: ranged modifiers
    if (hit.mode === "ranged") {
        multiplier *= 0.5 ** shotPenalties(battle, attacker, target).length;
        for (const hooks of (0, abilities_1.hooksOf)(target))
            multiplier *= hooks.takenFactor?.(hit) ?? 1;
        multiplier *= 1 + (0, stats_1.bonusesOf)(battle, target.seat).fx.rangedTaken;
    }
    else if ((0, stats_1.isShooter)(attacker) && !(0, abilities_1.someHook)(attacker, (h) => h.noMeleePenalty)) {
        multiplier *= 0.5;
    }
    // 6: attack modifiers and round buffs
    for (const hooks of (0, abilities_1.hooksOf)(attacker))
        multiplier *= hooks.attackFactor?.(battle, hit) ?? 1;
    if ((0, state_1.hasStatus)(attacker, "battle_cry"))
        multiplier *= 1 + 0.25 * ((0, state_1.getStatus)(attacker, "battle_cry").value ?? 1);
    if ((0, state_1.hasStatus)(attacker, "scream"))
        multiplier *= 0.75;
    if ((0, state_1.hasStatus)(target, "heavenly_shield"))
        multiplier *= 1 - 0.5 * ((0, state_1.getStatus)(target, "heavenly_shield").value ?? 1);
    if (hit.magic && (0, stats_1.raceOf)(battle, target) === "dwarves")
        multiplier *= 0.75;
    return multiplier * hit.factor;
}
function killsFor(target, damage) {
    const remaining = Math.max(0, (0, stats_1.totalHp)(target) - damage);
    return target.count - (remaining > 0 ? Math.ceil(remaining / (0, stats_1.unitOf)(target).hp) : 0);
}
/** Min/max damage and kills of one hit, without luck, evasion or on-hit effects (hints). */
function preview(battle, hit) {
    const full = { ...hit, factor: 1, splash: false, magic: isMagicAttack(hit.attacker, hit.mode) };
    const multiplier = damageMultiplier(battle, full);
    const [min, max] = (0, stats_1.unitOf)(hit.attacker).dmg;
    const low = Math.max(1, Math.floor(hit.attacker.count * min * multiplier));
    const high = Math.max(1, Math.floor(hit.attacker.count * max * multiplier));
    return { dmg: [low, high], kills: [killsFor(hit.target, low), killsFor(hit.target, high)] };
}
/**
 * One hit, steps 1–9 (+ step 10 through `areaAfter`). Returns the damage dealt (0 on a miss).
 * Splash hits skip luck, criticals and on-hit effects.
 */
function strike(ctx, hit) {
    const { attacker, target } = hit;
    if (!(0, state_1.isAlive)(attacker) || !(0, state_1.isAlive)(target))
        return 0;
    // magical splash (the lich cloud) passes over magic-immune stacks
    if (hit.magic && hit.splash && (0, abilities_1.isMagicImmune)(target))
        return 0;
    // 1: evasion
    const evasion = (0, abilities_1.hooksOf)(target).reduce((max, hooks) => Math.max(max, hooks.evasion ?? 0), 0);
    if ((0, rng_1.roll)(ctx.rng, evasion)) {
        (0, state_1.emit)(ctx, { type: "missed", stackId: target.id, targetId: attacker.id });
        return 0;
    }
    // 2: base damage
    const [min, max] = (0, stats_1.unitOf)(attacker).dmg;
    let damage = 0;
    for (let i = 0; i < attacker.count; i++)
        damage += (0, rng_1.rollRange)(ctx.rng, min, max);
    // 3–6
    damage *= damageMultiplier(ctx.battle, hit);
    // 7: luck and criticals (main hits and retaliations only)
    if (!hit.splash) {
        const luck = (0, stats_1.luckOf)(ctx.battle, attacker);
        if ((0, rng_1.roll)(ctx.rng, 5 * Math.abs(luck))) {
            damage *= luck > 0 ? 2 : 0.5;
            (0, state_1.emit)(ctx, { type: "luck", stackId: attacker.id, detail: luck > 0 ? "double" : "half" });
        }
        for (const hooks of (0, abilities_1.hooksOf)(attacker)) {
            if (hooks.critical && (0, rng_1.roll)(ctx.rng, hooks.critical.percent)) {
                damage *= hooks.critical.factor;
                (0, state_1.emit)(ctx, { type: "luck", stackId: attacker.id, detail: "critical" });
            }
        }
    }
    // 8: floor, min 1, apply
    const detail = hit.splash ? "splash" : hit.retaliation ? "retaliation" : undefined;
    const { dealt } = (0, effects_1.applyDamage)(ctx, target, Math.max(1, Math.floor(damage)), { sourceId: attacker.id, detail });
    // 9: on-hit effects
    if (!hit.splash && dealt > 0) {
        for (const hooks of (0, abilities_1.hooksOf)(attacker))
            hooks.onHit?.(ctx, hit, dealt);
        for (const hooks of (0, abilities_1.hooksOf)(target))
            hooks.onHitTaken?.(ctx, hit, dealt);
        const bloodRing = (0, stats_1.bonusesOf)(ctx.battle, attacker.seat).fx.meleeLifesteal;
        if (bloodRing > 0 && hit.mode === "melee" && !(0, stats_1.isShooter)(attacker)) {
            (0, effects_1.healStack)(ctx, attacker, Math.floor(dealt * bloodRing), false, "ring_blood");
        }
    }
    return dealt;
}
/** Step 10: area effects of the attacker's main hit. */
function areaAfter(ctx, hit) {
    for (const hooks of (0, abilities_1.hooksOf)(hit.attacker)) {
        hooks.area?.(ctx, hit, (target, factor, magic) => {
            strike(ctx, { ...hit, target, factor, splash: true, magic, retaliation: false });
        });
    }
}
//# sourceMappingURL=damage.js.map