"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.project = project;
const army_1 = require("../engine/army");
const skirmora_actions_1 = require("./skirmora.actions");
const skirmora_hints_1 = require("./skirmora.hints");
const skirmora_state_1 = require("./skirmora.state");
function battleView(battle) {
    return {
        round: battle.round,
        order: [...battle.order],
        firstSeat: battle.firstSeat,
        activeSeat: battle.activeSeat,
        turn: battle.turn,
        turnDeadline: battle.turnDeadline,
        bonusStackId: battle.bonusStackId,
        sides: battle.sides.map((side) => ({ seat: side.seat, team: side.team, raceId: side.raceId, items: [...side.items] })),
        stacks: [...battle.stacks]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((stack) => ({
            id: stack.id,
            seat: stack.seat,
            unitId: stack.unitId,
            count: stack.count,
            hpTop: stack.hpTop,
            startCount: stack.startCount,
            x: stack.x,
            y: stack.y,
            shots: stack.shots,
            retaliationsLeft: stack.retaliationsLeft,
            activated: stack.activated,
            statuses: stack.statuses.map((status) => ({ ...status })),
            rage: stack.rage,
            resurrectUsed: stack.resurrectUsed,
        })),
        heroes: battle.heroes.map((hero) => ({
            seat: hero.seat,
            abilityId: hero.abilityId,
            usesLeft: hero.usesLeft,
            readyRound: hero.readyRound,
            usedThisTurn: hero.usedThisTurn,
        })),
        walls: battle.walls.map((wall) => ({ x: wall.x, y: wall.y, untilRound: wall.untilRound })),
    };
}
function project(state, viewerId, ctx) {
    const me = (0, skirmora_state_1.seatOf)(state, viewerId);
    const { settings } = ctx;
    let mine = null;
    if (me && (state.phase === "army" || state.phase === "deploy")) {
        const points = me.army ? (0, army_1.armyPoints)(me.army, settings.budget) : { unitPoints: 0, gearPoints: 0 };
        mine = {
            army: me.army ? structuredClone(me.army) : null,
            budget: settings.budget,
            gearCap: (0, army_1.gearCap)(settings.budget),
            ...points,
            zone: state.phase === "deploy" ? (0, skirmora_actions_1.deployZoneOf)(ctx, state, me) : null,
            deployment: me.deployment ? me.deployment.map((placement) => ({ ...placement })) : null,
        };
    }
    const battle = state.battle;
    return {
        phase: state.phase,
        mapId: settings.mapId,
        mode: settings.mode,
        budget: settings.budget,
        turnSeconds: settings.turnSeconds,
        dataVersion: settings.dataVersion,
        seats: state.seats.map((seat) => ({
            playerId: seat.playerId,
            seat: seat.seat,
            team: seat.team,
            raceId: seat.raceId,
            armyReady: seat.armyReady,
            deployReady: seat.deployReady,
            eliminated: seat.eliminated,
        })),
        mySeat: me ? me.seat : null,
        mine,
        battle: battle ? battleView(battle) : null,
        hints: battle && me && state.phase === "battle" ? (0, skirmora_hints_1.buildHints)(battle, me.seat) : null,
        events: battle ? battle.events.map((event) => structuredClone(event)) : [],
        result: state.result ? structuredClone(state.result) : null,
    };
}
//# sourceMappingURL=skirmora.projection.js.map