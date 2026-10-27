import { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { AnyGameModule } from "../games/gameModule";
import { AuthenticatedPlayer, SessionService } from "../services/session.service";
import { SessionRepository } from "../services/sessionRepository.service";
import { corsOrigin } from "../utils/corsUtils";
import { logger } from "../utils/logger";
import { toApiError } from "../utils/requestUtils";
import { Broadcaster } from "./broadcaster";
import { LocalSessions } from "./localSessions";
import { MaintenanceTick } from "./maintenanceTick";
import { PresenceTracker } from "./presenceTracker";
import { SessionBus } from "./sessionBus";
import { ActionAck, AppServer, AppSocket } from "./socketTypes";

export interface RealtimeOptions {
  path: string;
  graceMs: number;
  heartbeatMs: number;
  tickIntervalMs: number;
  idleTimeoutMs: number;
  finishedGraceMs: number;
  maxActionBytes: number;
  actionRateLimit: { limit: number; windowMs: number };
  /** Heartbeat and maintenance intervals (tests drive them manually). */
  startTimers: boolean;
}

export const DEFAULT_REALTIME_OPTIONS: RealtimeOptions = {
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

export interface RealtimeDeps {
  sessionService: SessionService;
  repository: SessionRepository;
  module: AnyGameModule;
  bus: SessionBus;
  localSessions: LocalSessions;
  broadcaster: Broadcaster;
  clock: () => Date;
}

export interface RealtimeHandle {
  io: AppServer;
  presence: PresenceTracker;
  tick: MaintenanceTick;
  close(): Promise<void>;
}

function connectError(message: string, code: string): Error {
  return Object.assign(new Error(message), { data: { code } });
}

/** Fixed-window limiter; in-memory is fine because a socket is pinned to one instance. */
function createActionLimiter({ limit, windowMs }: RealtimeOptions["actionRateLimit"]) {
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
export function attachSocketServer(
  httpServer: HttpServer,
  deps: RealtimeDeps,
  overrides: Partial<RealtimeOptions> = {}
): RealtimeHandle {
  const options: RealtimeOptions = { ...DEFAULT_REALTIME_OPTIONS, ...overrides };
  const { sessionService, localSessions, broadcaster, bus, clock } = deps;

  const io: AppServer = new Server(httpServer, {
    path: options.path,
    transports: ["websocket"],
    serveClient: false,
    cors: { origin: corsOrigin },
    // hard cap; actions above maxActionBytes get a bad-request ack
    maxHttpBufferSize: options.maxActionBytes * 2,
  });
  const presence = new PresenceTracker(deps, { graceMs: options.graceMs, heartbeatMs: options.heartbeatMs });
  const tick = new MaintenanceTick(deps, {
    intervalMs: options.tickIntervalMs,
    idleTimeoutMs: options.idleTimeoutMs,
    finishedGraceMs: options.finishedGraceMs,
  });
  if (options.startTimers) {
    presence.start();
    tick.start();
  }

  const handshakes = new WeakMap<AppSocket, AuthenticatedPlayer>();

  io.use(async (socket, next) => {
    try {
      const { code, playerToken } = (socket.handshake.auth ?? {}) as Record<string, unknown>;
      if (typeof code !== "string" || typeof playerToken !== "string") {
        return next(connectError("code and playerToken are required", "unauthorized"));
      }
      const auth = await sessionService.authenticate(code, playerToken);
      if (!auth.isSuccess) {
        const error = toApiError(auth);
        return next(connectError(error.message, error.code));
      }
      const { row, player } = auth.result!;
      const rejected = sessionService.rejectSession(row);
      if (rejected) {
        const error = toApiError(rejected);
        return next(connectError(error.message, error.code));
      }
      socket.data = { sessionId: row.id, code: row.code, playerId: player.id, playerToken, connectedAt: clock().getTime() };
      handshakes.set(socket, auth.result!);
      next();
    } catch (error) {
      logger.error("socket-handshake-failed", { error });
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
    void presence.connected(row, player).catch((error) => logger.error("presence-online-failed", { error }));

    const allowAction = createActionLimiter(options.actionRateLimit);
    socket.on("action", async (request, ack) => {
      if (typeof ack !== "function") {
        return;
      }
      const reply = (response: ActionAck) => ack(response);
      if (!allowAction()) {
        return reply({ ok: false, error: { code: "too-many-requests", message: "Too many actions, slow down" } });
      }
      if (Buffer.byteLength(JSON.stringify(request ?? null)) > options.maxActionBytes) {
        return reply({ ok: false, error: { code: "bad-request", message: "Action payload is too large" } });
      }
      try {
        const result = await sessionService.dispatchAction(socket.data.code, socket.data.playerToken, request);
        reply(result.isSuccess ? { ok: true, session: result.result! } : { ok: false, error: toApiError(result) });
      } catch (error) {
        logger.error("socket-action-failed", { sessionId: socket.data.sessionId, error });
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
