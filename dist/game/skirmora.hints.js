"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildHints = buildHints;
const battle_1 = require("../engine/battle");
const damage_1 = require("../engine/damage");
const grid_1 = require("../engine/grid");
const heroes_1 = require("../engine/heroes");
const turns_1 = require("../engine/turns");
const plain = (cell) => ({ x: cell.x, y: cell.y });
/** Hints for `seat`, or null when it isn't that seat's turn. */
function buildHints(battle, seat) {
    if (battle.result || battle.activeSeat !== seat)
        return null;
    const map = (0, grid_1.getMap)(battle.mapId);
    const stacks = (0, turns_1.actableStacks)(battle)
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((stack) => {
        const options = (0, battle_1.stackOptions)(battle, map, stack);
        return {
            stackId: stack.id,
            moves: options.moves.map((reach) => plain(reach.cell)),
            attacks: options.attacks.map((attack) => ({
                targetId: attack.target.id,
                from: attack.from.map((reach) => plain(reach.cell)),
                preview: (0, damage_1.preview)(battle, {
                    attacker: stack,
                    target: attack.target,
                    mode: "melee",
                    moved: attack.from[0].cost,
                    retaliation: false,
                }),
            })),
            shots: options.shots.map((shot) => ({
                targetId: shot.target.id,
                penalty: shot.penalties,
                preview: (0, damage_1.preview)(battle, { attacker: stack, target: shot.target, mode: "ranged", moved: 0, retaliation: false }),
            })),
            abilities: options.abilities.map((ability) => ({
                abilityId: ability.abilityId,
                targets: ability.targets.map((target) => target.id),
            })),
            canDefend: options.canDefend,
        };
    });
    const hero = (0, heroes_1.heroOptions)(battle, map, seat);
    return {
        stacks,
        hero: hero ? { abilityId: hero.abilityId, targets: hero.targets, allies: hero.allies, cells: hero.cells.map(plain) } : null,
    };
}
//# sourceMappingURL=skirmora.hints.js.map