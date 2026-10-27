"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROUND_LIMIT = void 0;
exports.updateEliminations = updateEliminations;
exports.checkVictory = checkVictory;
exports.armyPoints = armyPoints;
exports.finishOnPoints = finishOnPoints;
const state_1 = require("./state");
Object.defineProperty(exports, "ROUND_LIMIT", { enumerable: true, get: function () { return state_1.ROUND_LIMIT; } });
const stats_1 = require("./stats");
// Plan §6.8: FFA — the last seat with living stacks wins; 2 vs 2 — the last team. Round 30 ends the battle on points.
/** Groups that still fight: one per seat in FFA, one per team in 2 vs 2. */
function groupsOf(battle) {
    if (battle.mode === "teams") {
        return [0, 1].map((team) => battle.sides.filter((side) => side.team === team).map((side) => side.seat));
    }
    return battle.sides.map((side) => [side.seat]);
}
function isGroupAlive(battle, seats) {
    return seats.some((seat) => !battle.sides.find((side) => side.seat === seat).eliminated);
}
/** Marks seats without living stacks as eliminated. */
function updateEliminations(ctx) {
    for (const side of ctx.battle.sides) {
        if (side.eliminated)
            continue;
        if (!ctx.battle.stacks.some((stack) => stack.seat === side.seat && (0, state_1.isAlive)(stack))) {
            side.eliminated = true;
            (0, state_1.emit)(ctx, { type: "playerEliminated", seat: side.seat, reason: "defeated" });
        }
    }
}
function finish(ctx, winnerSeats, reason, points) {
    const sorted = [...winnerSeats].sort((a, b) => a - b);
    ctx.battle.result = { winnerSeats: sorted, reason, ...(points ? { points } : {}) };
    (0, state_1.emit)(ctx, { type: "battleOver", winnerSeats: sorted, reason, ...(points ? { points } : {}) });
}
/** Ends the battle when at most one group is left. Returns true if the battle is over. */
function checkVictory(ctx, reason = "elimination") {
    if (ctx.battle.result)
        return true;
    updateEliminations(ctx);
    const alive = groupsOf(ctx.battle).filter((seats) => isGroupAlive(ctx.battle, seats));
    if (alive.length > 1)
        return false;
    finish(ctx, alive[0] ?? [], reason);
    return true;
}
/** Points of living army per seat, in `battle.order`. */
function armyPoints(battle) {
    return battle.order.map((seat) => battle.stacks.filter((stack) => stack.seat === seat && (0, state_1.isAlive)(stack)).reduce((sum, stack) => sum + (0, stats_1.stackPoints)(stack), 0));
}
/** After round 30: the group with the most points of living army wins; ties stay ties. */
function finishOnPoints(ctx) {
    const points = armyPoints(ctx.battle);
    const pointsOf = (seat) => points[ctx.battle.order.indexOf(seat)];
    const groups = groupsOf(ctx.battle).filter((seats) => isGroupAlive(ctx.battle, seats));
    const totals = groups.map((seats) => seats.reduce((sum, seat) => sum + pointsOf(seat), 0));
    const best = Math.max(...totals);
    finish(ctx, groups.filter((_, i) => totals[i] === best).flat(), "round-limit", points);
}
//# sourceMappingURL=victory.js.map