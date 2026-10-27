"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LUCK_MORALE_CAP = void 0;
exports.maxStacks = maxStacks;
exports.maxChampions = maxChampions;
exports.itemCost = itemCost;
exports.gearCap = gearCap;
exports.equippedItems = equippedItems;
exports.armyPoints = armyPoints;
exports.validateArmy = validateArmy;
exports.clampLuckMorale = clampLuckMorale;
exports.heroBonuses = heroBonuses;
exports.validateDeployment = validateDeployment;
const items_1 = require("./data/items");
const races_1 = require("./data/races");
const grid_1 = require("./grid");
/** Design §2: 6 stacks, 5 on 10×10 maps with 3–4 players. */
function maxStacks(mapSize, playerCount) {
    return mapSize <= 10 && playerCount >= 3 ? items_1.BALANCE.maxStacks - 1 : items_1.BALANCE.maxStacks;
}
/** 2 champions (tier 10 units) at budget 1000, scaled with the budget, at least 1. */
function maxChampions(budget) {
    return Math.max(1, Math.floor((2 * budget) / items_1.BALANCE.defaultBudget));
}
/** Item prices are set for 1000 points and scale with the budget (design §2). */
function itemCost(itemId, budget) {
    return Math.round((items_1.ITEMS[itemId].cost * budget) / items_1.BALANCE.defaultBudget);
}
function gearCap(budget) {
    return Math.floor(budget * items_1.BALANCE.gearCapShare);
}
function equippedItems(army) {
    const singles = items_1.SLOTS.filter((slot) => slot !== "ring")
        .map((slot) => army.items[slot])
        .filter((id) => id !== undefined);
    return [...singles, ...army.rings];
}
function armyPoints(army, budget) {
    const unitPoints = army.stacks.reduce((sum, stack) => sum + (races_1.UNITS[stack.unitId]?.cost ?? 0) * stack.count, 0);
    const gearPoints = equippedItems(army).reduce((sum, id) => sum + (items_1.ITEMS[id] ? itemCost(id, budget) : 0), 0);
    return { unitPoints, gearPoints };
}
/**
 * Plan §6.7. Units, gear and the budget are checked in this order; the first problem wins.
 * Plan §12.3: one budget shared by units and gear, with gear capped at 30%.
 */
function validateArmy(army, raceId, rules) {
    if (army.stacks.length === 0)
        return { ok: false, reason: "no-stacks" };
    if (army.stacks.length > maxStacks(rules.mapSize, rules.playerCount))
        return { ok: false, reason: "too-many-stacks" };
    const perType = new Map();
    let champions = 0;
    for (const stack of army.stacks) {
        const unit = Object.hasOwn(races_1.UNITS, stack.unitId) ? races_1.UNITS[stack.unitId] : undefined;
        if (!unit)
            return { ok: false, reason: "unknown-unit" };
        if (unit.raceId !== raceId)
            return { ok: false, reason: "wrong-race" };
        if (!Number.isInteger(stack.count) || stack.count < 1)
            return { ok: false, reason: "bad-count" };
        perType.set(unit.id, (perType.get(unit.id) ?? 0) + 1);
        if (perType.get(unit.id) > 2)
            return { ok: false, reason: "too-many-of-type" };
        if (unit.tier === 10)
            champions += stack.count;
    }
    if (champions > maxChampions(rules.budget))
        return { ok: false, reason: "too-many-champions" };
    for (const [slot, id] of Object.entries(army.items)) {
        if (id === undefined)
            continue;
        if (!Object.hasOwn(items_1.ITEMS, id))
            return { ok: false, reason: "unknown-item" };
        if (items_1.ITEMS[id].slot !== slot)
            return { ok: false, reason: "wrong-slot" };
    }
    if (army.rings.length > 2)
        return { ok: false, reason: "too-many-rings" };
    for (const id of army.rings) {
        if (!Object.hasOwn(items_1.ITEMS, id))
            return { ok: false, reason: "unknown-item" };
        if (items_1.ITEMS[id].slot !== "ring")
            return { ok: false, reason: "wrong-slot" };
    }
    const { unitPoints, gearPoints } = armyPoints(army, rules.budget);
    if (gearPoints > gearCap(rules.budget))
        return { ok: false, reason: "gear-over-cap" };
    if (unitPoints + gearPoints > rules.budget)
        return { ok: false, reason: "over-budget" };
    return { ok: true, unitPoints, gearPoints };
}
exports.LUCK_MORALE_CAP = 5;
function clampLuckMorale(value) {
    return Math.max(-exports.LUCK_MORALE_CAP, Math.min(exports.LUCK_MORALE_CAP, value));
}
function heroBonuses(raceId, items) {
    const hero = races_1.RACES[raceId].hero;
    const sum = {
        atk: hero.atk,
        def: hero.def,
        luck: hero.luck,
        morale: hero.morale,
        rangedTaken: 0,
        heroPower: 0,
        heroUses: 0,
        spdRound1: 0,
        retaliations: 0,
        spdGround: 0,
        deployRows: 0,
        spdFly: 0,
        range: 0,
        shots: 0,
        meleeLifesteal: 0,
        heroDmgTaken: 0,
    };
    for (const id of items) {
        for (const [key, value] of Object.entries(items_1.ITEMS[id].fx)) {
            sum[key] += value;
        }
    }
    const { atk, def, luck, morale, ...fx } = sum;
    return { atk, def, luck: clampLuckMorale(luck), morale: clampLuckMorale(morale), fx };
}
/** Every stack placed exactly once, inside the zone, on a free cell, one stack per cell. */
function validateDeployment(map, zone, stackCount, placements) {
    const zoneKeys = new Set(zone.map(grid_1.cellKey));
    const usedStacks = new Set();
    const usedCells = new Set();
    for (const placement of placements) {
        if (!Number.isInteger(placement.stackIndex) || placement.stackIndex < 0 || placement.stackIndex >= stackCount) {
            return { ok: false, reason: "missing-stack" };
        }
        if (usedStacks.has(placement.stackIndex))
            return { ok: false, reason: "duplicate-stack" };
        usedStacks.add(placement.stackIndex);
        if (!zoneKeys.has((0, grid_1.cellKey)(placement)))
            return { ok: false, reason: "outside-zone" };
        if (map.blocked[(0, grid_1.cellIndex)(map, placement)])
            return { ok: false, reason: "cell-blocked" };
        if (usedCells.has((0, grid_1.cellKey)(placement)))
            return { ok: false, reason: "cell-taken" };
        usedCells.add((0, grid_1.cellKey)(placement));
    }
    return usedStacks.size === stackCount ? { ok: true } : { ok: false, reason: "missing-stack" };
}
//# sourceMappingURL=army.js.map