"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.moveKind = moveKind;
exports.isTerrainBlocked = isTerrainBlocked;
exports.isFreeCell = isFreeCell;
exports.reachable = reachable;
exports.findReach = findReach;
const grid_1 = require("./grid");
const state_1 = require("./state");
const stats_1 = require("./stats");
function moveKind(stack) {
    if ((0, stats_1.hasAbility)(stack, "teleport"))
        return "teleport";
    return (0, stats_1.unitOf)(stack).fly ? "fly" : "walk";
}
/** Obstacles and the dwarf hero's walls. */
function isTerrainBlocked(battle, map, cell) {
    if (!(0, grid_1.inBounds)(map, cell) || map.blocked[(0, grid_1.cellIndex)(map, cell)])
        return true;
    return battle.walls.some((wall) => wall.x === cell.x && wall.y === cell.y);
}
/** Where a stack can stand: inside the map, no obstacle, no wall, no living stack. */
function isFreeCell(battle, map, cell, ignore) {
    if (isTerrainBlocked(battle, map, cell))
        return false;
    return !battle.stacks.some((stack) => stack !== ignore && (0, state_1.isAlive)(stack) && stack.x === cell.x && stack.y === cell.y);
}
/**
 * Cells a stack can end its move on (plan §6.2), its own cell excluded, ordered by cost then row then column.
 * Walkers: 8 directions, no corner cutting past blocked terrain, through allies but not enemies, never stop on a stack.
 * Flyers and teleporters: any free cell within speed.
 */
function reachable(battle, map, stack, speed = (0, stats_1.speedOf)(battle, stack)) {
    const start = (0, state_1.cellOf)(stack);
    if (speed <= 0)
        return [];
    const kind = moveKind(stack);
    const result = [];
    if (kind !== "walk") {
        for (let y = Math.max(0, start.y - speed); y <= Math.min(map.size - 1, start.y + speed); y++) {
            for (let x = Math.max(0, start.x - speed); x <= Math.min(map.size - 1, start.x + speed); x++) {
                const cell = { x, y };
                if ((x !== start.x || y !== start.y) && isFreeCell(battle, map, cell, stack)) {
                    result.push({ cell, path: [start, cell], cost: (0, grid_1.distance)(start, cell) });
                }
            }
        }
        return sortReach(result);
    }
    const occupant = new Map();
    for (const other of battle.stacks) {
        if (other !== stack && (0, state_1.isAlive)(other))
            occupant.set((0, grid_1.cellKey)(other), other);
    }
    const terrainFree = (cell) => !isTerrainBlocked(battle, map, cell);
    const passable = (cell) => {
        if (!terrainFree(cell))
            return false;
        const other = occupant.get((0, grid_1.cellKey)(cell));
        return !other || (0, state_1.areAllies)(battle, other.seat, stack.seat);
    };
    const previous = new Map([[(0, grid_1.cellKey)(start), null]]);
    let frontier = [start];
    for (let cost = 1; cost <= speed && frontier.length; cost++) {
        const next = [];
        for (const cell of frontier) {
            for (const d of grid_1.DIRECTIONS) {
                const to = { x: cell.x + d.x, y: cell.y + d.y };
                const key = (0, grid_1.cellKey)(to);
                if (previous.has(key) || !passable(to))
                    continue;
                if (d.x && d.y && (!terrainFree({ x: cell.x + d.x, y: cell.y }) || !terrainFree({ x: cell.x, y: cell.y + d.y })))
                    continue;
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
function tracePath(previous, end) {
    const path = [];
    let cursor = end;
    while (cursor) {
        path.unshift(cursor);
        cursor = previous.get((0, grid_1.cellKey)(cursor)) ?? null;
    }
    return path;
}
function sortReach(list) {
    return list.sort((a, b) => a.cost - b.cost || a.cell.y - b.cell.y || a.cell.x - b.cell.x);
}
/** The reach entry for `cell`, or the stack's own cell with cost 0. */
function findReach(battle, map, stack, cell) {
    if (cell.x === stack.x && cell.y === stack.y)
        return { cell, path: [(0, state_1.cellOf)(stack)], cost: 0 };
    return reachable(battle, map, stack).find((reach) => reach.cell.x === cell.x && reach.cell.y === cell.y);
}
//# sourceMappingURL=pathfinding.js.map