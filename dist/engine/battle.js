"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.actableStacks = void 0;
exports.turnOrder = turnOrder;
exports.zoneFor = zoneFor;
exports.stackId = stackId;
exports.createBattle = createBattle;
exports.stackOptions = stackOptions;
exports.applyAct = applyAct;
exports.applyHeroAbility = applyHeroAbility;
exports.applyTimeout = applyTimeout;
exports.eliminateSeat = eliminateSeat;
const abilities_1 = require("./abilities");
const army_1 = require("./army");
const races_1 = require("./data/races");
const damage_1 = require("./damage");
const effects_1 = require("./effects");
const grid_1 = require("./grid");
const heroes_1 = require("./heroes");
const los_1 = require("./los");
const pathfinding_1 = require("./pathfinding");
const state_1 = require("./state");
const stats_1 = require("./stats");
const turns_1 = require("./turns");
Object.defineProperty(exports, "actableStacks", { enumerable: true, get: function () { return turns_1.actableStacks; } });
const victory_1 = require("./victory");
/** Turn order: seats ascending (clockwise); in 2 vs 2 the teams alternate. */
function turnOrder(mode, sides) {
    const seats = [...sides].sort((a, b) => a.seat - b.seat);
    if (mode !== "teams")
        return seats.map((side) => side.seat);
    const [a, b] = [0, 1].map((team) => seats.filter((side) => side.team === team).map((side) => side.seat));
    const order = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== undefined)
            order.push(a[i]);
        if (b[i] !== undefined)
            order.push(b[i]);
    }
    return order;
}
/**
 * Deploy zone of a seat (design §8). 2 players in FFA: left/right columns. Otherwise corners;
 * in 2 vs 2 team 0 takes the left corners (TL, BL) and team 1 the right ones (TR, BR).
 */
