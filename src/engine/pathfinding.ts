import { BuiltMap, cellIndex, cellKey, DIRECTIONS, distance, inBounds } from "./grid";
import { areAllies, BattleState, cellOf, isAlive, StackState } from "./state";
import { hasAbility, speedOf, unitOf } from "./stats";
import type { Cell } from "./types";

export interface Reach {
  cell: Cell;
  /** Start and end included. Flyers and teleporters: just the two. */
  path: Cell[];
  /** Cells moved (the charge bonus counts these). */
  cost: number;
}

export type MoveKind = "walk" | "fly" | "teleport";

export function moveKind(stack: StackState): MoveKind {
  if (hasAbility(stack, "teleport")) return "teleport";
  return unitOf(stack).fly ? "fly" : "walk";
}

/** Obstacles and the dwarf hero's walls. */
export function isTerrainBlocked(battle: BattleState, map: BuiltMap, cell: Cell): boolean {
  if (!inBounds(map, cell) || map.blocked[cellIndex(map, cell)]) return true;
  return battle.walls.some((wall) => wall.x === cell.x && wall.y === cell.y);
}

/** Where a stack can stand: inside the map, no obstacle, no wall, no living stack. */
export function isFreeCell(battle: BattleState, map: BuiltMap, cell: Cell, ignore?: StackState): boolean {
  if (isTerrainBlocked(battle, map, cell)) return false;
  return !battle.stacks.some((stack) => stack !== ignore && isAlive(stack) && stack.x === cell.x && stack.y === cell.y);
}

/**
 * Cells a stack can end its move on (plan §6.2), its own cell excluded, ordered by cost then row then column.
 * Walkers: 8 directions, no corner cutting past blocked terrain, through allies but not enemies, never stop on a stack.
 * Flyers and teleporters: any free cell within speed.
 */
export function reachable(battle: BattleState, map: BuiltMap, stack: StackState, speed = speedOf(battle, stack)): Reach[] {
  const start = cellOf(stack);
  if (speed <= 0) return [];
  const kind = moveKind(stack);
  const result: Reach[] = [];

  if (kind !== "walk") {
    for (let y = Math.max(0, start.y - speed); y <= Math.min(map.size - 1, start.y + speed); y++) {
      for (let x = Math.max(0, start.x - speed); x <= Math.min(map.size - 1, start.x + speed); x++) {
        const cell = { x, y };
        if ((x !== start.x || y !== start.y) && isFreeCell(battle, map, cell, stack)) {
          result.push({ cell, path: [start, cell], cost: distance(start, cell) });
        }
      }
    }
    return sortReach(result);
  }

  const occupant = new Map<string, StackState>();
  for (const other of battle.stacks) {
    if (other !== stack && isAlive(other)) occupant.set(cellKey(other), other);
  }
  const terrainFree = (cell: Cell) => !isTerrainBlocked(battle, map, cell);
  const passable = (cell: Cell) => {
    if (!terrainFree(cell)) return false;
    const other = occupant.get(cellKey(cell));
    return !other || areAllies(battle, other.seat, stack.seat);
  };

  const previous = new Map<string, Cell | null>([[cellKey(start), null]]);
  let frontier: Cell[] = [start];
  for (let cost = 1; cost <= speed && frontier.length; cost++) {
    const next: Cell[] = [];
    for (const cell of frontier) {
      for (const d of DIRECTIONS) {
        const to = { x: cell.x + d.x, y: cell.y + d.y };
        const key = cellKey(to);
        if (previous.has(key) || !passable(to)) continue;
        if (d.x && d.y && (!terrainFree({ x: cell.x + d.x, y: cell.y }) || !terrainFree({ x: cell.x, y: cell.y + d.y }))) continue;
        previous.set(key, cell);
        next.push(to);
        if (!occupant.has(key)) {
          result.push({ cell: to, path: tracePath(previous, to), cost });
        }
      }
    }
    frontier = next;
  }
  return sortReach(result);
}

function tracePath(previous: Map<string, Cell | null>, end: Cell): Cell[] {
  const path: Cell[] = [];
  let cursor: Cell | null = end;
  while (cursor) {
    path.unshift(cursor);
    cursor = previous.get(cellKey(cursor)) ?? null;
  }
  return path;
}

function sortReach(list: Reach[]): Reach[] {
  return list.sort((a, b) => a.cost - b.cost || a.cell.y - b.cell.y || a.cell.x - b.cell.x);
}

/** The reach entry for `cell`, or the stack's own cell with cost 0. */
export function findReach(battle: BattleState, map: BuiltMap, stack: StackState, cell: Cell): Reach | undefined {
  if (cell.x === stack.x && cell.y === stack.y) return { cell, path: [cellOf(stack)], cost: 0 };
  return reachable(battle, map, stack).find((reach) => reach.cell.x === cell.x && reach.cell.y === cell.y);
}
