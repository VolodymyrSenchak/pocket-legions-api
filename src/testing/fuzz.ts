import { armyPoints, gearCap, heroBonuses, maxChampions, maxStacks, Placement, validateArmy } from "../engine/army";
import { ActAction, BattleSetup, BattleSideSetup, stackOptions, zoneFor } from "../engine/battle";
import { ITEMS, ItemId, SingleSlot, SLOTS } from "../engine/data/items";
import { MAPS } from "../engine/data/maps";
import { RACE_IDS, RACES, UNITS } from "../engine/data/races";
import { BuiltMap, cellIndex, DIRECTIONS, getMap } from "../engine/grid";
import { HeroOptions, HeroPayload, WALL_LENGTH } from "../engine/heroes";
import type { Rng } from "../engine/rng";
import { BattleState, isAlive, StackState } from "../engine/state";
import type { Army, Cell, GameMode, MapId, RaceId } from "../engine/types";

// Random but legal inputs for the fuzz tests (plan §6.9).

function shuffle<T>(rng: Rng, items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function randomArmy(rng: Rng, raceId: RaceId, rules: { budget: number; mapSize: number; playerCount: number }): Army {
  const army: Army = { stacks: [], items: {}, rings: [] };
  // gear first, under the cap
  const cap = gearCap(rules.budget);
  for (const slot of shuffle(rng, [...SLOTS])) {
    if (rng.int(2) === 0) continue;
    const options = Object.values(ITEMS).filter((item) => item.slot === slot);
    const item = rng.pick(options);
    const next: Army = slot === "ring" ? { ...army, rings: [item.id, ...(rng.int(2) ? [rng.pick(options).id] : [])] } : { ...army, items: { ...army.items, [slot as SingleSlot]: item.id } };
    if (armyPoints(next, rules.budget).gearPoints <= cap) Object.assign(army, next);
  }
  const remaining = rules.budget - armyPoints(army, rules.budget).gearPoints;
  const stackCount = 1 + rng.int(maxStacks(rules.mapSize, rules.playerCount));
  const perType = new Map<string, number>();
  let champions = maxChampions(rules.budget);
  for (let i = 0; i < stackCount; i++) {
    const candidates = RACES[raceId].units.filter((id) => (perType.get(id) ?? 0) < 2 && (UNITS[id].tier < 10 || champions > 0));
    const unitId = rng.pick(candidates);
    const unit = UNITS[unitId];
    let count = Math.floor(remaining / stackCount / unit.cost);
    if (unit.tier === 10) count = Math.min(count, champions);
    if (count < 1) continue;
    if (unit.tier === 10) champions -= count;
    perType.set(unitId, (perType.get(unitId) ?? 0) + 1);
    army.stacks.push({ unitId, count });
  }
  if (army.stacks.length === 0) {
    const cheapest = [...RACES[raceId].units].sort((a, b) => UNITS[a].cost - UNITS[b].cost)[0];
    army.stacks.push({ unitId: cheapest, count: 1 });
  }
  const check = validateArmy(army, raceId, rules);
  if (!check.ok) throw new Error(`randomArmy built an invalid army: ${check.reason}`);
  return army;
}

export function randomDeployment(rng: Rng, map: BuiltMap, zone: Cell[], stackCount: number): Placement[] {
  const free = shuffle(
    rng,
    zone.filter((cell) => !map.blocked[cellIndex(map, cell)])
  );
  if (free.length < stackCount) throw new Error("zone too small");
  return Array.from({ length: stackCount }, (_, stackIndex) => ({ stackIndex, x: free[stackIndex].x, y: free[stackIndex].y }));
}

export interface RandomSetupOptions {
  mapId?: MapId;
  mode?: GameMode;
  players?: number;
  budget?: number;
}

export function randomSetupShape(rng: Rng, options: RandomSetupOptions = {}): { mapId: MapId; mode: GameMode; players: number; budget: number } {
  const def = options.mapId ? MAPS.find((map) => map.id === options.mapId)! : rng.pick(MAPS);
  const mode: GameMode = options.mode ?? (def.teams && rng.int(4) === 0 ? "teams" : "ffa");
  const [min, max] = def.ffaPlayers;
  const players = options.players ?? (mode === "teams" ? 4 : min + rng.int(max - min + 1));
  const budget = options.budget ?? rng.pick([500, 1000, 1500, 2000]);
  return { mapId: def.id, mode, players, budget };
}

export function randomSetup(rng: Rng, options: RandomSetupOptions = {}): BattleSetup {
  const { mapId, mode, players, budget } = randomSetupShape(rng, options);
  const map = getMap(mapId);
  const seats = Array.from({ length: players }, (_, seat) => ({ seat, team: mode === "teams" ? ((seat % 2) as 0 | 1) : null }));
  const sides: BattleSideSetup[] = seats.map(({ seat, team }) => {
    const raceId = rng.pick(RACE_IDS);
    const army = randomArmy(rng, raceId, { budget, mapSize: map.size, playerCount: players });
    const zone = zoneFor(map, mode, seats, seat, heroBonuses(raceId, [...Object.values(army.items), ...army.rings] as ItemId[]).fx.deployRows);
    return { seat, team, raceId, army, deployment: randomDeployment(rng, map, zone, army.stacks.length) };
  });
  return { mapId, mode, sides };
}

/** Every action the options allow for one stack (the same list the hints show). */
export function legalActions(battle: BattleState, map: BuiltMap, stack: StackState): ActAction[] {
  const options = stackOptions(battle, map, stack);
  const actions: ActAction[] = [{ stackId: stack.id, kind: "defend" }];
  for (const move of options.moves) actions.push({ stackId: stack.id, kind: "move", cell: move.cell });
  for (const attack of options.attacks) {
    for (const from of attack.from) actions.push({ stackId: stack.id, kind: "attack", target: attack.target.id, cell: from.cell });
  }
  for (const shot of options.shots) actions.push({ stackId: stack.id, kind: "shoot", target: shot.target.id });
  for (const ability of options.abilities) {
    if (ability.targets.length === 0) actions.push({ stackId: stack.id, kind: "ability" });
    for (const target of ability.targets) actions.push({ stackId: stack.id, kind: "ability", target: target.id });
  }
  return actions;
}

/** A random legal hero payload from the options, or null (e.g. no room for a wall). */
export function randomHeroPayload(rng: Rng, options: HeroOptions): HeroPayload | null {
  switch (options.abilityId) {
    case "battle_cry":
      return {};
    case "hellfire":
      return { cell: rng.pick(options.cells) };
    case "blood_ritual":
      return { target: rng.pick(options.targets), ally: rng.pick(options.allies) };
    case "stone_wall": {
      const free = new Set(options.cells.map((cell) => `${cell.x},${cell.y}`));
      for (const start of shuffle(rng, options.cells).slice(0, 20)) {
        const d = rng.pick(DIRECTIONS);
        const line = Array.from({ length: WALL_LENGTH }, (_, i) => ({ x: start.x + i * d.x, y: start.y + i * d.y }));
        if (line.every((cell) => free.has(`${cell.x},${cell.y}`))) return { cells: line };
      }
      return null;
    }
    default:
      return options.targets.length ? { target: rng.pick(options.targets) } : null;
  }
}

/** Living stacks on free terrain, one per cell. */
export function positionProblems(battle: BattleState, map: BuiltMap): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const stack of battle.stacks.filter(isAlive)) {
    const key = `${stack.x},${stack.y}`;
    if (map.blocked[cellIndex(map, stack)]) problems.push(`${stack.id} on an obstacle at ${key}`);
    if (battle.walls.some((wall) => wall.x === stack.x && wall.y === stack.y)) problems.push(`${stack.id} on a wall at ${key}`);
    if (seen.has(key)) problems.push(`two stacks at ${key}`);
    seen.add(key);
  }
  return problems;
}

export function countProblems(battle: BattleState): string[] {
  return battle.stacks.flatMap((stack) => {
    const hp = UNITS[stack.unitId].hp;
    if (stack.count < 0 || stack.shots < 0) return [`${stack.id} negative count/shots`];
    if (stack.count > 0 && (stack.hpTop < 1 || stack.hpTop > hp)) return [`${stack.id} hpTop ${stack.hpTop}`];
    if (stack.count === 0 && stack.hpTop !== 0) return [`${stack.id} dead with hp`];
    return [];
  });
}
