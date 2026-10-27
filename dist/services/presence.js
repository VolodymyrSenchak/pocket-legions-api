"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ONLINE_WINDOW_MS = void 0;
exports.getLastSeenAt = getLastSeenAt;
exports.isPlayerOnline = isPlayerOnline;
/** A player counts as online when seen within this window. */
exports.ONLINE_WINDOW_MS = 30_000;
/**
 * Last time the player was seen. A missing presence entry means the player has just joined
 * and the presence write hasn't landed yet, so `joinedAt` is used; `null` means explicitly offline.
 */
function getLastSeenAt(player, presence) {
    if (Object.hasOwn(presence, player.id)) {
        const lastSeenAt = presence[player.id];
        return lastSeenAt ? Date.parse(lastSeenAt) : null;
    }
    return Date.parse(player.joinedAt);
}
function isPlayerOnline(player, presence, now) {
    const lastSeenAt = getLastSeenAt(player, presence);
    return lastSeenAt !== null && now.getTime() - lastSeenAt < exports.ONLINE_WINDOW_MS;
}
//# sourceMappingURL=presence.js.map