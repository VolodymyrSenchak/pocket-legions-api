import { Server as HttpServer } from "node:http";
import { Application } from "express";
import { createApp, AppOptions } from "./app";
import { AnyGameModule } from "./games/gameModule";
import { pocketLegionsModule } from "./game/pocketLegions.module";
import { Broadcaster } from "./realtime/broadcaster";
import { LocalSessions } from "./realtime/localSessions";
import { SessionBus, SupabaseRealtimeBus } from "./realtime/sessionBus";
import { attachSocketServer, RealtimeHandle, RealtimeOptions } from "./realtime/socketServer";
import { SessionService, SessionServiceDeps } from "./services/session.service";
import { SessionRepository, SupabaseSessionRepository } from "./services/sessionRepository.service";
import { getSupabaseClient } from "./utils/supabaseDb";
import { cryptoRng, Rng } from "./utils/random";

export interface RuntimeOptions {
  repository: SessionRepository;
  bus: SessionBus;
  /** The game behind `<module.type>.*` actions; tests inject a stub. */
  module?: AnyGameModule;
  clock?: () => Date;
  rng?: Rng;
  http?: AppOptions;
  realtime?: Partial<RealtimeOptions>;
  service?: Pick<SessionServiceDeps, "maxCasAttempts" | "retryDelayMs">;
}

export interface Runtime {
  app: Application;
  sessionService: SessionService;
  broadcaster: Broadcaster;
  localSessions: LocalSessions;
  module: AnyGameModule;
  attachRealtime(server: HttpServer): RealtimeHandle;
}

/** Composition root: one instance = one Express app + (optionally) one Socket.IO server. */
export function createRuntime(options: RuntimeOptions): Runtime {
  const { repository, bus } = options;
  const module = options.module ?? pocketLegionsModule;
  const clock = options.clock ?? (() => new Date());
  const rng = options.rng ?? cryptoRng;

  const localSessions = new LocalSessions();
  const broadcaster = new Broadcaster({ repository, localSessions, module, clock });
  const sessionService = new SessionService({ repository, module, bus, clock, rng, ...options.service });
  sessionService.setSavedListener((row) => broadcaster.emitLocal(row));
  const app = createApp({ sessionService }, options.http);

  return {
    app,
    sessionService,
    broadcaster,
    localSessions,
    module,
    attachRealtime: (server) =>
      attachSocketServer(
        server,
        { sessionService, repository, module, bus, localSessions, broadcaster, clock },
        options.realtime
      ),
  };
}

export function createSupabaseRuntime(): Runtime {
  const db = getSupabaseClient();
  return createRuntime({
    repository: new SupabaseSessionRepository(db),
    // separate client for subscriptions, see SupabaseRealtimeBus
    bus: new SupabaseRealtimeBus(db, getSupabaseClient()),
  });
}
