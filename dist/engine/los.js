"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lineCells = lineCells;
exports.hasLineOfSight = hasLineOfSight;
const grid_1 = require("./grid");
/** Cells strictly between `from` and `to` on the Bresenham line between cell centres. */
function lineCells(from, to) {
    const cells = [];
    const dx = Math.abs(to.x - from.x);
    const dy = -Math.abs(to.y - from.y);
    const sx = from.x < to.x ? 1 : -1;
    const sy = from.y < to.y ? 1 : -1;
    let err = dx + dy;
    let x = from.x;
    let y = from.y;
    while (x !== to.x || y !== to.y) {
        const e2 = 2 * err;
        if (e2 >= dy) {
            err += dy;
            x += sx;
        }
        if (e2 <= dx) {
            err += dx;
            y += sy;
        }
        if (x !== to.x || y !== to.y)
            cells.push({ x, y });
    }
    return cells;
}
/** Plan §6.3: only high obstacles and hero walls block a shot; low obstacles and stacks don't. */
function hasLineOfSight(battle, map, from, to) {
    return lineCells(from, to).every((cell) => !map.high[(0, grid_1.cellIndex)(map, cell)] && !battle.walls.some((wall) => wall.x === cell.x && wall.y === cell.y));
}
//# sourceMappingURL=los.js.map