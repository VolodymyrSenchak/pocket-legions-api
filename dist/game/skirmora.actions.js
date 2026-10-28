"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.skirmoraActions = void 0;
exports.deployZoneOf = deployZoneOf;
exports.onPlayerRemoved = onPlayerRemoved;
const zod_1 = require("zod");
const army_1 = require("../engine/army");
const battle_1 = require("../engine/battle");
const items_1 = require("../engine/data/items");
const races_1 = require("../engine/data/races");
const grid_1 = require("../engine/grid");
const version_1 = require("../engine/version");
const skirmora_state_1 = require("./skirmora.state");
/** Wraps a handler with the checks every action shares: data version and the game being over. */
function defineAction(schema, handle, options = {}) {
    return {
        schema,
        handle: (ctx, state, payload) => {
            // plan §12.4: a balance deploy ends running games (accepted for now)
            if (ctx.settings.dataVersion !== version_1.DATA_VERSION) {
                return (0, skirmora_state_1.fail)("The game was updated — start a new room", "conflict", "outdated");
            }
            if (state.phase === "over" && !options.whenOver)
                return (0, skirmora_state_1.fail)("The game is over", "conflict");
            return handle(ctx, structuredClone(state), payload);
        },
    };
}
const next = (state, finished = false) => (0, skirmora_state_1.ok)({ state, ...(finished ? { finished } : {}) });
function requireSeat(ctx, state) {
    const seat = (0, skirmora_state_1.seatOf)(state, ctx.actorId);
    return seat ?? (0, skirmora_state_1.fail)("You have no seat in this game", "forbidden");
}
function requirePhase(state, phase) {
    return state.phase === phase ? null : (0, skirmora_state_1.fail)(`Not possible in the ${state.phase} phase`, "conflict");
}
const isSeat = (value) => value.playerId !== undefined;
function battleEnv(ctx) {
    return { rng: ctx.rng, nowMs: ctx.now.getTime(), turnSeconds: ctx.settings.turnSeconds };
}
/** Teams must both be non-empty with at most 2 players (2 vs 2, or 2 vs 1 after someone left). */
function teamsProblem(state, ctx) {
    if (ctx.settings.mode !== "teams")
        return null;
    const sizes = [0, 1].map((team) => state.seats.filter((seat) => seat.team === team).length);
    return sizes.every((size) => size >= 1 && size <= 2) ? null : "Teams must be 2 vs 2";
}
function deployZoneOf(ctx, state, seat) {
    const extraRows = seat.army && seat.raceId ? (0, army_1.heroBonuses)(seat.raceId, (0, army_1.equippedItems)(seat.army)).fx.deployRows : 0;
    return (0, battle_1.zoneFor)((0, grid_1.getMap)(ctx.settings.mapId), ctx.settings.mode, state.seats, seat.seat, extraRows);
}
/** Army → deploy once every seat is ready. */
function maybeStartDeploy(state) {
    if (state.phase === "army" && state.seats.every((seat) => seat.armyReady)) {
        state.phase = "deploy";
    }
}
/** Deploy → battle once every seat is ready: random first seat, `turnStarted`. */
function maybeStartBattle(ctx, state) {
    if (state.phase !== "deploy" || !state.seats.every((seat) => seat.deployReady))
        return;
    const setup = {
        mapId: ctx.settings.mapId,
        mode: ctx.settings.mode,
        sides: state.seats.map((seat) => ({
            seat: seat.seat,
            team: seat.team,
            raceId: seat.raceId,
            army: seat.army,
            deployment: seat.deployment,
        })),
    };
    const { battle, events } = (0, battle_1.createBattle)(setup, battleEnv(ctx));
    state.phase = "battle";
    state.battle = battle;
    state.history = (0, skirmora_state_1.appendHistory)(state, events);
}
/**
 * After an engine step: log the events, mirror eliminations, move to `over` when the battle ends.
 * The session stays `in_progress` so the room can play a rematch (client plan §15.2).
 */
