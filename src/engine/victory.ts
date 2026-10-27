import { BattleCtx, BattleEndReason, BattleState, emit, isAlive, ROUND_LIMIT } from "./state";
import { stackPoints } from "./stats";

// Plan §6.8: FFA — the last seat with living stacks wins; 2 vs 2 — the last team. Round 30 ends the battle on points.

/** Groups that still fight: one per seat in FFA, one per team in 2 vs 2. */
function groupsOf(battle: BattleState): number[][] {
  if (battle.mode === "teams") {
    return [0, 1].map((team) => battle.sides.filter((side) => side.team === team).map((side) => side.seat));
  }
  return battle.sides.map((side) => [side.seat]);
}

function isGroupAlive(battle: BattleState, seats: number[]): boolean {
  return seats.some((seat) => !battle.sides.find((side) => side.seat === seat)!.eliminated);
}

/** Marks seats without living stacks as eliminated. */
export function updateEliminations(ctx: BattleCtx): void {
  for (const side of ctx.battle.sides) {
    if (side.eliminated) continue;
    if (!ctx.battle.stacks.some((stack) => stack.seat === side.seat && isAlive(stack))) {
      side.eliminated = true;
      emit(ctx, { type: "playerEliminated", seat: side.seat, reason: "defeated" });
    }
  }
}

function finish(ctx: BattleCtx, winnerSeats: number[], reason: BattleEndReason, points?: number[]): void {
  const sorted = [...winnerSeats].sort((a, b) => a - b);
  ctx.battle.result = { winnerSeats: sorted, reason, ...(points ? { points } : {}) };
  emit(ctx, { type: "battleOver", winnerSeats: sorted, reason, ...(points ? { points } : {}) });
}

/** Ends the battle when at most one group is left. Returns true if the battle is over. */
export function checkVictory(ctx: BattleCtx, reason: BattleEndReason = "elimination"): boolean {
  if (ctx.battle.result) return true;
  updateEliminations(ctx);
  const alive = groupsOf(ctx.battle).filter((seats) => isGroupAlive(ctx.battle, seats));
  if (alive.length > 1) return false;
  finish(ctx, alive[0] ?? [], reason);
  return true;
}

/** Points of living army per seat, in `battle.order`. */
export function armyPoints(battle: BattleState): number[] {
  return battle.order.map((seat) =>
    battle.stacks.filter((stack) => stack.seat === seat && isAlive(stack)).reduce((sum, stack) => sum + stackPoints(stack), 0)
  );
}

/** After round 30: the group with the most points of living army wins; ties stay ties. */
export function finishOnPoints(ctx: BattleCtx): void {
  const points = armyPoints(ctx.battle);
  const pointsOf = (seat: number) => points[ctx.battle.order.indexOf(seat)];
  const groups = groupsOf(ctx.battle).filter((seats) => isGroupAlive(ctx.battle, seats));
  const totals = groups.map((seats) => seats.reduce((sum, seat) => sum + pointsOf(seat), 0));
  const best = Math.max(...totals);
  finish(ctx, groups.filter((_, i) => totals[i] === best).flat(), "round-limit", points);
}

export { ROUND_LIMIT };
