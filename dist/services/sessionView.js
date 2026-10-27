"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectSessionView = projectSessionView;
const pollInterval_1 = require("../utils/pollInterval");
const random_1 = require("../utils/random");
const presence_1 = require("./presence");
const roster_1 = require("./roster");
/**
 * The only shape session data leaves the server in (HTTP responses and socket pushes).
 * Whitelist-based: secrets (token hashes, password hash) are never copied.
 * Deterministic for a given row, viewer and time, so it can back an ETag.
 */
function projectSessionView(row, viewerId, now, module) {
    const { state } = row;
    const viewer = state.players.find((player) => player.id === viewerId);
    if (!viewer) {
        throw new Error(`Player ${viewerId} is not part of session ${row.id}`);
    }
    const game = row.status !== "pending" && state.game !== null
        ? module.project(state.game, viewerId, (0, roster_1.buildGameContext)(row, { actorId: viewerId, now, rng: random_1.forbiddenRng }))
        : null;
    return {
        code: row.code,
        status: row.status,
        version: row.version,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        hostPlayerId: row.hostPlayerId,
        me: { playerId: viewer.id, nickname: viewer.nickname, isHost: viewer.id === row.hostPlayerId },
        players: (0, roster_1.getActivePlayers)(state).map((player) => ({
            id: player.id,
            nickname: player.nickname,
            isHost: player.id === row.hostPlayerId,
            isOnline: (0, presence_1.isPlayerOnline)(player, row.presence, now),
            joinedAt: player.joinedAt,
        })),
        settings: { ...state.settings },
        poll: { intervalMs: (0, pollInterval_1.getPollIntervalMs)(row.status) },
        game,
    };
}
//# sourceMappingURL=sessionView.js.map