"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Broadcaster = void 0;
const models_1 = require("../models");
const sessionView_1 = require("../services/sessionView");
const logger_1 = require("../utils/logger");
/** Pushes per-player snapshots to the sockets held by this instance. */
class Broadcaster {
    deps;
    reloads = new Map();
    constructor(deps) {
        this.deps = deps;
    }
    /** Emits a projected snapshot of `row` to each local socket of the session. */
    emitLocal(row) {
        const local = this.deps.localSessions.get(row.id);
        if (!local || row.version < local.lastEmittedVersion) {
            return;
        }
        const now = this.deps.clock();
        if ((0, models_1.isSessionExpired)(row, now)) {
            this.expireLocal(row.id, row.expiresAt);
            return;
        }
        if (row.version > local.lastEmittedVersion) {
            local.lastEmittedVersion = row.version;
            local.lastChangeAt = now.getTime();
        }
        for (const socket of [...local.sockets]) {
            const player = row.state.players.find((candidate) => candidate.id === socket.data.playerId);
            if (!player || player.status !== "active") {
                socket.emit("player:removed", { reason: player?.removalReason ?? (player?.status === "kicked" ? "kicked" : "left") });
                socket.disconnect(true);
                continue;
            }
            socket.emit("session:state", (0, sessionView_1.projectSessionView)(row, player.id, now, this.deps.module));
        }
    }
    onBusMessage(sessionId, message) {
        const local = this.deps.localSessions.get(sessionId);
        if (!local || (message.reason === "state" && message.version <= local.lastEmittedVersion)) {
            return;
        }
        void this.requestReload(sessionId);
    }
    /** Reloads the row and emits it. Coalesced: at most one reload in flight per session, re-run once if more requests arrived. */
    requestReload(sessionId) {
        const inFlight = this.reloads.get(sessionId);
        if (inFlight) {
            inFlight.again = true;
            return inFlight.running;
        }
        const entry = { running: Promise.resolve(), again: false };
        entry.running = (async () => {
            try {
                do {
                    entry.again = false;
                    await this.reloadOnce(sessionId);
                } while (entry.again);
            }
            catch (error) {
                logger_1.logger.error("broadcast-reload-failed", { sessionId, error });
            }
            finally {
                this.reloads.delete(sessionId);
            }
        })();
        this.reloads.set(sessionId, entry);
        return entry.running;
    }
    expireLocal(sessionId, expiresAt) {
        for (const socket of [...(this.deps.localSessions.get(sessionId)?.sockets ?? [])]) {
            socket.emit("session:expired", { expiresAt });
            socket.disconnect(true);
        }
    }
    disconnectAll(sessionId) {
        for (const socket of [...(this.deps.localSessions.get(sessionId)?.sockets ?? [])]) {
            socket.disconnect(true);
        }
    }
    async reloadOnce(sessionId) {
        if (!this.deps.localSessions.get(sessionId)) {
            return;
        }
        const found = await this.deps.repository.findById(sessionId);
        if (!found.isSuccess) {
            logger_1.logger.warn("broadcast-reload-failed", { sessionId });
            return;
        }
        if (!found.result) {
            this.disconnectAll(sessionId);
            return;
        }
        this.emitLocal(found.result);
    }
}
exports.Broadcaster = Broadcaster;
//# sourceMappingURL=broadcaster.js.map