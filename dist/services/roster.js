"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActivePlayers = getActivePlayers;
exports.isSameNickname = isSameNickname;
exports.toDraft = toDraft;
exports.buildGameContext = buildGameContext;
exports.removePlayer = removePlayer;
exports.addPlayer = addPlayer;
function getActivePlayers(state) {
    return state.players.filter((player) => player.status === "active");
}
function isSameNickname(a, b) {
    return a.toLowerCase() === b.toLowerCase();
}
/** Deep copy of the mutable part of a row, so reducers never touch the loaded row. */
function toDraft(row) {
    return structuredClone({ status: row.status, hostPlayerId: row.hostPlayerId, state: row.state });
}
function buildGameContext(draft, env) {
    return {
        actorId: env.actorId,
        hostPlayerId: draft.hostPlayerId,
        activePlayers: getActivePlayers(draft.state),
        settings: draft.state.settings,
        status: draft.status,
        now: env.now,
        rng: env.rng,
    };
}
function earliestJoined(players) {
    // Array.prototype.sort is stable, so ties keep join order
    return [...players].sort((a, b) => Date.parse(a.joinedAt) - Date.parse(b.joinedAt))[0];
}
/**
 * Marks a player as no longer active and applies the side effects:
 * host passes to the earliest-joined active player, the game module is notified,
 * and the session finishes when nobody is left.
 */
function removePlayer(draft, playerId, reason, env) {
    const players = draft.state.players.map((player) => player.id === playerId
        ? { ...player, status: reason === "kicked" ? "kicked" : "left", removalReason: reason }
        : player);
    let next = { ...draft, state: { ...draft.state, players } };
    const remaining = getActivePlayers(next.state);
    if (remaining.length === 0) {
        return { ...next, status: "finished" };
    }
    if (next.hostPlayerId === playerId) {
        next = { ...next, hostPlayerId: earliestJoined(remaining).id };
    }
    if (next.status === "in_progress" && next.state.game !== null && env.module.onPlayerRemoved) {
        const transition = env.module.onPlayerRemoved(buildGameContext(next, env), next.state.game, playerId);
        next = {
            ...next,
            status: transition.finished ? "finished" : next.status,
            state: { ...next.state, game: transition.state },
        };
    }
    return next;
}
/** Adds a player and lets the game module include them in a running game. */
function addPlayer(draft, player, env) {
    let next = { ...draft, state: { ...draft.state, players: [...draft.state.players, player] } };
    if (next.status === "in_progress" && next.state.game !== null && env.module.onPlayerJoined) {
        const game = env.module.onPlayerJoined(buildGameContext(next, env), next.state.game, player.id);
        next = { ...next, state: { ...next.state, game } };
    }
    return next;
}
//# sourceMappingURL=roster.js.map