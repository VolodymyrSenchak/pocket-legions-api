import { MapDef, MapId, MapObject, MAPS, OBSTACLE_TYPES, ObstacleType } from "./data/maps";
import type { Cell } from "./types";

/** The 8 neighbour offsets, in a fixed order (deterministic BFS and hints). */
export const DIRECTIONS: readonly Cell[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

/** Chebyshev distance: a diagonal step costs 1. */
export function distance(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function isAdjacent(a: Cell, b: Cell): boolean {
  return distance(a, b) === 1;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

export function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

export interface PlacedObject {
  t: ObstacleType;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ZoneLayout = "two" | "four";

export interface BuiltMap {
  id: MapId;
  name: string;
  size: number;
  def: MapDef;
  /** All objects after symmetry, bridges included. */
  objects: PlacedObject[];
  /** Index `y * size + x`. Blocks movement for every stack that walks. */
  blocked: boolean[];
  /** Blocks line of sight. Always a subset of `blocked`. */
  high: boolean[];
}

export function inBounds(map: Pick<BuiltMap, "size">, cell: Cell): boolean {
  return cell.x >= 0 && cell.y >= 0 && cell.x < map.size && cell.y < map.size;
}

export function cellIndex(map: Pick<BuiltMap, "size">, cell: Cell): number {
  return cell.y * map.size + cell.x;
}

/** 90° clockwise. */
function rotate(o: PlacedObject, n: number): PlacedObject {
  return { ...o, x: n - o.y - o.h, y: o.x, w: o.h, h: o.w };
}

export function buildMap(def: MapDef): BuiltMap {
  const n = def.size;
  const objects: PlacedObject[] = [];
  const seen = new Set<string>();
  const push = (o: PlacedObject) => {
    const key = `${o.t}:${o.x}:${o.y}:${o.w}:${o.h}`;
    if (!seen.has(key)) {
      seen.add(key);
      objects.push(o);
    }
  };
  for (const source of def.objects as readonly MapObject[]) {
    let current: PlacedObject = { t: source.t, x: source.x, y: source.y, w: source.w ?? 1, h: source.h ?? 1 };
    const steps = def.sym === "rot4" ? 4 : 2;
    for (let i = 0; i < steps; i++) {
      push(current);
      current = def.sym === "rot4" ? rotate(current, n) : rotate(rotate(current, n), n);
    }
  }

  const blocked = new Array<boolean>(n * n).fill(false);
  const high = new Array<boolean>(n * n).fill(false);
  const type = (t: ObstacleType) => OBSTACLE_TYPES[t] as { high?: boolean; pass?: boolean };
  for (const o of objects) {
    if (type(o.t).pass) continue;
    for (let dx = 0; dx < o.w; dx++) {
      for (let dy = 0; dy < o.h; dy++) {
        const index = (o.y + dy) * n + o.x + dx;
        blocked[index] = true;
        if (type(o.t).high) high[index] = true;
      }
    }
  }
  // bridge cells are walkable even when water lies under them
  for (const o of objects) {
    if (o.t !== "bridge") continue;
    for (let dx = 0; dx < o.w; dx++) {
      blocked[o.y * n + o.x + dx] = false;
    }
  }
  return { id: def.id as MapId, name: def.name, size: n, def, objects, blocked, high };
}

const builtMaps = new Map<string, BuiltMap>();

export function getMap(id: MapId): BuiltMap {
  let map = builtMaps.get(id);
  if (!map) {
    const def = MAPS.find((candidate) => candidate.id === id);
    if (!def) {
      throw new Error(`Unknown map ${id}`);
    }
    map = buildMap(def);
    builtMaps.set(id, map);
  }
  return map;
}

export function isMapId(id: string): id is MapId {
  return MAPS.some((map) => map.id === id);
}

function rect(x0: number, y0: number, w: number, h: number): Cell[] {
  const cells: Cell[] = [];
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      cells.push({ x, y });
    }
  }
  return cells;
}

/**
 * Deploy zone `index` (design §8): 2 players — the two outer columns left (0) and right (1);
 * 3–4 players — the corners clockwise from top-left (0 TL, 1 TR, 2 BR, 3 BL), 3×3 up to 14×14 and 4×4 from 16×16.
 * `extraRows` (scout boots) makes the zone one row/column deeper.
 */
export function deployZone(map: Pick<BuiltMap, "size">, layout: ZoneLayout, index: number, extraRows = 0): Cell[] {
  const n = map.size;
  if (layout === "two") {
    const w = 2 + extraRows;
    return index === 0 ? rect(0, 0, w, n) : rect(n - w, 0, w, n);
  }
  const k = (n <= 14 ? 3 : 4) + extraRows;
  switch (index) {
    case 0:
      return rect(0, 0, k, k);
    case 1:
      return rect(n - k, 0, k, k);
    case 2:
      return rect(n - k, n - k, k, k);
    default:
      return rect(0, n - k, k, k);
  }
}

/** Problems with a map: blocked deploy cells, free cells not reachable on foot. Empty = valid. */
export function validateMap(map: BuiltMap): string[] {
  const problems: string[] = [];
  const zones = [0, 1].map((i) => deployZone(map, "two", i)).concat([0, 1, 2, 3].map((i) => deployZone(map, "four", i)));
  for (const zone of zones) {
    for (const cell of zone) {
      if (map.blocked[cellIndex(map, cell)]) problems.push(`zone blocked at ${cellKey(cell)}`);
    }
  }
  const free = (cell: Cell) => inBounds(map, cell) && !map.blocked[cellIndex(map, cell)];
  const start = zones[0][0];
  const seen = new Set([cellKey(start)]);
  const queue = [start];
  while (queue.length) {
    const cell = queue.shift()!;
    for (const d of DIRECTIONS) {
      const next = { x: cell.x + d.x, y: cell.y + d.y };
      if (!free(next) || seen.has(cellKey(next))) continue;
      if (d.x && d.y && (!free({ x: cell.x + d.x, y: cell.y }) || !free({ x: cell.x, y: cell.y + d.y }))) continue;
      seen.add(cellKey(next));
      queue.push(next);
    }
  }
  for (let y = 0; y < map.size; y++) {
    for (let x = 0; x < map.size; x++) {
      if (free({ x, y }) && !seen.has(cellKey({ x, y }))) problems.push(`unreachable cell ${x},${y}`);
    }
  }
  return problems;
}
