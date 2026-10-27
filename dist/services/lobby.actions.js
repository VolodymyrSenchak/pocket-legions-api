"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lobbyActions = void 0;
const zod_1 = require("zod");
const models_1 = require("../models");
const roster_1 = require("./roster");
const settings_1 = require("./settings");
function defineLobbyAction(schema, handle) {
    return { schema, handle: (env, draft, payload) => handle(env, draft, payload) };
}
function requireHost(env, draft) {
    return draft.hostPlayerId === env.actorId ? null : (0, models_1.failure)("Only the host can do this", "forbidden");
}
function findOtherActivePlayer(env, draft, playerId) {
    if (playerId === env.actorId) {
        return (0, models_1.failure)("You can't target yourself", "bad-request");
    }
    const target = (0, roster_1.getActivePlayers)(draft.state).find((player) => player.id === playerId);
    return target ? null : (0, models_1.failure)("Player not found", "not-found");
}
const playerIdPayload = zod_1.z.object({ playerId: zod_1.z.string().min(1) });
exports.lobbyActions = {
    start: defineLobbyAction(zod_1.z.object({}), (env, draft) => {
        const denied = requireHost(env, draft);
        if (denied)
            return denied;
        if (draft.status !== "pending") {
            return (0, models_1.failure)("The game has already started", "conflict");
        }
        if ((0, roster_1.getActivePlayers)(draft.state).length < env.module.minPlayers) {
            return (0, models_1.failure)(`At least ${env.module.minPlayers} players are needed to start`, "conflict");
        }
        const started = { ...draft, status: "in_progress" };
        const initial = env.module.createInitialState((0, roster_1.buildGameContext)(started, env));
        if (!initial.isSuccess) {
            return (0, models_1.forwardFailure)(initial);
        }
        return (0, models_1.success)({ ...started, state: { ...started.state, game: initial.result } });
    }),
    kick: defineLobbyAction(playerIdPayload, (env, draft, { playerId }) => {
        const denied = requireHost(env, draft) ?? findOtherActivePlayer(env, draft, playerId);
        if (denied)
            return denied;
        return (0, models_1.success)((0, roster_1.removePlayer)(draft, playerId, "kicked", env));
    }),
    transferHost: defineLobbyAction(playerIdPayload, (env, draft, { playerId }) => {
        const denied = requireHost(env, draft) ?? findOtherActivePlayer(env, draft, playerId);
        if (denied)
            return denied;
        return (0, models_1.success)({ ...draft, hostPlayerId: playerId });
    }),
    leave: defineLobbyAction(zod_1.z.object({}), (env, draft) => (0, models_1.success)((0, roster_1.removePlayer)(draft, env.actorId, "left", env))),
    /** Client plan §15.3: the host changes the room settings before the start. Missing keys keep their value. */
    updateSettings: defineLobbyAction(zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()), (env, draft, changes) => {
        const denied = requireHost(env, draft);
        if (denied)
            return denied;
        if (draft.status !== "pending") {
            return (0, models_1.failure)("Settings can only change before the start", "conflict");
        }
        const settings = (0, settings_1.resolveSettings)(env.module, { ...draft.state.settings, ...changes });
        if (!settings.isSuccess) {
            return (0, models_1.forwardFailure)(settings);
        }
        if (settings.result.maxPlayers < (0, roster_1.getActivePlayers)(draft.state).length) {
            return (0, models_1.failure)("More players are already in the room", "conflict");
        }
        return (0, models_1.success)({ ...draft, state: { ...draft.state, settings: settings.result } });
    }),
    end: defineLobbyAction(zod_1.z.object({}), (env, draft) => {
        const denied = requireHost(env, draft);
        if (denied)
            return denied;
        if (draft.status !== "in_progress") {
            return (0, models_1.failure)("The game is not in progress", "conflict");
        }
        return (0, models_1.success)({ ...draft, status: "finished" });
    }),
};
//# sourceMappingURL=lobby.actions.js.map