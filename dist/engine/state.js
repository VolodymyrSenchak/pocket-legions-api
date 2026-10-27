"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROUND_LIMIT = exports.EVENTS_IN_STATE = void 0;
exports.emit = emit;
exports.isAlive = isAlive;
exports.livingStacks = livingStacks;
exports.findStack = findStack;
exports.sideOf = sideOf;
exports.areAllies = areAllies;
exports.stackAt = stackAt;
exports.cellOf = cellOf;
exports.hasStatus = hasStatus;
exports.getStatus = getStatus;
exports.setStatus = setStatus;
exports.removeStatus = removeStatus;
exports.EVENTS_IN_STATE = 64;
exports.ROUND_LIMIT = 30;
function emit(ctx, event) {
    const full = { seq: ctx.battle.nextSeq++, round: ctx.battle.round, ...event };
    ctx.battle.events.push(full);
    if (ctx.battle.events.length > exports.EVENTS_IN_STATE) {
        ctx.battle.events.splice(0, ctx.battle.events.length - exports.EVENTS_IN_STATE);
    }
    ctx.out.push(full);
    return full;
}
function isAlive(stack) {
    return stack.count > 0;
}
function livingStacks(battle) {
    return battle.stacks.filter(isAlive);
}
function findStack(battle, id) {
    return battle.stacks.find((stack) => stack.id === id);
}
function sideOf(battle, seat) {
    const side = battle.sides.find((candidate) => candidate.seat === seat);
    if (!side) {
        throw new Error(`No side for seat ${seat}`);
    }
    return side;
}
/** Own seat, or the teammate in 2 vs 2. */
function areAllies(battle, seatA, seatB) {
    if (seatA === seatB)
        return true;
    if (battle.mode !== "teams")
        return false;
    return sideOf(battle, seatA).team === sideOf(battle, seatB).team;
}
function stackAt(battle, cell) {
    return battle.stacks.find((stack) => isAlive(stack) && stack.x === cell.x && stack.y === cell.y);
}
function cellOf(stack) {
    return { x: stack.x, y: stack.y };
}
function hasStatus(stack, id) {
    return stack.statuses.some((status) => status.id === id);
}
function getStatus(stack, id) {
    return stack.statuses.find((status) => status.id === id);
}
/** Replaces an existing status of the same id. */
function setStatus(stack, status) {
    stack.statuses = stack.statuses.filter((existing) => existing.id !== status.id);
    stack.statuses.push(status);
}
function removeStatus(stack, id) {
    stack.statuses = stack.statuses.filter((status) => status.id !== id);
}
//# sourceMappingURL=state.js.map