function afterBattleStep(state, events) {
    const battle = state.battle;
    state.history = (0, skirmora_state_1.appendHistory)(state, events);
    for (const side of battle.sides) {
        const seat = state.seats.find((candidate) => candidate.seat === side.seat);
        if (seat)
            seat.eliminated = side.eliminated;
    }
    if (battle.result) {
        state.phase = "over";
        state.result = { ...battle.result };
    }
    return next(state);
}
function stepFailure(result) {
    return result.code === "not-your-turn"
        ? (0, skirmora_state_1.fail)("It is not your turn", "conflict", "not-your-turn")
        : (0, skirmora_state_1.fail)(`Illegal action: ${result.reason}`, "bad-request", "illegal-action", result.reason);
}
const cellSchema = zod_1.z.object({ x: zod_1.z.number().int(), y: zod_1.z.number().int() });
const id = zod_1.z.string().min(1).max(40);
const itemsSchema = zod_1.z.object(Object.fromEntries(items_1.SLOTS.filter((slot) => slot !== "ring").map((slot) => [slot, id.optional()])));
exports.skirmoraActions = {
    pickRace: defineAction(zod_1.z.object({ raceId: zod_1.z.enum(races_1.RACE_IDS) }), (ctx, state, { raceId }) => {
        const seat = requireSeat(ctx, state);
        if (!isSeat(seat))
            return seat;
        const wrongPhase = requirePhase(state, "army");
        if (wrongPhase)
            return wrongPhase;
        if (seat.armyReady)
            return (0, skirmora_state_1.fail)("Unready first to change the race", "conflict");
        seat.raceId = raceId;
        seat.army = null;
        return next(state);
    }),
    setTeam: defineAction(zod_1.z.object({ playerId: id, team: zod_1.z.union([zod_1.z.literal(0), zod_1.z.literal(1)]) }), (ctx, state, { playerId, team }) => {
        if (ctx.actorId !== ctx.hostPlayerId)
            return (0, skirmora_state_1.fail)("Only the host can do this", "forbidden");
        const wrongPhase = requirePhase(state, "army");
        if (wrongPhase)
            return wrongPhase;
        if (ctx.settings.mode !== "teams")
            return (0, skirmora_state_1.fail)("Teams exist only in 2 vs 2", "conflict");
        const seat = (0, skirmora_state_1.seatOf)(state, playerId);
        if (!seat)
            return (0, skirmora_state_1.fail)("Player not found", "not-found");
        seat.team = team;
        return next(state);
    }),
    submitArmy: defineAction(zod_1.z.object({
        stacks: zod_1.z.array(zod_1.z.object({ unitId: id, count: zod_1.z.number().int() })).max(12),
        items: itemsSchema.default({}),
        rings: zod_1.z.array(id).max(4).default([]),
    }), (ctx, state, payload) => {
        const seat = requireSeat(ctx, state);
        if (!isSeat(seat))
            return seat;
        const wrongPhase = requirePhase(state, "army");
        if (wrongPhase)
            return wrongPhase;
        if (!seat.raceId)
            return (0, skirmora_state_1.fail)("Pick a race first", "bad-request", "invalid-army", "no-race");
        const teams = teamsProblem(state, ctx);
        if (teams)
            return (0, skirmora_state_1.fail)(teams, "conflict", undefined, "unbalanced-teams");
        const army = payload;
        const check = (0, army_1.validateArmy)(army, seat.raceId, {
            budget: ctx.settings.budget,
            mapSize: (0, grid_1.getMap)(ctx.settings.mapId).size,
            playerCount: state.seats.length,
        });
        if (!check.ok)
            return (0, skirmora_state_1.fail)(`Invalid army: ${check.reason}`, "bad-request", "invalid-army", check.reason);
        seat.army = { stacks: army.stacks.map((stack) => ({ ...stack })), items: { ...army.items }, rings: [...army.rings] };
        seat.armyReady = true;
        maybeStartDeploy(state);
        return next(state);
    }),
    unready: defineAction(zod_1.z.object({}), (ctx, state) => {
        const seat = requireSeat(ctx, state);
        if (!isSeat(seat))
            return seat;
        if (state.phase === "army")
            seat.armyReady = false;
        else if (state.phase === "deploy")
            seat.deployReady = false;
        else
            return (0, skirmora_state_1.fail)("Not possible in the battle", "conflict");
        return next(state);
    }),
    submitDeploy: defineAction(zod_1.z.object({ placements: zod_1.z.array(zod_1.z.object({ stackIndex: zod_1.z.number().int(), x: zod_1.z.number().int(), y: zod_1.z.number().int() })).max(12) }), (ctx, state, { placements }) => {
        const seat = requireSeat(ctx, state);
        if (!isSeat(seat))
            return seat;
        const wrongPhase = requirePhase(state, "deploy");
        if (wrongPhase)
            return wrongPhase;
        const check = (0, army_1.validateDeployment)((0, grid_1.getMap)(ctx.settings.mapId), deployZoneOf(ctx, state, seat), seat.army.stacks.length, placements);
        if (!check.ok)
            return (0, skirmora_state_1.fail)(`Invalid deployment: ${check.reason}`, "bad-request", "invalid-deploy", check.reason);
        seat.deployment = placements.map((placement) => ({ ...placement }));
        seat.deployReady = true;
        maybeStartBattle(ctx, state);
        return next(state);
    }),
    act: defineAction(zod_1.z.object({
        stackId: id,
        kind: zod_1.z.enum(["move", "attack", "shoot", "ability", "defend"]),
        cell: cellSchema.optional(),
        target: id.optional(),
    }), (ctx, state, payload) => {
        const seat = requireSeat(ctx, state);
        if (!isSeat(seat))
            return seat;
        const wrongPhase = requirePhase(state, "battle");
        if (wrongPhase)
            return wrongPhase;
        const result = (0, battle_1.applyAct)(state.battle, seat.seat, payload, battleEnv(ctx));
        if (!result.ok)
            return stepFailure(result);
        seat.timeoutsInRow = 0;
        return afterBattleStep(state, result.events);
    }),
    heroAbility: defineAction(zod_1.z.object({ target: id.optional(), ally: id.optional(), cell: cellSchema.optional(), cells: zod_1.z.array(cellSchema).max(3).optional() }), (ctx, state, payload) => {
        const seat = requireSeat(ctx, state);
        if (!isSeat(seat))
            return seat;
        const wrongPhase = requirePhase(state, "battle");
        if (wrongPhase)
            return wrongPhase;
        const result = (0, battle_1.applyHeroAbility)(state.battle, seat.seat, payload, battleEnv(ctx));
        if (!result.ok)
            return stepFailure(result);
        return afterBattleStep(state, result.events);
    }),
    claimTimeout: defineAction(zod_1.z.object({}), (ctx, state) => {
        const claimer = requireSeat(ctx, state);
        if (!isSeat(claimer))
            return claimer;
        const wrongPhase = requirePhase(state, "battle");
        if (wrongPhase)
            return wrongPhase;
        const battle = state.battle;
        if (ctx.now.getTime() < Date.parse(battle.turnDeadline)) {
            return (0, skirmora_state_1.fail)("The turn has not timed out yet", "conflict", "too-early");
        }
        const late = state.seats.find((seat) => seat.seat === battle.activeSeat);
        late.timeoutsInRow += 1;
        const events = late.timeoutsInRow >= skirmora_state_1.AUTO_SURRENDER_TIMEOUTS
            ? (0, battle_1.eliminateSeat)(battle, late.seat, battleEnv(ctx), "timeout")
            : (0, battle_1.applyTimeout)(battle, battleEnv(ctx));
        return afterBattleStep(state, events);
    }),
    /** Client plan §15.2: the host starts a rematch in the same room, everyone keeps race and army (to resubmit or change). */
    rematch: defineAction(zod_1.z.object({}), (ctx, state) => {
        if (ctx.actorId !== ctx.hostPlayerId)
            return (0, skirmora_state_1.fail)("Only the host can do this", "forbidden");
        const wrongPhase = requirePhase(state, "over");
        if (wrongPhase)
            return wrongPhase;
        const active = new Set(ctx.activePlayers.map((player) => player.id));
        const seats = state.seats.filter((seat) => active.has(seat.playerId));
        const problem = (0, skirmora_state_1.startProblem)(ctx.settings, seats.length);
        if (problem)
            return (0, skirmora_state_1.fail)(`${problem} — start a new room`, "conflict");
        state.seats = seats.map((seat) => ({
            ...seat,
            armyReady: false,
            deployment: null,
            deployReady: false,
            eliminated: false,
            timeoutsInRow: 0,
        }));
        state.phase = "army";
        state.battle = null;
        state.result = null;
        state.history = [];
        return next(state);
    }, { whenOver: true }),
    surrender: defineAction(zod_1.z.object({}), (ctx, state) => {
        const seat = requireSeat(ctx, state);
        if (!isSeat(seat))
            return seat;
        const wrongPhase = requirePhase(state, "battle");
        if (wrongPhase)
            return wrongPhase;
        if (seat.eliminated)
            return (0, skirmora_state_1.fail)("You are already out", "conflict");
        return afterBattleStep(state, (0, battle_1.eliminateSeat)(state.battle, seat.seat, battleEnv(ctx), "surrender"));
    }),
};
/** Plan §7.4: before the battle the seat is dropped; in battle it is eliminated. */
function onPlayerRemoved(ctx, input, playerId) {
    const state = structuredClone(input);
    const seat = (0, skirmora_state_1.seatOf)(state, playerId);
    if (!seat)
        return { state: input };
    if (state.phase === "over") {
        // drop everyone who has left; with fewer than 2 there is nobody to play a rematch with, so the room closes
        const active = new Set(ctx.activePlayers.map((player) => player.id));
        state.seats = state.seats.filter((candidate) => candidate !== seat && active.has(candidate.playerId));
        return { state, finished: state.seats.length < 2 };
    }
    if (state.phase === "battle") {
        const transition = afterBattleStep(state, (0, battle_1.eliminateSeat)(state.battle, seat.seat, battleEnv(ctx), "left"));
        return transition.result;
    }
    state.seats = state.seats.filter((candidate) => candidate !== seat);
    const teamEmpty = ctx.settings.mode === "teams" && [0, 1].some((team) => !state.seats.some((candidate) => candidate.team === team));
    if (state.seats.length < 2 || teamEmpty) {
        state.phase = "over";
        state.result = { winnerSeats: [], reason: "not-enough-players" };
        return { state, finished: true };
    }
    if (state.phase === "army") {
        maybeStartDeploy(state);
    }
    else {
        // fewer players can mean other deploy zones (corners → columns), so everyone places again
        for (const other of state.seats) {
            other.deployment = null;
            other.deployReady = false;
        }
    }
    return { state };
}
//# sourceMappingURL=skirmora.actions.js.map