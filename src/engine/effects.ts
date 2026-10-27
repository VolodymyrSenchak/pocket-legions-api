import { BattleCtx, emit, isAlive, setStatus, StackState, Status, StatusId } from "./state";
import { totalHp, unitOf } from "./stats";

// Low-level changes to stacks shared by damage, abilities, heroes and round-end effects.

export interface DamageOutcome {
  dealt: number;
  kills: number;
}

/** Takes HP from the pool (top unit first), emits `damaged` and `stackDied`, records kills for necromancy. */
export function applyDamage(
  ctx: BattleCtx,
  target: StackState,
  amount: number,
  info: { sourceId?: string; detail?: string } = {}
): DamageOutcome {
  if (!isAlive(target) || amount <= 0) return { dealt: 0, kills: 0 };
  const hp = unitOf(target).hp;
  const before = totalHp(target);
  const after = Math.max(0, before - amount);
  const countBefore = target.count;
  target.count = after > 0 ? Math.ceil(after / hp) : 0;
  target.hpTop = after > 0 ? after - (target.count - 1) * hp : 0;
  const kills = countBefore - target.count;
  const dealt = before - after;
  emit(ctx, { type: "damaged", stackId: target.id, targetId: info.sourceId, amount: dealt, kills, detail: info.detail });
  if (kills > 0) {
    const entry = ctx.battle.killedThisRound.find((killed) => killed.seat === target.seat);
    if (entry) entry.hp += kills * hp;
    else ctx.battle.killedThisRound.push({ seat: target.seat, hp: kills * hp });
  }
  if (target.count === 0) {
    target.statuses = [];
    emit(ctx, { type: "stackDied", stackId: target.id, seat: target.seat, cell: { x: target.x, y: target.y } });
  }
  return { dealt, kills };
}

/**
 * Restores HP. Without `revive` only the top unit heals (heal, ring of blood, blood ritual).
 * With `revive` dead units of the stack come back, up to `startCount` (lifesteal, resurrection).
 * Returns the HP restored.
 */
export function healStack(ctx: BattleCtx, stack: StackState, amount: number, revive: boolean, abilityId?: string): number {
  if (!isAlive(stack) || amount <= 0) return 0;
  const hp = unitOf(stack).hp;
  const before = totalHp(stack);
  let after: number;
  if (revive) {
    after = Math.min(stack.startCount * hp, before + amount);
    if (after <= before) return 0;
    stack.count = Math.ceil(after / hp);
    stack.hpTop = after - (stack.count - 1) * hp;
  } else {
    const healed = Math.min(hp - stack.hpTop, amount);
    if (healed <= 0) return 0;
    stack.hpTop += healed;
    after = before + healed;
  }
  emit(ctx, {
    type: revive ? "resurrected" : "healed",
    stackId: stack.id,
    amount: after - before,
    abilityId: abilityId as never,
  });
  return after - before;
}

export function addStatus(ctx: BattleCtx, stack: StackState, status: Status, sourceId?: string): void {
  if (!isAlive(stack)) return;
  setStatus(stack, status);
  emit(ctx, { type: "statusApplied", stackId: stack.id, targetId: sourceId, statusId: status.id });
}

/** Ends after the target's next activation (counted from now, see StackState.activations). */
export function untilNextActivation(stack: StackState): number {
  return stack.activations + 1;
}

/**
 * Stun / fear / blind: the target loses its next activation. If it hasn't acted this round it loses this one
 * right away; otherwise it loses the first one of the next round (`skip_next`, consumed in turns.ts).
 */
export function applySkip(ctx: BattleCtx, target: StackState, cause: StatusId | string, sourceId?: string): void {
  if (!isAlive(target)) return;
  const now = !target.activated;
  if (now) {
    target.activated = true;
    target.activations += 1;
    emit(ctx, { type: "skipped", stackId: target.id, targetId: sourceId, detail: cause });
    endOfActivationCleanup(target);
  } else {
    addStatus(ctx, target, { id: "skip_next" }, sourceId);
  }
  if (cause === "blind") {
    // no retaliation until the skipped activation has passed
    addStatus(ctx, target, { id: "blinded", untilRound: now ? ctx.battle.round : ctx.battle.round + 1 }, sourceId);
  }
}

/** Statuses that last until a given activation end. */
export function endOfActivationCleanup(stack: StackState): void {
  stack.statuses = stack.statuses.filter(
    (status) => status.untilActivation === undefined || status.untilActivation > stack.activations
  );
}
