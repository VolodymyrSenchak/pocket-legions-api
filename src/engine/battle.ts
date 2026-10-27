import { activeAbilityOf, Hit, someHook } from "./abilities";
import { equippedItems, heroBonuses, Placement } from "./army";
import { RACES } from "./data/races";
import { areaAfter, isMagicAttack, ShotPenalty, shotPenalties, strike } from "./damage";
import { addStatus } from "./effects";
import { BuiltMap, deployZone, distance, getMap, isAdjacent, sameCell, ZoneLayout } from "./grid";
import { HERO_USES, HeroPayload, useHeroAbility } from "./heroes";
import { hasLineOfSight } from "./los";
import { findReach, Reach, reachable } from "./pathfinding";
import {
  areAllies,
  BattleCtx,
  BattleEnv,
  BattleState,
  cellOf,
  emit,
  findStack,
  GameEvent,
  hasStatus,
  isAlive,
  livingStacks,
  sideOf,
  StackState,
} from "./state";
import { retaliationsPerRound, speedOf, startingShots, unitOf } from "./stats";
import { actableStacks, advanceTurn, finishActivation, rollsMoraleSkip, startActivation, startTurn } from "./turns";
import type { AbilityId, Army, Cell, GameMode, MapId, RaceId } from "./types";
import { checkVictory } from "./victory";

// applyAction(battle, action, env) → events (plan §5). Every function here mutates the battle it gets.

export interface BattleSideSetup {
  seat: number;
  team: 0 | 1 | null;
  raceId: RaceId;
  army: Army;
  deployment: Placement[];
}

export interface BattleSetup {
  mapId: MapId;
  mode: GameMode;
  sides: BattleSideSetup[];
}

/** Turn order: seats ascending (clockwise); in 2 vs 2 the teams alternate. */
export function turnOrder(mode: GameMode, sides: Pick<BattleSideSetup, "seat" | "team">[]): number[] {
  const seats = [...sides].sort((a, b) => a.seat - b.seat);
  if (mode !== "teams") return seats.map((side) => side.seat);
  const [a, b] = [0, 1].map((team) => seats.filter((side) => side.team === team).map((side) => side.seat));
  const order: number[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== undefined) order.push(a[i]);
    if (b[i] !== undefined) order.push(b[i]);
  }
  return order;
}

/**
 * Deploy zone of a seat (design §8). 2 players in FFA: left/right columns. Otherwise corners;
 * in 2 vs 2 team 0 takes the left corners (TL, BL) and team 1 the right ones (TR, BR).
 */
export function zoneFor(
  map: Pick<BuiltMap, "size">,
  mode: GameMode,
  sides: Pick<BattleSideSetup, "seat" | "team">[],
  seat: number,
  extraRows = 0
): Cell[] {
  const sorted = [...sides].sort((a, b) => a.seat - b.seat);
  const position = sorted.findIndex((side) => side.seat === seat);
  let layout: ZoneLayout = "four";
  let index = position;
  if (mode === "ffa" && sides.length === 2) {
    layout = "two";
  } else if (mode === "teams") {
    const team = sorted[position].team ?? 0;
    const mates = sorted.filter((side) => side.team === team);
    const corners = team === 0 ? [0, 3] : [1, 2];
    index = corners[mates.findIndex((side) => side.seat === seat)] ?? corners[0];
  }
  return deployZone(map, layout, index, extraRows);
}

export function stackId(seat: number, index: number): string {
  return `s${seat}_${index}`;
}

function makeCtx(battle: BattleState, env: BattleEnv): BattleCtx {
  return { ...env, battle, map: getMap(battle.mapId), out: [] };
}

