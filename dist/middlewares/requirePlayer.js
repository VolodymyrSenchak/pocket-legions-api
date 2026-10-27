"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAYER_TOKEN_HEADER = void 0;
exports.requirePlayer = requirePlayer;
exports.getPlayerToken = getPlayerToken;
const requestUtils_1 = require("../utils/requestUtils");
exports.PLAYER_TOKEN_HEADER = "X-Player-Token";
/**
 * Requires the anonymous player token header (kept separate from the Supabase `Authorization` auth).
 * The player itself is resolved by the session service against the freshly loaded row,
 * so an action doesn't read the session twice.
 */
function requirePlayer(req, res, next) {
    const token = req.get(exports.PLAYER_TOKEN_HEADER);
    if (!token) {
        (0, requestUtils_1.sendApiError)(res, "unauthorized", `${exports.PLAYER_TOKEN_HEADER} header is required`);
        return;
    }
    res.locals.playerToken = token;
    next();
}
function getPlayerToken(res) {
    return res.locals.playerToken;
}
//# sourceMappingURL=requirePlayer.js.map