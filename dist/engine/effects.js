"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyDamage = applyDamage;
exports.healStack = healStack;
exports.addStatus = addStatus;
exports.untilNextActivation = untilNextActivation;
exports.applySkip = applySkip;
exports.endOfActivationCleanup = endOfActivationCleanup;
const state_1 = require("./state");
const stats_1 = require("./stats");
/** Takes HP from the pool (top unit first), emits `damaged` and `stackDied`, records kills for necromancy. */
function applyDamage(ctx, target, amount, info = {}) {
    if (!(0, state_1.isAlive)(target) || amount <= 0)
        return { dealt: 0, kills: 0 };
    const hp = (0, stats_1.unitOf)(target).hp;
    const before = (0, stats_1.totalHp)(target);
    const after = Math.max(0, before - amount);
    const countBefore = target.count;
    target.count = after > 0 ? Math.ceil(after / hp) : 0;
    target.hpTop = after > 0 ? after - (target.count - 1) * hp : 0;
    const kills = countBefore - target.count;
    const dealt = before - after;
    (0, state_1.emit)(ctx, { type: "damaged", stackId: target.id, targetId: info.sourceId, amount: dealt, kills, detail: info.detail });
    if (kills > 0) {
        const entry = ctx.battle.killedThisRound.find((killed) => killed.seat === target.seat);
        if (entry)
            entry.hp += kills * hp;
        else
            ctx.battle.killedThisRound.push({ seat: target.seat, hp: kills * hp });
    }
    if (target.count === 0) {
        target.statuses = [];
        (0, state_1.emit)(ctx, { type: "stackDied", stackId: target.id, seat: target.seat, cell: { x: target.x, y: target.y } });
    }
    return { dealt, kills };
}
/**
 * Restores HP. Without `revive` only the top unit heals (heal, ring of blood, blood ritual).
 * With `revive` dead units of the stack come back, up to `startCount` (lifesteal, resurrection).
 * Returns the HP restored.
 */
function healStack(ctx, stack, amount, revive, abilityId) {
    if (!(0, state_1.isAlive)(stack) || amount <= 0)
        return 0;
    const hp = (0, stats_1.unitOf)(stack).hp;
    const before = (0, stats_1.totalHp)(stack);
    let after;
    if (revive) {
        after = Math.min(stack.startCount * hp, before + amount);
        if (after <= before)
            return 0;
        stack.count = Math.ceil(after / hp);
        stack.hpTop = after - (stack.count - 1) * hp;
    }
    else {
        const healed = Math.min(hp - stack.hpTop, amount);
        if (healed <= 0)
            return 0;
        stack.hpTop += healed;
        after = before + healed;
    }
    (0, state_1.emit)(ctx, {
        type: revive ? "resurrected" : "healed",
        stackId: stack.id,
        amount: after - before,
        abilityId: abilityId,
    });
    return after - before;
}
function addStatus(ctx, stack, status, sourceId) {
    if (!(0, state_1.isAlive)(stack))
        return;
    (0, state_1.setStatus)(stack, status);
    (0, state_1.emit)(ctx, { type: "statusApplied", stackId: stack.id, targetId: sourceId, statusId: status.id });
}
/** Ends after the target's next activation (counted from now, see StackState.activations). */
function untilNextActivation(stack) {
    return stack.activations + 1;
}
/**
 * Stun / fear / blind: the target loses its next activation. If it hasn't acted this round it loses this one
 * right away; otherwise it loses the first one of the next round (`skip_next`, consumed in turns.ts).
 */
function applySkip(ctx, target, cause, sourceId) {
    if (!(0, state_1.isAlive)(target))
        return;
    const now = !target.activated;
    if (now) {
        target.activated = true;
        target.activations += 1;
        (0, state_1.emit)(ctx, { type: "skipped", stackId: target.id, targetId: sourceId, detail: cause });
        endOfActivationCleanup(target);
    }
    else {
        addStatus(ctx, target, { id: "skip_next" }, sourceId);
    }
    if (cause === "blind") {
        // no retaliation until the skipped activation has passed
        addStatus(ctx, target, { id: "blinded", untilRound: now ? ctx.battle.round : ctx.battle.round + 1 }, sourceId);
    }
}
/** Statuses that last until a given activation end. */
function endOfActivationCleanup(stack) {
    stack.statuses = stack.statuses.filter((status) => status.untilActivation === undefined || status.untilActivation > stack.activations);
}
//# sourceMappingURL=effects.js.map