/** Builds the battle from armies and deployments; a random seat opens round 1. */
export function createBattle(setup: BattleSetup, env: BattleEnv): { battle: BattleState; events: GameEvent[] } {
  const order = turnOrder(setup.mode, setup.sides);
  const battle: BattleState = {
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
      items: equippedItems(side.army),
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
    const bonuses = heroBonuses(side.raceId, equippedItems(side.army));
    battle.heroes.push({
      seat: side.seat,
      abilityId: RACES[side.raceId].hero.ability.id,
      usesLeft: HERO_USES + bonuses.fx.heroUses,
      readyRound: 1,
      usedThisTurn: false,
    });
    side.army.stacks.forEach((bought, index) => {
      const placement = side.deployment.find((entry) => entry.stackIndex === index)!;
      const base = { seat: side.seat, unitId: bought.unitId };
      battle.stacks.push({
        id: stackId(side.seat, index),
        ...base,
        count: bought.count,
        hpTop: unitOf(base as StackState).hp,
        startCount: bought.count,
        x: placement.x,
        y: placement.y,
        shots: startingShots(battle, base),
        retaliationsLeft: retaliationsPerRound(battle, base),
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
  emit(ctx, { type: "battleStarted", seat: battle.firstSeat });
  emit(ctx, { type: "roundStarted", seat: battle.firstSeat });
  startTurn(ctx, battle.firstSeat);
  return { battle, events: ctx.out };
}

// ---------- what a stack may do (shared by hints and validation) ----------

export interface AttackOption {
  target: StackState;
  /** Cells to attack from (for bombard: cells to land on). Sorted by move cost. */
  from: Reach[];
}

export interface ShotOption {
  target: StackState;
  penalties: ShotPenalty[];
}

export interface AbilityOption {
  abilityId: AbilityId;
  /** Ally targets in range of the current cell; empty for `scream` (no target). */
  targets: StackState[];
}

export interface StackOptions {
  stack: StackState;
  moves: Reach[];
  attacks: AttackOption[];
  shots: ShotOption[];
  abilities: AbilityOption[];
  canDefend: boolean;
}

function enemiesOf(battle: BattleState, stack: StackState): StackState[] {
  return livingStacks(battle).filter((other) => !areAllies(battle, other.seat, stack.seat));
}

function attackFrom(battle: BattleState, stack: StackState, target: StackState, moves: Reach[]): Reach[] {
  const here: Reach = { cell: cellOf(stack), path: [cellOf(stack)], cost: 0 };
  const from = [here, ...moves].filter((reach) => isAdjacent(reach.cell, target));
  if (someHook(stack, (h) => h.flyOverAttack)) {
    const speed = speedOf(battle, stack);
    const over = moves.filter(
      (reach) =>
        !from.includes(reach) && distance(stack, target) + distance(target, reach.cell) <= speed && !sameCell(reach.cell, target)
    );
    from.push(...over.map((reach) => ({ ...reach, path: [cellOf(stack), cellOf(target), reach.cell] })));
  }
  return from;
}

function abilityTargets(battle: BattleState, stack: StackState, from: Cell): AbilityOption | null {
  const active = activeAbilityOf(stack);
  if (!active) return null;
  const { id, ability } = active;
  if (ability.target === "none") return { abilityId: id, targets: [] };
  const ctxLike = { battle } as BattleCtx;
  const targets = livingStacks(battle).filter(
    (other) =>
      areAllies(battle, other.seat, stack.seat) &&
      (ability.radius === null || distance(other, from) <= ability.radius) &&
      ability.canTarget(ctxLike, stack, other)
  );
  return targets.length ? { abilityId: id, targets } : null;
}

export function stackOptions(battle: BattleState, map: BuiltMap, stack: StackState): StackOptions {
  const moves = reachable(battle, map, stack);
  const enemies = enemiesOf(battle, stack);
  const attacks = enemies
    .map((target) => ({ target, from: attackFrom(battle, stack, target, moves) }))
    .filter((option) => option.from.length > 0);
  const shots: ShotOption[] =
    unitOf(stack).ranged && stack.shots > 0
      ? enemies
          .filter((target) => hasLineOfSight(battle, map, cellOf(stack), cellOf(target)))
          .map((target) => ({ target, penalties: shotPenalties(battle, stack, target) }))
      : [];
  const ability = abilityTargets(battle, stack, cellOf(stack));
  return { stack, moves, attacks, shots, abilities: ability ? [ability] : [], canDefend: true };
}

// ---------- actions ----------

export type ActKind = "move" | "attack" | "shoot" | "ability" | "defend";

export interface ActAction {
  stackId: string;
  kind: ActKind;
  /** move: destination; attack: the cell to attack from / land on (default: where it stands); ability: move here first. */
  cell?: Cell;
  /** attack / shoot / ally ability. */
  target?: string;
}

export type StepResult = { ok: true; events: GameEvent[] } | { ok: false; code: "not-your-turn" | "illegal-action"; reason: string };

const illegal = (reason: string): StepResult => ({ ok: false, code: "illegal-action", reason });

function moveStack(ctx: BattleCtx, stack: StackState, reach: Reach): void {
  if (reach.cost === 0) return;
  stack.x = reach.cell.x;
  stack.y = reach.cell.y;
  emit(ctx, { type: "moved", stackId: stack.id, path: reach.path.map((cell) => ({ x: cell.x, y: cell.y })) });
}

function retaliate(ctx: BattleCtx, attacker: StackState, defender: StackState): void {
  if (!isAlive(attacker) || !isAlive(defender) || !isAdjacent(attacker, defender)) return;
  if (someHook(attacker, (h) => h.preventsRetaliation) || hasStatus(defender, "blinded")) return;
  const unlimited = someHook(defender, (h) => h.unlimitedRetaliation);
  if (!unlimited && defender.retaliationsLeft <= 0) return;
  if (!unlimited) defender.retaliationsLeft -= 1;
  emit(ctx, { type: "retaliated", stackId: defender.id, targetId: attacker.id });
  strike(ctx, { attacker: defender, target: attacker, mode: "melee", retaliation: true, moved: 0, factor: 1, splash: false, magic: false });
}

function meleeAttack(ctx: BattleCtx, stack: StackState, target: StackState, reach: Reach): void {
  const start = cellOf(stack);
  const flyOver = !isAdjacent(reach.cell, target);
  moveStack(ctx, stack, reach);
  emit(ctx, { type: "attacked", stackId: stack.id, targetId: target.id });
  const hit: Hit = { attacker: stack, target, mode: "melee", retaliation: false, moved: reach.cost, factor: 1, splash: false, magic: false };
  for (let i = 0; i < unitOf(stack).hits; i++) {
    if (!isAlive(stack) || !isAlive(target)) break;
    strike(ctx, hit);
    if (i === 0) {
      areaAfter(ctx, hit);
      if (!flyOver) retaliate(ctx, stack, target);
    }
  }
  if (isAlive(stack) && someHook(stack, (h) => h.returnsAfterAttack) && !sameCell(start, stack)) {
    const back = { cell: start, path: [cellOf(stack), start], cost: distance(start, stack) };
    moveStack(ctx, stack, back);
  }
}

function shoot(ctx: BattleCtx, stack: StackState, target: StackState): void {
  stack.shots -= 1;
  emit(ctx, { type: "shot", stackId: stack.id, targetId: target.id });
  const hit: Hit = { attacker: stack, target, mode: "ranged", retaliation: false, moved: 0, factor: 1, splash: false, magic: isMagicAttack(stack, "ranged") };
  for (let i = 0; i < unitOf(stack).hits; i++) {
    if (!isAlive(target)) break;
    strike(ctx, hit);
    if (i === 0) areaAfter(ctx, { ...hit, magic: false });
  }
}

/** One `act` by the active seat (plan §7.3), validated against the same options the hints show. */
export function applyAct(battle: BattleState, seat: number, action: ActAction, env: BattleEnv): StepResult {
  if (battle.result) return illegal("battle-over");
  if (battle.activeSeat !== seat) return { ok: false, code: "not-your-turn", reason: "not-your-turn" };
  const stack = actableStacks(battle).find((candidate) => candidate.id === action.stackId);
  if (!stack) return illegal("stack-cannot-act");
  const ctx = makeCtx(battle, env);
  const options = stackOptions(battle, ctx.map, stack);
  const targetOf = (id?: string) => (id === undefined ? undefined : findStack(battle, id));

  // validate first; the morale roll comes after a legal choice
  let perform: () => void;
  let allowMorale = true;
  switch (action.kind) {
    case "move": {
      const reach = action.cell && options.moves.find((option) => sameCell(option.cell, action.cell!));
      if (!reach) return illegal("unreachable-cell");
      perform = () => moveStack(ctx, stack, reach);
      break;
    }
    case "attack": {
      const target = targetOf(action.target);
      const option = target && options.attacks.find((candidate) => candidate.target === target);
      if (!option) return illegal("bad-target");
      const cell = action.cell ?? cellOf(stack);
      const reach = option.from.find((candidate) => sameCell(candidate.cell, cell));
      if (!reach) return illegal("bad-attack-cell");
      perform = () => meleeAttack(ctx, stack, option.target, reach);
      break;
    }
    case "shoot": {
      const target = targetOf(action.target);
      if (!target || !options.shots.some((option) => option.target === target)) return illegal("bad-target");
      perform = () => shoot(ctx, stack, target);
      break;
    }
    case "ability": {
      const active = activeAbilityOf(stack);
      if (!active) return illegal("no-ability");
      const reach = action.cell ? findReach(battle, ctx.map, stack, action.cell) : findReach(battle, ctx.map, stack, cellOf(stack));
      if (!reach) return illegal("unreachable-cell");
      const option = abilityTargets(battle, stack, reach.cell);
      if (!option) return illegal("no-targets");
      let target: StackState | null = null;
      if (active.ability.target === "ally") {
        target = option.targets.find((candidate) => candidate.id === action.target) ?? null;
        if (!target) return illegal("bad-target");
      }
      perform = () => {
        moveStack(ctx, stack, reach);
        emit(ctx, { type: "abilityUsed", stackId: stack.id, targetId: target?.id, abilityId: active.id });
        active.ability.apply(ctx, stack, target);
      };
      break;
    }
    case "defend": {
      allowMorale = false;
      perform = () => {
        addStatus(ctx, stack, { id: "defending" });
        emit(ctx, { type: "defended", stackId: stack.id });
      };
      break;
    }
    default:
      return illegal("unknown-kind");
  }

  const bonus = battle.bonusStackId === stack.id;
  startActivation(stack);
  if (!bonus && rollsMoraleSkip(ctx, stack)) {
    finishActivation(ctx, stack, false);
    return { ok: true, events: ctx.out };
  }
  perform();
  finishActivation(ctx, stack, allowMorale);
  return { ok: true, events: ctx.out };
}

/** After damage outside an activation (hero ability, surrender): end the battle or skip a seat that has nothing left. */
function settle(ctx: BattleCtx): void {
  if (checkVictory(ctx)) return;
  if (actableStacks(ctx.battle).length === 0) advanceTurn(ctx);
}

export function applyHeroAbility(battle: BattleState, seat: number, payload: HeroPayload, env: BattleEnv): StepResult {
  if (battle.result) return illegal("battle-over");
  if (battle.activeSeat !== seat) return { ok: false, code: "not-your-turn", reason: "not-your-turn" };
  const ctx = makeCtx(battle, env);
  const used = useHeroAbility(ctx, seat, payload);
  if (!used.ok) return illegal(used.reason);
  settle(ctx);
  return { ok: true, events: ctx.out };
}

/** Turn timer ran out (plan §3.5): the first stack that hasn't acted defends and the turn passes. */
export function applyTimeout(battle: BattleState, env: BattleEnv): GameEvent[] {
  const ctx = makeCtx(battle, env);
  if (battle.result) return ctx.out;
  emit(ctx, { type: "timedOut", seat: battle.activeSeat });
  if (battle.bonusStackId) {
    advanceTurn(ctx);
    return ctx.out;
  }
  const stack = [...actableStacks(battle)].sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!stack) {
    advanceTurn(ctx);
    return ctx.out;
  }
  startActivation(stack);
  addStatus(ctx, stack, { id: "defending" });
  emit(ctx, { type: "defended", stackId: stack.id });
  finishActivation(ctx, stack, false);
  return ctx.out;
}

/** Surrender, auto-surrender or leaving: the seat's stacks leave the field. */
export function eliminateSeat(battle: BattleState, seat: number, env: BattleEnv, reason: "surrender" | "left" | "timeout"): GameEvent[] {
  const ctx = makeCtx(battle, env);
  const side = sideOf(battle, seat);
  if (battle.result || side.eliminated) return ctx.out;
  emit(ctx, { type: "surrendered", seat, reason });
  for (const stack of battle.stacks) {
    if (stack.seat === seat && isAlive(stack)) {
      stack.count = 0;
      stack.hpTop = 0;
      stack.statuses = [];
    }
  }
  side.eliminated = true;
  emit(ctx, { type: "playerEliminated", seat, reason });
  if (checkVictory(ctx, "surrender")) return ctx.out;
  if (battle.activeSeat === seat) advanceTurn(ctx);
  return ctx.out;
}

export { actableStacks };
