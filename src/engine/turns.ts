import { applyDamage, endOfActivationCleanup } from "./effects";
import { roll } from "./rng";
import {
  areAllies,
  BattleCtx,
  BattleState,
  emit,
  getStatus,
  hasStatus,
  isAlive,
  removeStatus,
  ROUND_LIMIT,
  StackState,
} from "./state";
import { moraleOf, retaliationsPerRound, unitOf } from "./stats";
import { checkVictory, finishOnPoints } from "./victory";

// Plan §6.5: alternating activation — each turn one stack that hasn't acted this round; rounds rotate the first seat.

export function availableStacks(battle: BattleState, seat: number): StackState[] {
  return battle.stacks.filter((stack) => stack.seat === seat && isAlive(stack) && !stack.activated);
}

/** The stacks the active seat may act with right now. */
export function actableStacks(battle: BattleState): StackState[] {
  if (battle.result) return [];
  if (battle.bonusStackId) {
    const bonus = battle.stacks.find((stack) => stack.id === battle.bonusStackId);
    return bonus && isAlive(bonus) ? [bonus] : [];
  }
  return availableStacks(battle, battle.activeSeat);
}

function isSeatPlaying(battle: BattleState, seat: number): boolean {
  return !battle.sides.find((side) => side.seat === seat)!.eliminated;
}

export function startTurn(ctx: BattleCtx, seat: number): void {
  const { battle } = ctx;
  battle.activeSeat = seat;
  battle.turn += 1;
  battle.bonusStackId = null;
  battle.turnDeadline = new Date(ctx.nowMs + ctx.turnSeconds * 1000).toISOString();
  for (const hero of battle.heroes) {
    if (hero.seat === seat) hero.usedThisTurn = false;
  }
  emit(ctx, { type: "turnStarted", seat });
}

/** Called before the stack does anything in an activation (bonus actions included). */
export function startActivation(stack: StackState): void {
  stack.activated = true;
  stack.activations += 1;
  removeStatus(stack, "defending");
}

/** Negative morale: 5% × |morale| that the activation is lost. */
export function rollsMoraleSkip(ctx: BattleCtx, stack: StackState): boolean {
  const morale = moraleOf(ctx.battle, stack);
  if (morale >= 0 || !roll(ctx.rng, 5 * -morale)) return false;
  emit(ctx, { type: "morale", stackId: stack.id, detail: "skip" });
  return true;
}

/**
 * Ends the stack's activation: cleans up per-activation statuses, checks victory, then either grants
 * a morale bonus action (5% × morale) or passes the turn.
 */
export function finishActivation(ctx: BattleCtx, stack: StackState, allowMorale: boolean): void {
  const { battle } = ctx;
  endOfActivationCleanup(stack);
  if (checkVictory(ctx)) return;
  const wasBonus = battle.bonusStackId === stack.id;
  battle.bonusStackId = null;
  if (allowMorale && !wasBonus && isAlive(stack)) {
    const morale = moraleOf(battle, stack);
    if (morale > 0 && roll(ctx.rng, 5 * morale)) {
      battle.bonusStackId = stack.id;
      emit(ctx, { type: "morale", stackId: stack.id, detail: "again" });
      return;
    }
  }
  advanceTurn(ctx);
}

/** Next seat clockwise (from the active one) that has a stack left to act; a new round when nobody has. */
export function advanceTurn(ctx: BattleCtx): void {
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

function nextRound(ctx: BattleCtx): void {
  const { battle } = ctx;
  // a round in which every remaining stack is skipped (stun/fear) ends at once; the round limit bounds the loop
  while (!battle.result) {
    endRound(ctx);
    if (battle.result) return;
    if (battle.round >= ROUND_LIMIT) {
      finishOnPoints(ctx);
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
function endRound(ctx: BattleCtx): void {
  const { battle } = ctx;
  for (const stack of battle.stacks) {
    const burning = getStatus(stack, "burning");
    if (isAlive(stack) && burning) applyDamage(ctx, stack, burning.value ?? 1, { detail: "burn" });
  }

  for (const side of battle.sides) {
    if (side.eliminated || side.raceId !== "vampires") continue;
    const skeletons = battle.stacks.find((stack) => stack.seat === side.seat && stack.unitId === "skeleton" && isAlive(stack));
    if (!skeletons) continue;
    const enemyHp = battle.killedThisRound
      .filter((entry) => !areAllies(battle, entry.seat, side.seat))
      .reduce((sum, entry) => sum + entry.hp, 0);
    const raised = Math.floor((enemyHp * 0.15) / unitOf(skeletons).hp);
    if (raised > 0) {
      skeletons.count += raised;
      emit(ctx, { type: "raised", stackId: skeletons.id, amount: raised });
    }
  }
  battle.killedThisRound = [];

  for (const stack of battle.stacks) {
    stack.statuses = stack.statuses.filter((status) => status.untilRound === undefined || status.untilRound > battle.round);
  }
  battle.walls = battle.walls.filter((wall) => wall.untilRound > battle.round);
  checkVictory(ctx);
}

function startRound(ctx: BattleCtx): void {
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
  emit(ctx, { type: "roundStarted", seat: battle.firstSeat });
  for (const stack of battle.stacks) {
    if (!isAlive(stack)) continue;
    stack.activated = false;
    stack.retaliationsLeft = retaliationsPerRound(battle, stack);
    if (hasStatus(stack, "skip_next")) {
      removeStatus(stack, "skip_next");
      startActivation(stack);
      emit(ctx, { type: "skipped", stackId: stack.id });
      endOfActivationCleanup(stack);
    }
  }
}
