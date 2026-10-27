import { isMagicImmune } from "./abilities";
import { addStatus, applyDamage, healStack, untilNextActivation } from "./effects";
import { BuiltMap, distance, sameCell } from "./grid";
import { isFreeCell } from "./pathfinding";
import { areAllies, BattleCtx, BattleState, emit, findStack, isAlive, livingStacks, StackState } from "./state";
import { bonusesOf, heroPower, raceOf } from "./stats";
import type { Cell, HeroAbilityId } from "./types";

// Hero abilities (design §5): a free action at the start of the turn, 2 uses (3 with the mantle), 3-round cooldown.

export const HERO_USES = 2;
export const HERO_COOLDOWN_ROUNDS = 3;
export const WALL_LENGTH = 3;

export interface HeroPayload {
  /** Enemy (blood ritual, earth roots) or ally (heavenly shield). */
  target?: string;
  /** Blood ritual: your stack that heals. */
  ally?: string;
  /** Hellfire: the centre of the 3×3 square. */
  cell?: Cell;
  /** Stone wall: 3 free cells in a straight line. */
  cells?: Cell[];
}

export interface HeroOptions {
  abilityId: HeroAbilityId;
  /** Valid `target` ids. */
  targets: string[];
  /** Valid `ally` ids (blood ritual). */
  allies: string[];
  /** Valid `cell` / `cells` entries. */
  cells: Cell[];
}

function heroOf(battle: BattleState, seat: number) {
  return battle.heroes.find((hero) => hero.seat === seat);
}

export function canUseHero(battle: BattleState, seat: number): boolean {
  const hero = heroOf(battle, seat);
  return (
    !battle.result &&
    battle.activeSeat === seat &&
    !!hero &&
    !hero.usedThisTurn &&
    hero.usesLeft > 0 &&
    battle.round >= hero.readyRound
  );
}

function allCells(map: BuiltMap): Cell[] {
  const cells: Cell[] = [];
  for (let y = 0; y < map.size; y++) for (let x = 0; x < map.size; x++) cells.push({ x, y });
  return cells;
}

const ids = (stacks: StackState[]) => stacks.map((stack) => stack.id);

/** What the hero can target now, or null when the ability can't be used. */
export function heroOptions(battle: BattleState, map: BuiltMap, seat: number): HeroOptions | null {
  if (!canUseHero(battle, seat)) return null;
  const hero = heroOf(battle, seat)!;
  const living = livingStacks(battle);
  const enemies = living.filter((stack) => !areAllies(battle, stack.seat, seat) && !isMagicImmune(stack));
  const friends = living.filter((stack) => areAllies(battle, stack.seat, seat) && !isMagicImmune(stack));
  const own = living.filter((stack) => stack.seat === seat && !isMagicImmune(stack));
  const empty: HeroOptions = { abilityId: hero.abilityId, targets: [], allies: [], cells: [] };
  switch (hero.abilityId) {
    case "heavenly_shield":
      return { ...empty, targets: ids(friends) };
    case "blood_ritual":
      return enemies.length && own.length ? { ...empty, targets: ids(enemies), allies: ids(own) } : null;
    case "earth_roots":
      return enemies.length ? { ...empty, targets: ids(enemies) } : null;
    case "battle_cry":
      return empty;
    case "hellfire":
      return { ...empty, cells: allCells(map) };
    case "stone_wall":
      return { ...empty, cells: allCells(map).filter((cell) => isFreeCell(battle, map, cell)) };
  }
}

/** Hero damage ignores defence; enemy dwarves take −25% (stone skin), the dragon shield another −20%. */
function heroDamage(ctx: BattleCtx, seat: number, target: StackState, amount: number): void {
  if (isMagicImmune(target)) return;
  let damage = amount;
  if (raceOf(ctx.battle, target) === "dwarves") damage *= 0.75;
  if (!areAllies(ctx.battle, seat, target.seat)) damage *= 1 + bonusesOf(ctx.battle, target.seat).fx.heroDmgTaken;
  applyDamage(ctx, target, Math.max(1, Math.floor(damage)), { detail: "hero" });
}

