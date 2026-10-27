"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MAX_PLAYERS = void 0;
exports.resolveSettings = resolveSettings;
const zod_1 = require("zod");
const models_1 = require("../models");
exports.DEFAULT_MAX_PLAYERS = 20;
/** Core settings plus the module's, validated together (on create and on `lobby.updateSettings`). */
function resolveSettings(module, input = {}) {
    const coreSchema = zod_1.z.object({
        maxPlayers: zod_1.z
            .number()
            .int()
            .min(module.minPlayers)
            .max(module.maxPlayers)
            .default(Math.min(exports.DEFAULT_MAX_PLAYERS, module.maxPlayers)),
        allowJoinInProgress: module.allowJoinInProgress === false ? zod_1.z.literal(false).default(false) : zod_1.z.boolean().default(true),
    });
    const core = coreSchema.safeParse(input);
    if (!core.success) {
        return (0, models_1.failure)(zod_1.z.prettifyError(core.error), "bad-request");
    }
    const game = module.settingsSchema.safeParse({ ...module.defaultSettings, ...input });
    if (!game.success) {
        return (0, models_1.failure)(zod_1.z.prettifyError(game.error), "bad-request");
    }
    return (0, models_1.success)({ ...game.data, ...core.data });
}
//# sourceMappingURL=settings.js.map