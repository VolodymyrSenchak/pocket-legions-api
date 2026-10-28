"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.skirmoraModule = void 0;
const version_1 = require("../engine/version");
const skirmora_actions_1 = require("./skirmora.actions");
const skirmora_projection_1 = require("./skirmora.projection");
const skirmora_state_1 = require("./skirmora.state");
/** Skirmora behind `skirmora.<action>` (plan §7). */
exports.skirmoraModule = {
    type: skirmora_state_1.GAME_TYPE,
    minPlayers: 2,
    maxPlayers: 4,
    allowJoinInProgress: false,
    settingsSchema: skirmora_state_1.settingsSchema,
    defaultSettings: skirmora_state_1.defaultSettings,
    createInitialState: (ctx) => (0, skirmora_state_1.createInitialState)(ctx),
    // handlers read the core settings too (Settings = SkirmoraSettings & CoreSettings)
    actions: skirmora_actions_1.skirmoraActions,
    onPlayerRemoved: (ctx, state, playerId) => (0, skirmora_actions_1.onPlayerRemoved)(ctx, state, playerId),
    project: (state, viewerId, ctx) => (0, skirmora_projection_1.project)(state, viewerId, ctx),
    getHistory: (state) => state.history,
    rejectSession: (settings) => settings.dataVersion === version_1.DATA_VERSION ? null : { message: "The game was updated — start a new room", code: "outdated" },
    publicInfo: (settings) => ({ mapId: settings.mapId, mode: settings.mode, budget: settings.budget }),
};
//# sourceMappingURL=skirmora.module.js.map