function isStraightLine(cells: Cell[]): boolean {
  if (cells.length !== WALL_LENGTH) return false;
  const dx = cells[1].x - cells[0].x;
  const dy = cells[1].y - cells[0].y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return false;
  return cells.every((cell, i) => cell.x === cells[0].x + i * dx && cell.y === cells[0].y + i * dy);
}

export type HeroResult = { ok: true } | { ok: false; reason: string };

export function useHeroAbility(ctx: BattleCtx, seat: number, payload: HeroPayload): HeroResult {
  const { battle, map } = ctx;
  const options = heroOptions(battle, map, seat);
  if (!options) return { ok: false, reason: "hero-unavailable" };
  const hero = heroOf(battle, seat)!;
  const power = heroPower(battle, seat);
  const stackFrom = (id: string | undefined, allowed: string[]) =>
    id !== undefined && allowed.includes(id) ? findStack(battle, id) : undefined;
  const announce = () =>
    emit(ctx, { type: "heroAbility", seat, abilityId: options.abilityId, targetId: payload.target, cell: payload.cell });

  switch (options.abilityId) {
    case "heavenly_shield": {
      const target = stackFrom(payload.target, options.targets);
      if (!target) return { ok: false, reason: "bad-target" };
      announce();
      addStatus(ctx, target, { id: "heavenly_shield", untilRound: battle.round, value: power });
      break;
    }
    case "blood_ritual": {
      const target = stackFrom(payload.target, options.targets);
      const ally = stackFrom(payload.ally, options.allies);
      if (!target || !ally) return { ok: false, reason: "bad-target" };
      announce();
      heroDamage(ctx, seat, target, 25 * power);
      healStack(ctx, ally, Math.floor(25 * power), false, "blood_ritual");
      break;
    }
    case "earth_roots": {
      const target = stackFrom(payload.target, options.targets);
      if (!target) return { ok: false, reason: "bad-target" };
      announce();
      heroDamage(ctx, seat, target, 15 * power);
      if (isAlive(target)) addStatus(ctx, target, { id: "entangled", untilActivation: untilNextActivation(target) });
      break;
    }
    case "battle_cry": {
      announce();
      for (const stack of livingStacks(battle)) {
        if (stack.seat === seat && !isMagicImmune(stack)) {
          addStatus(ctx, stack, { id: "battle_cry", untilRound: battle.round, value: power });
        }
      }
      break;
    }
    case "hellfire": {
      const center = payload.cell;
      if (!center || !options.cells.some((cell) => sameCell(cell, center))) return { ok: false, reason: "bad-cell" };
      announce();
      for (const stack of livingStacks(battle).filter((candidate) => distance(candidate, center) <= 1)) {
        heroDamage(ctx, seat, stack, 20 * power);
      }
      break;
    }
    case "stone_wall": {
      const cells = payload.cells ?? [];
      const free = (cell: Cell) => options.cells.some((option) => sameCell(option, cell));
      if (!isStraightLine(cells) || !cells.every(free)) return { ok: false, reason: "bad-cells" };
      announce();
      // 3 rounds counting the current one; the mantle makes it 4
      const rounds = Math.floor(HERO_COOLDOWN_ROUNDS * power);
      for (const cell of cells) battle.walls.push({ x: cell.x, y: cell.y, untilRound: battle.round + rounds - 1 });
      emit(ctx, { type: "wallBuilt", seat, cells: cells.map((cell) => ({ x: cell.x, y: cell.y })) });
      break;
    }
  }
  hero.usesLeft -= 1;
  hero.usedThisTurn = true;
  hero.readyRound = battle.round + HERO_COOLDOWN_ROUNDS;
  return { ok: true };
}
