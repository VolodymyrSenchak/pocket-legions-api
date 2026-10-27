"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pocketLegionsModule = void 0;
const version_1 = require("../engine/version");
const pocketLegions_actions_1 = require("./pocketLegions.actions");
const pocketLegions_projection_1 = require("./pocketLegions.projection");
const pocketLegions_state_1 = require("./pocketLegions.state");
/** Pocket Legions behind `pocket-legions.<action>` (plan §7). */
exports.pocketLegionsModule = {
    type: pocketLegions_state_1.GAME_TYPE,
    minPlayers: 2,
    maxPlayers: 4,
    allowJoinInProgress: false,
    settingsSchema: pocketLegions_state_1.settingsSchema,
    defaultSettings: pocketLegions_state_1.defaultSettings,
    createInitialState: (ctx) => (0, pocketLegions_state_1.createInitialState)(ctx),
    // handlers read the core settings too (Settings = PocketLegionsSettings & CoreSettings)
    actions: pocketLegions_actions_1.pocketLegionsActions,
    onPlayerRemoved: (ctx, state, playerId) => (0, pocketLegions_actions_1.onPlayerRemoved)(ctx, state, playerId),
    project: (state, viewerId, ctx) => (0, pocketLegions_projection_1.project)(state, viewerId, ctx),
    getHistory: (state) => state.history,
    rejectSession: (settings) => settings.dataVersion === version_1.DATA_VERSION ? null : { message: "The game was updated — start a new room", code: "outdated" },
    publicInfo: (settings) => ({ mapId: settings.mapId, mode: settings.mode, budget: settings.budget }),
};
//# sourceMappingURL=pocketLegions.module.js.map