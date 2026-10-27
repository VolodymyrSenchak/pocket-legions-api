"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WALL_LENGTH = exports.HERO_COOLDOWN_ROUNDS = exports.HERO_USES = void 0;
exports.canUseHero = canUseHero;
exports.heroOptions = heroOptions;
exports.useHeroAbility = useHeroAbility;
const abilities_1 = require("./abilities");
const effects_1 = require("./effects");
const grid_1 = require("./grid");
const pathfinding_1 = require("./pathfinding");
const state_1 = require("./state");
const stats_1 = require("./stats");
// Hero abilities (design §5): a free action at the start of the turn, 2 uses (3 with the mantle), 3-round cooldown.
exports.HERO_USES = 2;
exports.HERO_COOLDOWN_ROUNDS = 3;
exports.WALL_LENGTH = 3;
function heroOf(battle, seat) {
    return battle.heroes.find((hero) => hero.seat === seat);
}
function canUseHero(battle, seat) {
    const hero = heroOf(battle, seat);
    return (!battle.result &&
        battle.activeSeat === seat &&
        !!hero &&
        !hero.usedThisTurn &&
        hero.usesLeft > 0 &&
        battle.round >= hero.readyRound);
}
function allCells(map) {
    const cells = [];
    for (let y = 0; y < map.size; y++)
        for (let x = 0; x < map.size; x++)
            cells.push({ x, y });
    return cells;
}
const ids = (stacks) => stacks.map((stack) => stack.id);
/** What the hero can target now, or null when the ability can't be used. */
function heroOptions(battle, map, seat) {
    if (!canUseHero(battle, seat))
        return null;
    const hero = heroOf(battle, seat);
    const living = (0, state_1.livingStacks)(battle);
    const enemies = living.filter((stack) => !(0, state_1.areAllies)(battle, stack.seat, seat) && !(0, abilities_1.isMagicImmune)(stack));
    const friends = living.filter((stack) => (0, state_1.areAllies)(battle, stack.seat, seat) && !(0, abilities_1.isMagicImmune)(stack));
    const own = living.filter((stack) => stack.seat === seat && !(0, abilities_1.isMagicImmune)(stack));
    const empty = { abilityId: hero.abilityId, targets: [], allies: [], cells: [] };
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
            return { ...empty, cells: allCells(map).filter((cell) => (0, pathfinding_1.isFreeCell)(battle, map, cell)) };
    }
}
/** Hero damage ignores defence; enemy dwarves take −25% (stone skin), the dragon shield another −20%. */
function heroDamage(ctx, seat, target, amount) {
    if ((0, abilities_1.isMagicImmune)(target))
        return;
    let damage = amount;
    if ((0, stats_1.raceOf)(ctx.battle, target) === "dwarves")
        damage *= 0.75;
    if (!(0, state_1.areAllies)(ctx.battle, seat, target.seat))
        damage *= 1 + (0, stats_1.bonusesOf)(ctx.battle, target.seat).fx.heroDmgTaken;
    (0, effects_1.applyDamage)(ctx, target, Math.max(1, Math.floor(damage)), { detail: "hero" });
}
function isStraightLine(cells) {
    if (cells.length !== exports.WALL_LENGTH)
        return false;
    const dx = cells[1].x - cells[0].x;
    const dy = cells[1].y - cells[0].y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
        return false;
    return cells.every((cell, i) => cell.x === cells[0].x + i * dx && cell.y === cells[0].y + i * dy);
}
function useHeroAbility(ctx, seat, payload) {
    const { battle, map } = ctx;
    const options = heroOptions(battle, map, seat);
    if (!options)
        return { ok: false, reason: "hero-unavailable" };
    const hero = heroOf(battle, seat);
    const power = (0, stats_1.heroPower)(battle, seat);
    const stackFrom = (id, allowed) => id !== undefined && allowed.includes(id) ? (0, state_1.findStack)(battle, id) : undefined;
    const announce = () => (0, state_1.emit)(ctx, { type: "heroAbility", seat, abilityId: options.abilityId, targetId: payload.target, cell: payload.cell });
    switch (options.abilityId) {
        case "heavenly_shield": {
            const target = stackFrom(payload.target, options.targets);
            if (!target)
                return { ok: false, reason: "bad-target" };
            announce();
            (0, effects_1.addStatus)(ctx, target, { id: "heavenly_shield", untilRound: battle.round, value: power });
            break;
        }
        case "blood_ritual": {
            const target = stackFrom(payload.target, options.targets);
            const ally = stackFrom(payload.ally, options.allies);
            if (!target || !ally)
                return { ok: false, reason: "bad-target" };
            announce();
            heroDamage(ctx, seat, target, 25 * power);
            (0, effects_1.healStack)(ctx, ally, Math.floor(25 * power), false, "blood_ritual");
            break;
        }
        case "earth_roots": {
            const target = stackFrom(payload.target, options.targets);
            if (!target)
                return { ok: false, reason: "bad-target" };
            announce();
            heroDamage(ctx, seat, target, 15 * power);
            if ((0, state_1.isAlive)(target))
                (0, effects_1.addStatus)(ctx, target, { id: "entangled", untilActivation: (0, effects_1.untilNextActivation)(target) });
            break;
        }
        case "battle_cry": {
            announce();
            for (const stack of (0, state_1.livingStacks)(battle)) {
                if (stack.seat === seat && !(0, abilities_1.isMagicImmune)(stack)) {
                    (0, effects_1.addStatus)(ctx, stack, { id: "battle_cry", untilRound: battle.round, value: power });
                }
            }
            break;
        }
        case "hellfire": {
            const center = payload.cell;
            if (!center || !options.cells.some((cell) => (0, grid_1.sameCell)(cell, center)))
                return { ok: false, reason: "bad-cell" };
            announce();
            for (const stack of (0, state_1.livingStacks)(battle).filter((candidate) => (0, grid_1.distance)(candidate, center) <= 1)) {
                heroDamage(ctx, seat, stack, 20 * power);
            }
            break;
        }
        case "stone_wall": {
            const cells = payload.cells ?? [];
            const free = (cell) => options.cells.some((option) => (0, grid_1.sameCell)(option, cell));
            if (!isStraightLine(cells) || !cells.every(free))
                return { ok: false, reason: "bad-cells" };
            announce();
            // 3 rounds counting the current one; the mantle makes it 4
            const rounds = Math.floor(exports.HERO_COOLDOWN_ROUNDS * power);
            for (const cell of cells)
                battle.walls.push({ x: cell.x, y: cell.y, untilRound: battle.round + rounds - 1 });
            (0, state_1.emit)(ctx, { type: "wallBuilt", seat, cells: cells.map((cell) => ({ x: cell.x, y: cell.y })) });
            break;
        }
    }
    hero.usesLeft -= 1;
    hero.usedThisTurn = true;
    hero.readyRound = battle.round + exports.HERO_COOLDOWN_ROUNDS;
    return { ok: true };
}
//# sourceMappingURL=heroes.js.map