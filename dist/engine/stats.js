"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MECHANISMS = void 0;
exports.unitOf = unitOf;
exports.hasAbility = hasAbility;
exports.bonusesOf = bonusesOf;
exports.raceOf = raceOf;
exports.isUndead = isUndead;
exports.isShooter = isShooter;
exports.furyBonus = furyBonus;
exports.attackOf = attackOf;
exports.formationBonus = formationBonus;
exports.defenceOf = defenceOf;
exports.luckOf = luckOf;
exports.moraleOf = moraleOf;
exports.rangeOf = rangeOf;
exports.startingShots = startingShots;
exports.speedOf = speedOf;
exports.retaliationsPerRound = retaliationsPerRound;
exports.heroPower = heroPower;
exports.statusValue = statusValue;
exports.totalHp = totalHp;
exports.stackPoints = stackPoints;
const army_1 = require("./army");
const races_1 = require("./data/races");
const grid_1 = require("./grid");
const state_1 = require("./state");
// Effective stats of a stack: unit + hero + gear + racial trait + statuses (plan §6.4 step 3).
/** Units whose morale is always 0 (design §3) besides the undead race. */
exports.MECHANISMS = new Set(["gyrocopter", "golem"]);
function unitOf(stack) {
    return races_1.UNITS[stack.unitId];
}
function hasAbility(stack, id) {
    return unitOf(stack).abilities.includes(id);
}
function bonusesOf(battle, seat) {
    const side = (0, state_1.sideOf)(battle, seat);
    return (0, army_1.heroBonuses)(side.raceId, side.items);
}
function raceOf(battle, stack) {
    return (0, state_1.sideOf)(battle, stack.seat).raceId;
}
function isUndead(battle, stack) {
    return raceOf(battle, stack) === "vampires";
}
function isShooter(stack) {
    return unitOf(stack).ranged !== undefined;
}
/** Barbarian Лють: +1 attack per lost unit, up to +4. */
function furyBonus(battle, stack) {
    return raceOf(battle, stack) === "barbarians" ? Math.min(4, Math.max(0, stack.startCount - stack.count)) : 0;
}
function attackOf(battle, stack) {
    let attack = unitOf(stack).atk + bonusesOf(battle, stack.seat).atk + furyBonus(battle, stack) + stack.rage;
    if ((0, state_1.hasStatus)(stack, "war_drum"))
        attack += 4;
    if ((0, state_1.hasStatus)(stack, "diseased"))
        attack -= 3;
    return Math.max(0, attack);
}
/** Knight Стрій: +2 defence while another allied stack stands next to it. */
function formationBonus(battle, stack) {
    if (raceOf(battle, stack) !== "knights")
        return 0;
    const guarded = battle.stacks.some((other) => other !== stack && (0, state_1.isAlive)(other) && (0, state_1.areAllies)(battle, other.seat, stack.seat) && (0, grid_1.isAdjacent)(other, stack));
    return guarded ? 2 : 0;
}
function defenceOf(battle, stack) {
    let defence = unitOf(stack).def + bonusesOf(battle, stack.seat).def + formationBonus(battle, stack);
    if ((0, state_1.hasStatus)(stack, "rune_shield"))
        defence += 5;
    defence = Math.max(0, defence);
    if ((0, state_1.hasStatus)(stack, "defending"))
        defence *= raceOf(battle, stack) === "dwarves" ? 1.5 : 1.3;
    return defence;
}
function luckOf(battle, stack) {
    const race = raceOf(battle, stack);
    let luck = bonusesOf(battle, stack.seat).luck;
    if (race === "demons")
        luck += 1;
    if (race === "elves" && isShooter(stack))
        luck += 1;
    luck = (0, army_1.clampLuckMorale)(luck);
    // demons never roll negative luck
    return race === "demons" ? Math.max(0, luck) : luck;
}
function moraleOf(battle, stack) {
    if (isUndead(battle, stack) || exports.MECHANISMS.has(stack.unitId))
        return 0;
    return bonusesOf(battle, stack.seat).morale;
}
function rangeOf(battle, stack) {
    const ranged = unitOf(stack).ranged;
    if (!ranged)
        return 0;
    const elves = raceOf(battle, stack) === "elves" ? 1 : 0;
    return ranged.range + elves + bonusesOf(battle, stack.seat).fx.range;
}
function startingShots(battle, stack) {
    const ranged = races_1.UNITS[stack.unitId].ranged;
    return ranged ? ranged.shots + bonusesOf(battle, stack.seat).fx.shots : 0;
}
function speedOf(battle, stack) {
    if ((0, state_1.hasStatus)(stack, "entangled"))
        return 0;
    const unit = unitOf(stack);
    const fx = bonusesOf(battle, stack.seat).fx;
    let speed = unit.spd + (unit.fly ? fx.spdFly : fx.spdGround);
    if (battle.round === 1)
        speed += fx.spdRound1;
    if ((0, state_1.hasStatus)(stack, "maimed"))
        speed -= 2;
    return Math.max(1, speed);
}
function retaliationsPerRound(battle, stack) {
    return 1 + bonusesOf(battle, stack.seat).fx.retaliations;
}
/** Hero ability strength: 1, or 1.5 with the mantle. */
function heroPower(battle, seat) {
    return 1 + bonusesOf(battle, seat).fx.heroPower;
}
function statusValue(stack, id, fallback = 1) {
    return (0, state_1.getStatus)(stack, id)?.value ?? fallback;
}
function totalHp(stack) {
    return stack.count > 0 ? (stack.count - 1) * unitOf(stack).hp + stack.hpTop : 0;
}
/** Points of a living stack for the round-limit score: units × cost. */
function stackPoints(stack) {
    return stack.count * unitOf(stack).cost;
}
//# sourceMappingURL=stats.js.map