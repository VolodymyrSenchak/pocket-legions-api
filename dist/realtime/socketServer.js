"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_REALTIME_OPTIONS = void 0;
exports.attachSocketServer = attachSocketServer;
const socket_io_1 = require("socket.io");
const corsUtils_1 = require("../utils/corsUtils");
const logger_1 = require("../utils/logger");
const requestUtils_1 = require("../utils/requestUtils");
const maintenanceTick_1 = require("./maintenanceTick");
const presenceTracker_1 = require("./presenceTracker");
exports.DEFAULT_REALTIME_OPTIONS = {
    path: "/socket.io",
    graceMs: 5_000,
    heartbeatMs: 10_000,
    tickIntervalMs: 15_000,
    idleTimeoutMs: 20 * 60_000,
    finishedGraceMs: 60_000,
    maxActionBytes: 32 * 1024,
    actionRateLimit: { limit: 30, windowMs: 10_000 },
    startTimers: true,
};
function connectError(message, code) {
    return Object.assign(new Error(message), { data: { code } });
}
/** Fixed-window limiter; in-memory is fine because a socket is pinned to one instance. */
function createActionLimiter({ limit, windowMs }) {
    let windowStart = 0;
    let count = 0;
    return () => {
        const now = Date.now();
        if (now - windowStart >= windowMs) {
            windowStart = now;
            count = 0;
        }
        return ++count <= limit;
    };
}
/** Socket.IO on the same http.Server as Express (websocket transport only). */
function attachSocketServer(httpServer, deps, overrides = {}) {
    const options = { ...exports.DEFAULT_REALTIME_OPTIONS, ...overrides };
    const { sessionService, localSessions, broadcaster, bus, clock } = deps;
    const io = new socket_io_1.Server(httpServer, {
        path: options.path,
        transports: ["websocket"],
        serveClient: false,
        cors: { origin: corsUtils_1.corsOrigin },
        // hard cap; actions above maxActionBytes get a bad-request ack
        maxHttpBufferSize: options.maxActionBytes * 2,
    });
    const presence = new presenceTracker_1.PresenceTracker(deps, { graceMs: options.graceMs, heartbeatMs: options.heartbeatMs });
    const tick = new maintenanceTick_1.MaintenanceTick(deps, {
        intervalMs: options.tickIntervalMs,
        idleTimeoutMs: options.idleTimeoutMs,
        finishedGraceMs: options.finishedGraceMs,
    });
    if (options.startTimers) {
        presence.start();
        tick.start();
    }
    const handshakes = new WeakMap();
    io.use(async (socket, next) => {
        try {
            const { code, playerToken } = (socket.handshake.auth ?? {});
            if (typeof code !== "string" || typeof playerToken !== "string") {
                return next(connectError("code and playerToken are required", "unauthorized"));
            }
            const auth = await sessionService.authenticate(code, playerToken);
            if (!auth.isSuccess) {
                const error = (0, requestUtils_1.toApiError)(auth);
                return next(connectError(error.message, error.code));
            }
            const { row, player } = auth.result;
            const rejected = sessionService.rejectSession(row);
            if (rejected) {
                const error = (0, requestUtils_1.toApiError)(rejected);
                return next(connectError(error.message, error.code));
            }
            socket.data = { sessionId: row.id, code: row.code, playerId: player.id, playerToken, connectedAt: clock().getTime() };
            handshakes.set(socket, auth.result);
            next();
        }
        catch (error) {
            logger_1.logger.error("socket-handshake-failed", { error });
            next(connectError("Internal server error", "internal-server-error"));
        }
    });
    io.on("connection", (socket) => {
        const auth = handshakes.get(socket);
        handshakes.delete(socket);
        if (!auth) {
            socket.disconnect(true);
            return;
        }
        const { row, player } = auth;
        const now = clock();
        const { session, isFirst } = localSessions.add(socket, row.version, now.getTime());
        if (isFirst) {
            bus.subscribe(row.id, (message) => broadcaster.onBusMessage(row.id, message));
        }
        // the connecting player is online by definition
        const initialRow = { ...row, presence: { ...row.presence, [player.id]: now.toISOString() } };
        socket.emit("session:state", sessionService.project(initialRow, player.id, now));
        if (row.version < session.lastEmittedVersion) {
            void broadcaster.requestReload(row.id);
        }
        void presence.connected(row, player).catch((error) => logger_1.logger.error("presence-online-failed", { error }));
        const allowAction = createActionLimiter(options.actionRateLimit);
        socket.on("action", async (request, ack) => {
            if (typeof ack !== "function") {
                return;
            }
            const reply = (response) => ack(response);
            if (!allowAction()) {
                return reply({ ok: false, error: { code: "too-many-requests", message: "Too many actions, slow down" } });
            }
            if (Buffer.byteLength(JSON.stringify(request ?? null)) > options.maxActionBytes) {
                return reply({ ok: false, error: { code: "bad-request", message: "Action payload is too large" } });
            }
            try {
                const result = await sessionService.dispatchAction(socket.data.code, socket.data.playerToken, request);
                reply(result.isSuccess ? { ok: true, session: result.result } : { ok: false, error: (0, requestUtils_1.toApiError)(result) });
            }
            catch (error) {
                logger_1.logger.error("socket-action-failed", { sessionId: socket.data.sessionId, error });
                reply({ ok: false, error: { code: "internal-server-error", message: "Internal server error" } });
            }
        });
        socket.on("disconnect", () => {
            if (localSessions.remove(socket)) {
                bus.unsubscribe(socket.data.sessionId);
            }
            presence.disconnected(socket.data.sessionId, socket.data.playerId);
        });
    });
    return {
        io,
        presence,
        tick,
        close: async () => {
            presence.stop();
            tick.stop();
            await io.close();
        },
    };
}
//# sourceMappingURL=socketServer.js.map