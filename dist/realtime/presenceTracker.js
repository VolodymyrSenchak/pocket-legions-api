"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PresenceTracker = void 0;
const presence_1 = require("../services/presence");
const logger_1 = require("../utils/logger");
/** Best-effort online/offline status for the UI (§3.9). */
class PresenceTracker {
    deps;
    options;
    heartbeatTimer = null;
    graceTimers = new Set();
    constructor(deps, options) {
        this.deps = deps;
        this.options = options;
    }
    start() {
        this.heartbeatTimer ??= setInterval(() => void this.heartbeat(), this.options.heartbeatMs).unref();
    }
    stop() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        this.graceTimers.forEach((timer) => clearTimeout(timer));
        this.graceTimers.clear();
    }
    async connected(row, player) {
        const wasOnline = (0, presence_1.isPlayerOnline)(player, row.presence, this.deps.clock());
        const result = await this.deps.repository.setPresence(row.id, [player.id], true);
        if (!result.isSuccess) {
            return;
        }
        if (!wasOnline) {
            await this.announce(row.id, row.version);
        }
    }
    disconnected(sessionId, playerId) {
        const disconnectedAt = this.deps.clock().getTime();
        const timer = setTimeout(() => {
            this.graceTimers.delete(timer);
            void this.markOfflineIfGone(sessionId, playerId, disconnectedAt).catch((error) => logger_1.logger.error("presence-offline-failed", { sessionId, playerId, error }));
        }, this.options.graceMs);
        timer.unref();
        this.graceTimers.add(timer);
    }
    /** One presence write per session held by this instance, covering all its connected players. */
    async heartbeat() {
        await Promise.all(this.deps.localSessions.ids().map((sessionId) => this.deps.repository.setPresence(sessionId, this.deps.localSessions.playerIds(sessionId), true)));
    }
    async markOfflineIfGone(sessionId, playerId, disconnectedAt) {
        if (this.deps.localSessions.hasPlayer(sessionId, playerId)) {
            return;
        }
        const found = await this.deps.repository.findById(sessionId);
        const row = found.result;
        if (!row) {
            return;
        }
        const player = row.state.players.find((candidate) => candidate.id === playerId);
        const lastSeenAt = row.presence[playerId];
        // not active any more, already offline, or reconnected on another instance
        if (!player || player.status !== "active" || !lastSeenAt || Date.parse(lastSeenAt) >= disconnectedAt) {
            return;
        }
        const result = await this.deps.repository.setPresence(sessionId, [playerId], false);
        if (result.isSuccess) {
            await this.announce(sessionId, row.version);
        }
    }
    async announce(sessionId, version) {
        try {
            await this.deps.bus.publish(sessionId, { version, reason: "presence" });
        }
        catch (error) {
            logger_1.logger.error("relay-publish-failed", { sessionId, reason: "presence", error });
        }
        await this.deps.broadcaster.requestReload(sessionId);
    }
}
exports.PresenceTracker = PresenceTracker;
//# sourceMappingURL=presenceTracker.js.map