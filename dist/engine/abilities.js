"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ABILITY_IDS = exports.ABILITY_HOOKS = void 0;
exports.isMagicImmune = isMagicImmune;
exports.hooksOf = hooksOf;
exports.someHook = someHook;
exports.activeAbilityOf = activeAbilityOf;
const abilities_1 = require("./data/abilities");
Object.defineProperty(exports, "ABILITY_IDS", { enumerable: true, get: function () { return abilities_1.ABILITY_IDS; } });
const effects_1 = require("./effects");
const grid_1 = require("./grid");
const rng_1 = require("./rng");
const state_1 = require("./state");
const stats_1 = require("./stats");
const ally = (ctx, a, b) => (0, state_1.areAllies)(ctx.battle, a.seat, b.seat);
const enemiesAround = (ctx, center, of) => (0, state_1.livingStacks)(ctx.battle).filter((stack) => !ally(ctx, stack, of) && (0, grid_1.isAdjacent)(stack, center));
function isMagicImmune(stack) {
    return (0, stats_1.hasAbility)(stack, "magic_immune");
}
/** Undead ignore fear, disease and blindness (design §5). */
function resists(ctx, target, effect) {
    return (0, stats_1.isUndead)(ctx.battle, target) && ["fear", "disease", "blind"].includes(effect);
}
function skipOnHit(effect, percent) {
    return (ctx, hit) => {
        if (!(0, state_1.isAlive)(hit.target) || (effect !== "stun" && resists(ctx, hit.target, effect)))
            return;
        if ((0, rng_1.roll)(ctx.rng, percent))
            (0, effects_1.applySkip)(ctx, hit.target, effect, hit.attacker.id);
    };
}
function buff(id) {
    return {
        target: "ally",
        radius: 3,
        canTarget: () => true,
        apply: (ctx, caster, target) => (0, effects_1.addStatus)(ctx, target, { id, untilRound: ctx.battle.round }, caster.id),
    };
}
exports.ABILITY_HOOKS = {
    shield: { takenFactor: (hit) => (hit.mode === "ranged" ? 0.5 : 1) },
    bone: { takenFactor: (hit) => (hit.mode === "ranged" ? 0.5 : 1) },
    no_retal: { preventsRetaliation: true },
    unlim_retal: { unlimitedRetaliation: true },
    double_strike: { doubleHit: "melee" },
    double_shot: { doubleHit: "ranged" },
    charge: {
        attackFactor: (_battle, hit) => (hit.mode === "melee" && !hit.retaliation ? 1 + 0.06 * Math.min(hit.moved, 6) : 1),
    },
    piercing: { defenceFactor: () => 0.6 },
    heal: {
        active: {
            target: "ally",
            radius: 3,
            canTarget: (_ctx, _caster, target) => target.hpTop < (0, stats_1.unitOf)(target).hp,
            apply: (ctx, caster, target) => {
                (0, effects_1.healStack)(ctx, target, 4 * caster.count, false, "heal");
            },
        },
    },
    holy: {
        attackFactor: (battle, hit) => (["vampires", "demons"].includes((0, stats_1.raceOf)(battle, hit.target)) ? 1.5 : 1),
    },
    resurrect: {
        active: {
            target: "ally",
            radius: null,
            canTarget: (_ctx, caster, target) => !caster.resurrectUsed && target.count < target.startCount,
            apply: (ctx, caster, target) => {
                caster.resurrectUsed = true;
                (0, effects_1.healStack)(ctx, target, 40 * caster.count, true, "resurrect");
            },
        },
    },
    disease: {
        onHit: (ctx, hit) => {
            if ((0, state_1.isAlive)(hit.target) && !resists(ctx, hit.target, "disease")) {
                (0, effects_1.addStatus)(ctx, hit.target, { id: "diseased", untilRound: ctx.battle.round + 1 }, hit.attacker.id);
            }
        },
    },
    evasion: { evasion: 25 },
    scream: {
        active: {
            target: "none",
            radius: 2,
            canTarget: () => false,
            apply: (ctx, caster) => {
                for (const enemy of (0, state_1.livingStacks)(ctx.battle)) {
                    if (!ally(ctx, enemy, caster) && (0, grid_1.distance)(enemy, caster) <= 2 && !isMagicImmune(enemy)) {
                        (0, effects_1.addStatus)(ctx, enemy, { id: "scream", untilRound: ctx.battle.round }, caster.id);
                    }
                }
            },
        },
    },
    lifesteal: {
        onHit: (ctx, hit, dealt) => {
            (0, effects_1.healStack)(ctx, hit.attacker, Math.floor(dealt * 0.5), true, "lifesteal");
        },
    },
    aoe_cloud: {
        area: (ctx, hit, splash) => {
            if (hit.mode !== "ranged")
                return;
            for (const d of grid_1.DIRECTIONS) {
                const stack = (0, state_1.stackAt)(ctx.battle, { x: hit.target.x + d.x, y: hit.target.y + d.y });
                if (stack)
                    splash(stack, 1, true);
            }
        },
    },
    deathblow: { critical: { percent: 20, factor: 2 } },
    fear: { onHit: skipOnHit("fear", 15) },
    hit_and_run: { preventsRetaliation: true, returnsAfterAttack: true },
    war_drum: { active: buff("war_drum") },
    no_melee_pen: { noMeleePenalty: true },
    stun: { onHit: skipOnHit("stun", 20) },
    lightning: {
        onHit: (ctx, hit, dealt) => {
            if (!(0, state_1.isAlive)(hit.target) || isMagicImmune(hit.target) || !(0, rng_1.roll)(ctx.rng, 25))
                return;
            const stoneSkin = (0, stats_1.raceOf)(ctx.battle, hit.target) === "dwarves" ? 0.75 : 1;
            (0, effects_1.applyDamage)(ctx, hit.target, Math.max(1, Math.floor(dealt * 0.5 * stoneSkin)), {
                sourceId: hit.attacker.id,
                detail: "lightning",
            });
        },
    },
    whirlwind: {
        area: (ctx, hit, splash) => {
            if (hit.mode !== "melee")
                return;
            for (const enemy of enemiesAround(ctx, (0, state_1.cellOf)(hit.attacker), hit.attacker)) {
                if (enemy !== hit.target)
                    splash(enemy, 1, false);
            }
        },
    },
    boulder: {
        area: (ctx, hit, splash) => {
            if (hit.mode !== "ranged")
                return;
            for (const enemy of enemiesAround(ctx, (0, state_1.cellOf)(hit.target), hit.attacker))
                splash(enemy, 1, false);
        },
    },
    magic_shot: {
        defenceFactor: (hit) => (hit.mode === "ranged" && !isMagicImmune(hit.target) ? 0.5 : 1),
        ignoresRangePenalty: true,
    },
    blind: { onHit: skipOnHit("blind", 20) },
    entangle: {
        onHit: (_ctx, hit) => {
            if ((0, state_1.isAlive)(hit.target)) {
                (0, effects_1.addStatus)(_ctx, hit.target, { id: "entangled", untilActivation: (0, effects_1.untilNextActivation)(hit.target) }, hit.attacker.id);
            }
        },
    },
    breath: {
        area: (ctx, hit, splash) => {
            if (hit.mode !== "melee")
                return;
            const behind = {
                x: hit.target.x + Math.sign(hit.target.x - hit.attacker.x),
                y: hit.target.y + Math.sign(hit.target.y - hit.attacker.y),
            };
            const stack = (0, state_1.stackAt)(ctx.battle, behind);
            if (stack && stack !== hit.attacker)
                splash(stack, 1, false);
        },
    },
    maim: {
        onHit: (ctx, hit) => {
            if ((0, state_1.isAlive)(hit.target)) {
                (0, effects_1.addStatus)(ctx, hit.target, { id: "maimed", untilActivation: (0, effects_1.untilNextActivation)(hit.target) }, hit.attacker.id);
            }
        },
    },
    rune_shield: { active: buff("rune_shield") },
    rage: {
        onHitTaken: (_ctx, hit) => {
            if ((0, state_1.isAlive)(hit.target))
                hit.target.rage = Math.min(6, hit.target.rage + 2);
        },
    },
    bombard: { preventsRetaliation: true, flyOverAttack: true },
    magic_immune: { magicImmune: true },
    thunderclap: {
        area: (ctx, hit, splash) => {
            if (hit.mode !== "melee")
                return;
            for (const enemy of enemiesAround(ctx, (0, state_1.cellOf)(hit.target), hit.attacker)) {
                if (enemy !== hit.target && enemy !== hit.attacker)
                    splash(enemy, 0.5, false);
            }
        },
    },
    chain_shot: {
        area: (ctx, hit, splash) => {
            if (hit.mode !== "ranged")
                return;
            const next = (0, state_1.livingStacks)(ctx.battle)
                .filter((stack) => stack !== hit.target && !ally(ctx, stack, hit.attacker) && (0, grid_1.distance)(stack, hit.target) <= 2)
                .sort((a, b) => (0, grid_1.distance)(a, hit.target) - (0, grid_1.distance)(b, hit.target) || a.id.localeCompare(b.id))[0];
            if (next)
                splash(next, 0.5, false);
        },
    },
    teleport: { movement: "teleport" },
    fire_shield: {
        onHitTaken: (ctx, hit, dealt) => {
            const reflected = Math.floor(dealt * 0.2);
            if (hit.mode === "melee" && reflected > 0 && (0, state_1.isAlive)(hit.attacker)) {
                (0, effects_1.applyDamage)(ctx, hit.attacker, reflected, { sourceId: hit.target.id, detail: "reflect" });
            }
        },
    },
    burn: {
        onHit: (ctx, hit, dealt) => {
            if ((0, state_1.isAlive)(hit.target)) {
                const perRound = Math.max(1, Math.floor(dealt * 0.15));
                (0, effects_1.addStatus)(ctx, hit.target, { id: "burning", untilRound: ctx.battle.round + 1, value: perRound }, hit.attacker.id);
            }
        },
    },
};
function hooksOf(stack) {
    return (0, stats_1.unitOf)(stack).abilities.map((id) => exports.ABILITY_HOOKS[id]);
}
function someHook(stack, predicate) {
    return hooksOf(stack).some((hooks) => Boolean(predicate(hooks)));
}
/** The unit's support ability, if it has one (no unit has two). */
function activeAbilityOf(stack) {
    for (const id of (0, stats_1.unitOf)(stack).abilities) {
        const ability = exports.ABILITY_HOOKS[id].active;
        if (ability)
            return { id, ability };
    }
    return null;
}
//# sourceMappingURL=abilities.js.map