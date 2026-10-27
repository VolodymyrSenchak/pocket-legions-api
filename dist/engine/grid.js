"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIRECTIONS = void 0;
exports.distance = distance;
exports.isAdjacent = isAdjacent;
exports.sameCell = sameCell;
exports.cellKey = cellKey;
exports.inBounds = inBounds;
exports.cellIndex = cellIndex;
exports.buildMap = buildMap;
exports.getMap = getMap;
exports.isMapId = isMapId;
exports.deployZone = deployZone;
exports.validateMap = validateMap;
const maps_1 = require("./data/maps");
/** The 8 neighbour offsets, in a fixed order (deterministic BFS and hints). */
exports.DIRECTIONS = [
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
function distance(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
function isAdjacent(a, b) {
    return distance(a, b) === 1;
}
function sameCell(a, b) {
    return a.x === b.x && a.y === b.y;
}
function cellKey(cell) {
    return `${cell.x},${cell.y}`;
}
function inBounds(map, cell) {
    return cell.x >= 0 && cell.y >= 0 && cell.x < map.size && cell.y < map.size;
}
function cellIndex(map, cell) {
    return cell.y * map.size + cell.x;
}
/** 90° clockwise. */
function rotate(o, n) {
    return { ...o, x: n - o.y - o.h, y: o.x, w: o.h, h: o.w };
}
function buildMap(def) {
    const n = def.size;
    const objects = [];
    const seen = new Set();
    const push = (o) => {
        const key = `${o.t}:${o.x}:${o.y}:${o.w}:${o.h}`;
        if (!seen.has(key)) {
            seen.add(key);
            objects.push(o);
        }
    };
    for (const source of def.objects) {
        let current = { t: source.t, x: source.x, y: source.y, w: source.w ?? 1, h: source.h ?? 1 };
        const steps = def.sym === "rot4" ? 4 : 2;
        for (let i = 0; i < steps; i++) {
            push(current);
            current = def.sym === "rot4" ? rotate(current, n) : rotate(rotate(current, n), n);
        }
    }
    const blocked = new Array(n * n).fill(false);
    const high = new Array(n * n).fill(false);
    const type = (t) => maps_1.OBSTACLE_TYPES[t];
    for (const o of objects) {
        if (type(o.t).pass)
            continue;
        for (let dx = 0; dx < o.w; dx++) {
            for (let dy = 0; dy < o.h; dy++) {
                const index = (o.y + dy) * n + o.x + dx;
                blocked[index] = true;
                if (type(o.t).high)
                    high[index] = true;
            }
        }
    }
    // bridge cells are walkable even when water lies under them
    for (const o of objects) {
        if (o.t !== "bridge")
            continue;
        for (let dx = 0; dx < o.w; dx++) {
            blocked[o.y * n + o.x + dx] = false;
        }
    }
    return { id: def.id, name: def.name, size: n, def, objects, blocked, high };
}
const builtMaps = new Map();
function getMap(id) {
    let map = builtMaps.get(id);
    if (!map) {
        const def = maps_1.MAPS.find((candidate) => candidate.id === id);
        if (!def) {
            throw new Error(`Unknown map ${id}`);
        }
        map = buildMap(def);
        builtMaps.set(id, map);
    }
    return map;
}
function isMapId(id) {
    return maps_1.MAPS.some((map) => map.id === id);
}
function rect(x0, y0, w, h) {
    const cells = [];
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
function deployZone(map, layout, index, extraRows = 0) {
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
function validateMap(map) {
    const problems = [];
    const zones = [0, 1].map((i) => deployZone(map, "two", i)).concat([0, 1, 2, 3].map((i) => deployZone(map, "four", i)));
    for (const zone of zones) {
        for (const cell of zone) {
            if (map.blocked[cellIndex(map, cell)])
                problems.push(`zone blocked at ${cellKey(cell)}`);
        }
    }
    const free = (cell) => inBounds(map, cell) && !map.blocked[cellIndex(map, cell)];
    const start = zones[0][0];
    const seen = new Set([cellKey(start)]);
    const queue = [start];
    while (queue.length) {
        const cell = queue.shift();
        for (const d of exports.DIRECTIONS) {
            const next = { x: cell.x + d.x, y: cell.y + d.y };
            if (!free(next) || seen.has(cellKey(next)))
                continue;
            if (d.x && d.y && (!free({ x: cell.x + d.x, y: cell.y }) || !free({ x: cell.x, y: cell.y + d.y })))
                continue;
            seen.add(cellKey(next));
            queue.push(next);
        }
    }
    for (let y = 0; y < map.size; y++) {
        for (let x = 0; x < map.size; x++) {
            if (free({ x, y }) && !seen.has(cellKey({ x, y })))
                problems.push(`unreachable cell ${x},${y}`);
        }
    }
    return problems;
}
//# sourceMappingURL=grid.js.map