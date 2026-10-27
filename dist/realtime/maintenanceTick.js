"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MaintenanceTick = void 0;
const logger_1 = require("../utils/logger");
/** Per-instance safety net: missed relay messages, expiry and the idle policy. */
class MaintenanceTick {
    deps;
    options;
    timer = null;
    running = false;
    constructor(deps, options) {
        this.deps = deps;
        this.options = options;
    }
    start() {
        this.timer ??= setInterval(() => void this.runOnce(), this.options.intervalMs).unref();
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    async runOnce() {
        if (this.running) {
            return;
        }
        this.running = true;
        try {
            await this.check();
        }
        catch (error) {
            logger_1.logger.error("maintenance-tick-failed", { error });
        }
        finally {
            this.running = false;
        }
    }
    async check() {
        const { localSessions, broadcaster } = this.deps;
        const ids = localSessions.ids();
        if (ids.length === 0) {
            return;
        }
        const versions = await this.deps.repository.getVersions(ids);
        if (!versions.isSuccess) {
            return;
        }
        const byId = new Map(versions.result.map((info) => [info.id, info]));
        for (const sessionId of ids) {
            const info = byId.get(sessionId);
            if (!info) {
                broadcaster.disconnectAll(sessionId);
                continue;
            }
            const now = this.deps.clock().getTime();
            if (Date.parse(info.expiresAt) <= now) {
                broadcaster.expireLocal(sessionId, info.expiresAt);
                continue;
            }
            const lastEmittedVersion = localSessions.get(sessionId)?.lastEmittedVersion ?? info.version;
            if (info.version > lastEmittedVersion) {
                // a relay message was dropped
                logger_1.logger.warn("safety-net-recovery", { sessionId, version: info.version, lastEmittedVersion });
                await broadcaster.requestReload(sessionId);
            }
            const local = localSessions.get(sessionId);
            if (!local) {
                continue;
            }
            const finished = info.status === "finished";
            const timeoutMs = finished ? this.options.finishedGraceMs : this.options.idleTimeoutMs;
            for (const socket of [...local.sockets]) {
                if (now - Math.max(local.lastChangeAt, socket.data.connectedAt) > timeoutMs) {
                    if (!finished) {
                        socket.emit("session:idle", {});
                    }
                    socket.disconnect(true);
                }
            }
        }
    }
}
exports.MaintenanceTick = MaintenanceTick;
//# sourceMappingURL=maintenanceTick.js.map