"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRuntime = createRuntime;
exports.createSupabaseRuntime = createSupabaseRuntime;
const app_1 = require("./app");
const pocketLegions_module_1 = require("./game/pocketLegions.module");
const broadcaster_1 = require("./realtime/broadcaster");
const localSessions_1 = require("./realtime/localSessions");
const sessionBus_1 = require("./realtime/sessionBus");
const socketServer_1 = require("./realtime/socketServer");
const session_service_1 = require("./services/session.service");
const sessionRepository_service_1 = require("./services/sessionRepository.service");
const supabaseDb_1 = require("./utils/supabaseDb");
const random_1 = require("./utils/random");
/** Composition root: one instance = one Express app + (optionally) one Socket.IO server. */
function createRuntime(options) {
    const { repository, bus } = options;
    const module = options.module ?? pocketLegions_module_1.pocketLegionsModule;
    const clock = options.clock ?? (() => new Date());
    const rng = options.rng ?? random_1.cryptoRng;
    const localSessions = new localSessions_1.LocalSessions();
    const broadcaster = new broadcaster_1.Broadcaster({ repository, localSessions, module, clock });
    const sessionService = new session_service_1.SessionService({ repository, module, bus, clock, rng, ...options.service });
    sessionService.setSavedListener((row) => broadcaster.emitLocal(row));
    const app = (0, app_1.createApp)({ sessionService }, options.http);
    return {
        app,
        sessionService,
        broadcaster,
        localSessions,
        module,
        attachRealtime: (server) => (0, socketServer_1.attachSocketServer)(server, { sessionService, repository, module, bus, localSessions, broadcaster, clock }, options.realtime),
    };
}
function createSupabaseRuntime() {
    const db = (0, supabaseDb_1.getSupabaseClient)();
    return createRuntime({
        repository: new sessionRepository_service_1.SupabaseSessionRepository(db),
        // separate client for subscriptions, see SupabaseRealtimeBus
        bus: new sessionBus_1.SupabaseRealtimeBus(db, (0, supabaseDb_1.getSupabaseClient)()),
    });
}
//# sourceMappingURL=runtime.js.map