function zoneFor(map, mode, sides, seat, extraRows = 0) {
    const sorted = [...sides].sort((a, b) => a.seat - b.seat);
    const position = sorted.findIndex((side) => side.seat === seat);
    let layout = "four";
    let index = position;
    if (mode === "ffa" && sides.length === 2) {
        layout = "two";
    }
    else if (mode === "teams") {
        const team = sorted[position].team ?? 0;
        const mates = sorted.filter((side) => side.team === team);
        const corners = team === 0 ? [0, 3] : [1, 2];
        index = corners[mates.findIndex((side) => side.seat === seat)] ?? corners[0];
    }
    return (0, grid_1.deployZone)(map, layout, index, extraRows);
}
function stackId(seat, index) {
    return `s${seat}_${index}`;
}
function makeCtx(battle, env) {
    return { ...env, battle, map: (0, grid_1.getMap)(battle.mapId), out: [] };
}
/** Builds the battle from armies and deployments; a random seat opens round 1. */
function createBattle(setup, env) {
    const order = turnOrder(setup.mode, setup.sides);
    const battle = {
        mapId: setup.mapId,
        mode: setup.mode,
        round: 1,
        order,
        firstSeat: order[0],
        activeSeat: order[0],
        turnDeadline: new Date(env.nowMs).toISOString(),
        turn: 0,
        bonusStackId: null,
        sides: setup.sides.map((side) => ({
            seat: side.seat,
            team: setup.mode === "teams" ? side.team : null,
            raceId: side.raceId,
            items: (0, army_1.equippedItems)(side.army),
            eliminated: false,
        })),
        stacks: [],
        heroes: [],
        walls: [],
        killedThisRound: [],
        events: [],
        nextSeq: 1,
        result: null,
    };
    for (const side of [...setup.sides].sort((a, b) => a.seat - b.seat)) {
        const bonuses = (0, army_1.heroBonuses)(side.raceId, (0, army_1.equippedItems)(side.army));
        battle.heroes.push({
            seat: side.seat,
            abilityId: races_1.RACES[side.raceId].hero.ability.id,
            usesLeft: heroes_1.HERO_USES + bonuses.fx.heroUses,
            readyRound: 1,
            usedThisTurn: false,
        });
        side.army.stacks.forEach((bought, index) => {
            const placement = side.deployment.find((entry) => entry.stackIndex === index);
            const base = { seat: side.seat, unitId: bought.unitId };
            battle.stacks.push({
                id: stackId(side.seat, index),
                ...base,
                count: bought.count,
                hpTop: (0, stats_1.unitOf)(base).hp,
                startCount: bought.count,
                x: placement.x,
                y: placement.y,
                shots: (0, stats_1.startingShots)(battle, base),
                retaliationsLeft: (0, stats_1.retaliationsPerRound)(battle, base),
                activated: false,
                activations: 0,
                statuses: [],
                rage: 0,
                resurrectUsed: false,
            });
        });
    }
    const ctx = makeCtx(battle, env);
    battle.firstSeat = env.rng.pick(order);
    (0, state_1.emit)(ctx, { type: "battleStarted", seat: battle.firstSeat });
    (0, state_1.emit)(ctx, { type: "roundStarted", seat: battle.firstSeat });
    (0, turns_1.startTurn)(ctx, battle.firstSeat);
    return { battle, events: ctx.out };
}
function enemiesOf(battle, stack) {
    return (0, state_1.livingStacks)(battle).filter((other) => !(0, state_1.areAllies)(battle, other.seat, stack.seat));
}
function attackFrom(battle, stack, target, moves) {
    const here = { cell: (0, state_1.cellOf)(stack), path: [(0, state_1.cellOf)(stack)], cost: 0 };
    const from = [here, ...moves].filter((reach) => (0, grid_1.isAdjacent)(reach.cell, target));
    if ((0, abilities_1.someHook)(stack, (h) => h.flyOverAttack)) {
        const speed = (0, stats_1.speedOf)(battle, stack);
        const over = moves.filter((reach) => !from.includes(reach) && (0, grid_1.distance)(stack, target) + (0, grid_1.distance)(target, reach.cell) <= speed && !(0, grid_1.sameCell)(reach.cell, target));
        from.push(...over.map((reach) => ({ ...reach, path: [(0, state_1.cellOf)(stack), (0, state_1.cellOf)(target), reach.cell] })));
    }
    return from;
}
function abilityTargets(battle, stack, from) {
    const active = (0, abilities_1.activeAbilityOf)(stack);
    if (!active)
        return null;
    const { id, ability } = active;
    if (ability.target === "none")
        return { abilityId: id, targets: [] };
    const ctxLike = { battle };
    const targets = (0, state_1.livingStacks)(battle).filter((other) => (0, state_1.areAllies)(battle, other.seat, stack.seat) &&
        (ability.radius === null || (0, grid_1.distance)(other, from) <= ability.radius) &&
        ability.canTarget(ctxLike, stack, other));
    return targets.length ? { abilityId: id, targets } : null;
}
function stackOptions(battle, map, stack) {
    const moves = (0, pathfinding_1.reachable)(battle, map, stack);
    const enemies = enemiesOf(battle, stack);
    const attacks = enemies
        .map((target) => ({ target, from: attackFrom(battle, stack, target, moves) }))
        .filter((option) => option.from.length > 0);
    const shots = (0, stats_1.unitOf)(stack).ranged && stack.shots > 0
        ? enemies
            .filter((target) => (0, los_1.hasLineOfSight)(battle, map, (0, state_1.cellOf)(stack), (0, state_1.cellOf)(target)))
            .map((target) => ({ target, penalties: (0, damage_1.shotPenalties)(battle, stack, target) }))
        : [];
    const ability = abilityTargets(battle, stack, (0, state_1.cellOf)(stack));
    return { stack, moves, attacks, shots, abilities: ability ? [ability] : [], canDefend: true };
}
const illegal = (reason) => ({ ok: false, code: "illegal-action", reason });
function moveStack(ctx, stack, reach) {
    if (reach.cost === 0)
        return;
    stack.x = reach.cell.x;
    stack.y = reach.cell.y;
    (0, state_1.emit)(ctx, { type: "moved", stackId: stack.id, path: reach.path.map((cell) => ({ x: cell.x, y: cell.y })) });
}
function retaliate(ctx, attacker, defender) {
    if (!(0, state_1.isAlive)(attacker) || !(0, state_1.isAlive)(defender) || !(0, grid_1.isAdjacent)(attacker, defender))
        return;
    if ((0, abilities_1.someHook)(attacker, (h) => h.preventsRetaliation) || (0, state_1.hasStatus)(defender, "blinded"))
        return;
    const unlimited = (0, abilities_1.someHook)(defender, (h) => h.unlimitedRetaliation);
    if (!unlimited && defender.retaliationsLeft <= 0)
        return;
    if (!unlimited)
        defender.retaliationsLeft -= 1;
    (0, state_1.emit)(ctx, { type: "retaliated", stackId: defender.id, targetId: attacker.id });
    (0, damage_1.strike)(ctx, { attacker: defender, target: attacker, mode: "melee", retaliation: true, moved: 0, factor: 1, splash: false, magic: false });
}
function meleeAttack(ctx, stack, target, reach) {
    const start = (0, state_1.cellOf)(stack);
    const flyOver = !(0, grid_1.isAdjacent)(reach.cell, target);
    moveStack(ctx, stack, reach);
    (0, state_1.emit)(ctx, { type: "attacked", stackId: stack.id, targetId: target.id });
    const hit = { attacker: stack, target, mode: "melee", retaliation: false, moved: reach.cost, factor: 1, splash: false, magic: false };
    for (let i = 0; i < (0, stats_1.unitOf)(stack).hits; i++) {
        if (!(0, state_1.isAlive)(stack) || !(0, state_1.isAlive)(target))
            break;
        (0, damage_1.strike)(ctx, hit);
        if (i === 0) {
            (0, damage_1.areaAfter)(ctx, hit);
            if (!flyOver)
                retaliate(ctx, stack, target);
        }
    }
    if ((0, state_1.isAlive)(stack) && (0, abilities_1.someHook)(stack, (h) => h.returnsAfterAttack) && !(0, grid_1.sameCell)(start, stack)) {
        const back = { cell: start, path: [(0, state_1.cellOf)(stack), start], cost: (0, grid_1.distance)(start, stack) };
        moveStack(ctx, stack, back);
    }
}
function shoot(ctx, stack, target) {
    stack.shots -= 1;
    (0, state_1.emit)(ctx, { type: "shot", stackId: stack.id, targetId: target.id });
    const hit = { attacker: stack, target, mode: "ranged", retaliation: false, moved: 0, factor: 1, splash: false, magic: (0, damage_1.isMagicAttack)(stack, "ranged") };
    for (let i = 0; i < (0, stats_1.unitOf)(stack).hits; i++) {
        if (!(0, state_1.isAlive)(target))
            break;
        (0, damage_1.strike)(ctx, hit);
        if (i === 0)
            (0, damage_1.areaAfter)(ctx, { ...hit, magic: false });
    }
}
/** One `act` by the active seat (plan §7.3), validated against the same options the hints show. */
function applyAct(battle, seat, action, env) {
    if (battle.result)
        return illegal("battle-over");
    if (battle.activeSeat !== seat)
        return { ok: false, code: "not-your-turn", reason: "not-your-turn" };
    const stack = (0, turns_1.actableStacks)(battle).find((candidate) => candidate.id === action.stackId);
    if (!stack)
        return illegal("stack-cannot-act");
    const ctx = makeCtx(battle, env);
    const options = stackOptions(battle, ctx.map, stack);
    const targetOf = (id) => (id === undefined ? undefined : (0, state_1.findStack)(battle, id));
    // validate first; the morale roll comes after a legal choice
    let perform;
    let allowMorale = true;
    switch (action.kind) {
        case "move": {
            const reach = action.cell && options.moves.find((option) => (0, grid_1.sameCell)(option.cell, action.cell));
            if (!reach)
                return illegal("unreachable-cell");
            perform = () => moveStack(ctx, stack, reach);
            break;
        }
        case "attack": {
            const target = targetOf(action.target);
            const option = target && options.attacks.find((candidate) => candidate.target === target);
            if (!option)
                return illegal("bad-target");
            const cell = action.cell ?? (0, state_1.cellOf)(stack);
            const reach = option.from.find((candidate) => (0, grid_1.sameCell)(candidate.cell, cell));
            if (!reach)
                return illegal("bad-attack-cell");
            perform = () => meleeAttack(ctx, stack, option.target, reach);
            break;
        }
        case "shoot": {
            const target = targetOf(action.target);
            if (!target || !options.shots.some((option) => option.target === target))
                return illegal("bad-target");
            perform = () => shoot(ctx, stack, target);
            break;
        }
        case "ability": {
            const active = (0, abilities_1.activeAbilityOf)(stack);
            if (!active)
                return illegal("no-ability");
            const reach = action.cell ? (0, pathfinding_1.findReach)(battle, ctx.map, stack, action.cell) : (0, pathfinding_1.findReach)(battle, ctx.map, stack, (0, state_1.cellOf)(stack));
            if (!reach)
                return illegal("unreachable-cell");
            const option = abilityTargets(battle, stack, reach.cell);
            if (!option)
                return illegal("no-targets");
            let target = null;
            if (active.ability.target === "ally") {
                target = option.targets.find((candidate) => candidate.id === action.target) ?? null;
                if (!target)
                    return illegal("bad-target");
            }
            perform = () => {
                moveStack(ctx, stack, reach);
                (0, state_1.emit)(ctx, { type: "abilityUsed", stackId: stack.id, targetId: target?.id, abilityId: active.id });
                active.ability.apply(ctx, stack, target);
            };
            break;
        }
        case "defend": {
            allowMorale = false;
            perform = () => {
                (0, effects_1.addStatus)(ctx, stack, { id: "defending" });
                (0, state_1.emit)(ctx, { type: "defended", stackId: stack.id });
            };
            break;
        }
        default:
            return illegal("unknown-kind");
    }
    const bonus = battle.bonusStackId === stack.id;
    (0, turns_1.startActivation)(stack);
    if (!bonus && (0, turns_1.rollsMoraleSkip)(ctx, stack)) {
        (0, turns_1.finishActivation)(ctx, stack, false);
        return { ok: true, events: ctx.out };
    }
    perform();
    (0, turns_1.finishActivation)(ctx, stack, allowMorale);
    return { ok: true, events: ctx.out };
}
/** After damage outside an activation (hero ability, surrender): end the battle or skip a seat that has nothing left. */
function settle(ctx) {
    if ((0, victory_1.checkVictory)(ctx))
        return;
    if ((0, turns_1.actableStacks)(ctx.battle).length === 0)
        (0, turns_1.advanceTurn)(ctx);
}
function applyHeroAbility(battle, seat, payload, env) {
    if (battle.result)
        return illegal("battle-over");
    if (battle.activeSeat !== seat)
        return { ok: false, code: "not-your-turn", reason: "not-your-turn" };
    const ctx = makeCtx(battle, env);
    const used = (0, heroes_1.useHeroAbility)(ctx, seat, payload);
    if (!used.ok)
        return illegal(used.reason);
    settle(ctx);
    return { ok: true, events: ctx.out };
}
/** Turn timer ran out (plan §3.5): the first stack that hasn't acted defends and the turn passes. */
function applyTimeout(battle, env) {
    const ctx = makeCtx(battle, env);
    if (battle.result)
        return ctx.out;
    (0, state_1.emit)(ctx, { type: "timedOut", seat: battle.activeSeat });
    if (battle.bonusStackId) {
        (0, turns_1.advanceTurn)(ctx);
        return ctx.out;
    }
    const stack = [...(0, turns_1.actableStacks)(battle)].sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!stack) {
        (0, turns_1.advanceTurn)(ctx);
        return ctx.out;
    }
    (0, turns_1.startActivation)(stack);
    (0, effects_1.addStatus)(ctx, stack, { id: "defending" });
    (0, state_1.emit)(ctx, { type: "defended", stackId: stack.id });
    (0, turns_1.finishActivation)(ctx, stack, false);
    return ctx.out;
}
/** Surrender, auto-surrender or leaving: the seat's stacks leave the field. */
function eliminateSeat(battle, seat, env, reason) {
    const ctx = makeCtx(battle, env);
    const side = (0, state_1.sideOf)(battle, seat);
    if (battle.result || side.eliminated)
        return ctx.out;
    (0, state_1.emit)(ctx, { type: "surrendered", seat, reason });
    for (const stack of battle.stacks) {
        if (stack.seat === seat && (0, state_1.isAlive)(stack)) {
            stack.count = 0;
            stack.hpTop = 0;
            stack.statuses = [];
        }
    }
    side.eliminated = true;
    (0, state_1.emit)(ctx, { type: "playerEliminated", seat, reason });
    if ((0, victory_1.checkVictory)(ctx, "surrender"))
        return ctx.out;
    if (battle.activeSeat === seat)
        (0, turns_1.advanceTurn)(ctx);
    return ctx.out;
}
//# sourceMappingURL=battle.js.map