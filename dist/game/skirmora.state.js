"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultSettings = exports.settingsSchema = exports.BUDGETS = exports.AUTO_SURRENDER_TIMEOUTS = exports.HISTORY_LIMIT = exports.GAME_TYPE = void 0;
exports.mapDef = mapDef;
exports.startProblem = startProblem;
exports.createInitialState = createInitialState;
exports.seatOf = seatOf;
exports.appendHistory = appendHistory;
exports.ok = ok;
exports.fail = fail;
const zod_1 = require("zod");
const maps_1 = require("../engine/data/maps");
const version_1 = require("../engine/version");
exports.GAME_TYPE = "skirmora";
// Plan §12.5: kept at 3000 (≈ 260 KB per row at worst) on purpose.
exports.HISTORY_LIMIT = 3000;
/** Plan §3.5, confirmed in §12.1: 3 timed-out turns in a row = automatic surrender. */
exports.AUTO_SURRENDER_TIMEOUTS = 3;
exports.BUDGETS = [500, 1000, 1500, 2000];
exports.settingsSchema = zod_1.z.object({
    mapId: zod_1.z.enum(maps_1.MAP_IDS).default("valley"),
    budget: zod_1.z.union([zod_1.z.literal(500), zod_1.z.literal(1000), zod_1.z.literal(1500), zod_1.z.literal(2000)]).default(1000),
    mode: zod_1.z.enum(["ffa", "teams"]).default("ffa"),
    turnSeconds: zod_1.z.number().int().min(30).max(90).default(45),
    // set by the server on create: whatever the client sends is replaced
    dataVersion: zod_1.z.unknown().transform(() => version_1.DATA_VERSION),
});
exports.defaultSettings = {
    mapId: "valley",
    budget: 1000,
    mode: "ffa",
    turnSeconds: 45,
    dataVersion: version_1.DATA_VERSION,
};
function mapDef(mapId) {
    return maps_1.MAPS.find((map) => map.id === mapId);
}
/** Player count allowed to start: FFA within the map's range, 2 vs 2 exactly 4. */
function startProblem(settings, players) {
    if (settings.mode === "teams") {
        if (!mapDef(settings.mapId).teams)
            return "This map has no 2 vs 2 mode";
        return players === 4 ? null : "2 vs 2 needs exactly 4 players";
    }
    const [min, max] = mapDef(settings.mapId).ffaPlayers;
    return players >= min && players <= max ? null : `This map is for ${min === max ? min : `${min}–${max}`} players`;
}
function createInitialState(ctx) {
    const problem = startProblem(ctx.settings, ctx.activePlayers.length);
    if (problem)
        return fail(problem, "conflict");
    return ok({
        phase: "army",
        seats: ctx.activePlayers.map((player, seat) => ({
            playerId: player.id,
            seat,
            // default teams: seats 0+2 vs 1+3
            team: ctx.settings.mode === "teams" ? (seat % 2) : null,
            raceId: null,
            army: null,
            armyReady: false,
            deployment: null,
            deployReady: false,
            eliminated: false,
            timeoutsInRow: 0,
        })),
        battle: null,
        result: null,
        history: [],
    });
}
function seatOf(state, playerId) {
    return state.seats.find((seat) => seat.playerId === playerId);
}
function appendHistory(state, events) {
    const history = [...state.history, ...events];
    return history.length > exports.HISTORY_LIMIT ? history.slice(history.length - exports.HISTORY_LIMIT) : history;
}
// Result helpers: the same shape as models/result.ts, built here so game/ keeps only type imports from models/.
function ok(result) {
    return { result, isSuccess: true };
}
function fail(error, errorStatus, errorCode, errorReason) {
    return {
        error,
        errorStatus,
        ...(errorCode ? { errorCode } : {}),
        ...(errorReason ? { errorReason } : {}),
        isSuccess: false,
    };
}
//# sourceMappingURL=skirmora.state.js.map