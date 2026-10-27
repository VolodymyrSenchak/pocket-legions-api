"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.availableStacks = availableStacks;
exports.actableStacks = actableStacks;
exports.startTurn = startTurn;
exports.startActivation = startActivation;
exports.rollsMoraleSkip = rollsMoraleSkip;
exports.finishActivation = finishActivation;
exports.advanceTurn = advanceTurn;
const effects_1 = require("./effects");
const rng_1 = require("./rng");
const state_1 = require("./state");
const stats_1 = require("./stats");
const victory_1 = require("./victory");
// Plan §6.5: alternating activation — each turn one stack that hasn't acted this round; rounds rotate the first seat.
function availableStacks(battle, seat) {
    return battle.stacks.filter((stack) => stack.seat === seat && (0, state_1.isAlive)(stack) && !stack.activated);
}
/** The stacks the active seat may act with right now. */
function actableStacks(battle) {
    if (battle.result)
        return [];
    if (battle.bonusStackId) {
        const bonus = battle.stacks.find((stack) => stack.id === battle.bonusStackId);
        return bonus && (0, state_1.isAlive)(bonus) ? [bonus] : [];
    }
    return availableStacks(battle, battle.activeSeat);
}
function isSeatPlaying(battle, seat) {
    return !battle.sides.find((side) => side.seat === seat).eliminated;
}
function startTurn(ctx, seat) {
    const { battle } = ctx;
    battle.activeSeat = seat;
    battle.turn += 1;
    battle.bonusStackId = null;
    battle.turnDeadline = new Date(ctx.nowMs + ctx.turnSeconds * 1000).toISOString();
    for (const hero of battle.heroes) {
        if (hero.seat === seat)
            hero.usedThisTurn = false;
    }
    (0, state_1.emit)(ctx, { type: "turnStarted", seat });
}
/** Called before the stack does anything in an activation (bonus actions included). */
function startActivation(stack) {
    stack.activated = true;
    stack.activations += 1;
    (0, state_1.removeStatus)(stack, "defending");
}
/** Negative morale: 5% × |morale| that the activation is lost. */
function rollsMoraleSkip(ctx, stack) {
    const morale = (0, stats_1.moraleOf)(ctx.battle, stack);
    if (morale >= 0 || !(0, rng_1.roll)(ctx.rng, 5 * -morale))
        return false;
    (0, state_1.emit)(ctx, { type: "morale", stackId: stack.id, detail: "skip" });
    return true;
}
/**
 * Ends the stack's activation: cleans up per-activation statuses, checks victory, then either grants
 * a morale bonus action (5% × morale) or passes the turn.
 */
function finishActivation(ctx, stack, allowMorale) {
    const { battle } = ctx;
    (0, effects_1.endOfActivationCleanup)(stack);
    if ((0, victory_1.checkVictory)(ctx))
        return;
    const wasBonus = battle.bonusStackId === stack.id;
    battle.bonusStackId = null;
    if (allowMorale && !wasBonus && (0, state_1.isAlive)(stack)) {
        const morale = (0, stats_1.moraleOf)(battle, stack);
        if (morale > 0 && (0, rng_1.roll)(ctx.rng, 5 * morale)) {
            battle.bonusStackId = stack.id;
            (0, state_1.emit)(ctx, { type: "morale", stackId: stack.id, detail: "again" });
            return;
        }
    }
    advanceTurn(ctx);
}
/** Next seat clockwise (from the active one) that has a stack left to act; a new round when nobody has. */
function advanceTurn(ctx) {
    const { battle } = ctx;
    battle.bonusStackId = null;
    const from = battle.order.indexOf(battle.activeSeat);
    for (let step = 1; step <= battle.order.length; step++) {
        const seat = battle.order[(from + step) % battle.order.length];
        if (isSeatPlaying(battle, seat) && availableStacks(battle, seat).length > 0) {
            startTurn(ctx, seat);
            return;
        }
    }
    nextRound(ctx);
}
function nextRound(ctx) {
    const { battle } = ctx;
    // a round in which every remaining stack is skipped (stun/fear) ends at once; the round limit bounds the loop
    while (!battle.result) {
        endRound(ctx);
        if (battle.result)
            return;
        if (battle.round >= state_1.ROUND_LIMIT) {
            (0, victory_1.finishOnPoints)(ctx);
            return;
        }
        startRound(ctx);
        const first = battle.order.indexOf(battle.firstSeat);
        for (let step = 0; step < battle.order.length; step++) {
            const seat = battle.order[(first + step) % battle.order.length];
            if (isSeatPlaying(battle, seat) && availableStacks(battle, seat).length > 0) {
                startTurn(ctx, seat);
                return;
            }
        }
    }
}
/** Burn ticks, vampire necromancy, expiry of round statuses and walls. */
function endRound(ctx) {
    const { battle } = ctx;
    for (const stack of battle.stacks) {
        const burning = (0, state_1.getStatus)(stack, "burning");
        if ((0, state_1.isAlive)(stack) && burning)
            (0, effects_1.applyDamage)(ctx, stack, burning.value ?? 1, { detail: "burn" });
    }
    for (const side of battle.sides) {
        if (side.eliminated || side.raceId !== "vampires")
            continue;
        const skeletons = battle.stacks.find((stack) => stack.seat === side.seat && stack.unitId === "skeleton" && (0, state_1.isAlive)(stack));
        if (!skeletons)
            continue;
        const enemyHp = battle.killedThisRound
            .filter((entry) => !(0, state_1.areAllies)(battle, entry.seat, side.seat))
            .reduce((sum, entry) => sum + entry.hp, 0);
        const raised = Math.floor((enemyHp * 0.15) / (0, stats_1.unitOf)(skeletons).hp);
        if (raised > 0) {
            skeletons.count += raised;
            (0, state_1.emit)(ctx, { type: "raised", stackId: skeletons.id, amount: raised });
        }
    }
    battle.killedThisRound = [];
    for (const stack of battle.stacks) {
        stack.statuses = stack.statuses.filter((status) => status.untilRound === undefined || status.untilRound > battle.round);
    }
    battle.walls = battle.walls.filter((wall) => wall.untilRound > battle.round);
    (0, victory_1.checkVictory)(ctx);
}
function startRound(ctx) {
    const { battle } = ctx;
    battle.round += 1;
    const previousFirst = battle.order.indexOf(battle.firstSeat);
    for (let step = 1; step <= battle.order.length; step++) {
        const seat = battle.order[(previousFirst + step) % battle.order.length];
        if (isSeatPlaying(battle, seat)) {
            battle.firstSeat = seat;
            break;
        }
    }
    (0, state_1.emit)(ctx, { type: "roundStarted", seat: battle.firstSeat });
    for (const stack of battle.stacks) {
        if (!(0, state_1.isAlive)(stack))
            continue;
        stack.activated = false;
        stack.retaliationsLeft = (0, stats_1.retaliationsPerRound)(battle, stack);
        if ((0, state_1.hasStatus)(stack, "skip_next")) {
            (0, state_1.removeStatus)(stack, "skip_next");
            startActivation(stack);
            (0, state_1.emit)(ctx, { type: "skipped", stackId: stack.id });
            (0, effects_1.endOfActivationCleanup)(stack);
        }
    }
}
//# sourceMappingURL=turns.js.map