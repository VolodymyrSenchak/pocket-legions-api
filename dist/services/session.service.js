"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionService = exports.PRESENCE_TOUCH_INTERVAL_MS = exports.DEFAULT_MAX_PLAYERS = void 0;
const zod_1 = require("zod");
const action_model_1 = require("../models/action.model");
const models_1 = require("../models");
const crypto_1 = require("../utils/crypto");
const logger_1 = require("../utils/logger");
const random_1 = require("../utils/random");
const sessionCode_1 = require("../utils/sessionCode");
const lobby_actions_1 = require("./lobby.actions");
const settings_1 = require("./settings");
var settings_2 = require("./settings");
Object.defineProperty(exports, "DEFAULT_MAX_PLAYERS", { enumerable: true, get: function () { return settings_2.DEFAULT_MAX_PLAYERS; } });
const presence_1 = require("./presence");
const roster_1 = require("./roster");
const sessionView_1 = require("./sessionView");
/** The polling fallback refreshes the caller's presence at most this often. */
exports.PRESENCE_TOUCH_INTERVAL_MS = 10_000;
/** A burst of N simultaneous writers needs up to N rounds, so allow enough attempts plus jittered backoff. */
const DEFAULT_MAX_CAS_ATTEMPTS = 10;
const RETRY_BASE_DELAY_MS = 25;
const RETRY_MAX_DELAY_MS = 1000;
/** Exponential backoff with full jitter. */
function defaultRetryDelayMs(attempt) {
    return Math.floor(Math.random() * Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)));
}
class SessionService {
    deps;
    clock;
    rng;
    maxCasAttempts;
    retryDelayMs;
    onSaved;
    constructor(deps) {
        this.deps = deps;
        this.clock = deps.clock ?? (() => new Date());
        this.rng = deps.rng ?? random_1.cryptoRng;
        this.maxCasAttempts = deps.maxCasAttempts ?? DEFAULT_MAX_CAS_ATTEMPTS;
        this.retryDelayMs = deps.retryDelayMs ?? defaultRetryDelayMs;
    }
    setSavedListener(listener) {
        this.onSaved = listener;
    }
    project(row, viewerId, now = this.clock()) {
        return (0, sessionView_1.projectSessionView)(row, viewerId, now, this.deps.module);
    }
    async create(input) {
        const { module } = this.deps;
        const settings = (0, settings_1.resolveSettings)(module, input.settings);
        if (!settings.isSuccess) {
            return (0, models_1.forwardFailure)(settings);
        }
        const now = this.clock();
        const identity = (0, crypto_1.createPlayerIdentity)();
        const player = {
            id: identity.playerId,
            nickname: input.nickname,
            tokenHash: identity.tokenHash,
            joinedAt: now.toISOString(),
            status: "active",
        };
        const passwordHash = input.password ? await (0, crypto_1.hashPassword)(input.password) : null;
        const inserted = await this.deps.repository.insertWithUniqueCode({
            status: "pending",
            passwordHash,
            hostPlayerId: player.id,
            state: { players: [player], settings: settings.result, game: null },
            presence: { [player.id]: now.toISOString() },
        }, () => (0, sessionCode_1.generateSessionCode)(this.rng), now);
        if (!inserted.isSuccess) {
            return (0, models_1.forwardFailure)(inserted);
        }
        return (0, models_1.success)({ playerId: player.id, playerToken: identity.token, session: this.project(inserted.result, player.id, now) });
    }
    async info(code) {
        const found = await this.findLive(code);
        if (!found.isSuccess) {
            return (0, models_1.forwardFailure)(found);
        }
        const row = found.result;
        const playerCount = (0, roster_1.getActivePlayers)(row.state).length;
        return (0, models_1.success)({
            code: row.code,
            status: row.status,
            requiresPassword: row.passwordHash !== null,
            playerCount,
            maxPlayers: row.state.settings.maxPlayers,
            joinable: !(0, models_1.isSessionExpired)(row, this.clock()) && getJoinBlocker(row) === null && playerCount < row.state.settings.maxPlayers,
            expiresAt: row.expiresAt,
            ...this.deps.module.publicInfo?.(row.state.settings),
        });
    }
    async join(code, input) {
        const found = await this.findLive(code);
        if (!found.isSuccess) {
            return (0, models_1.forwardFailure)(found);
        }
        const initial = found.result;
        if ((0, models_1.isSessionExpired)(initial, this.clock())) {
            return (0, models_1.failure)("The session has expired", "gone");
        }
        if (initial.passwordHash !== null && !(await (0, crypto_1.verifyPassword)(input.password ?? "", initial.passwordHash))) {
            return (0, models_1.failure)("Wrong password", "unauthorized");
        }
        const identity = (0, crypto_1.createPlayerIdentity)();
        const saved = await this.mutate(code, initial, (row, now) => {
            const { module } = this.deps;
            const blocker = getJoinBlocker(row);
            if (blocker) {
                return blocker;
            }
            const holder = (0, roster_1.getActivePlayers)(row.state).find((player) => (0, roster_1.isSameNickname)(player.nickname, input.nickname));
            if (holder && (0, presence_1.isPlayerOnline)(holder, row.presence, now)) {
                return (0, models_1.failure)("This nickname is already taken", "conflict", "nickname-taken");
            }
            const activeCount = (0, roster_1.getActivePlayers)(row.state).length - (holder ? 1 : 0);
            if (activeCount >= row.state.settings.maxPlayers) {
                return (0, models_1.failure)("The session is full", "conflict", "session-full");
            }
            const env = { actorId: identity.playerId, now, rng: this.rng, module };
            const player = {
                id: identity.playerId,
                nickname: input.nickname,
                tokenHash: identity.tokenHash,
                joinedAt: now.toISOString(),
                status: "active",
            };
            // add first, so replacing the last (stale) player doesn't finish the session
            let draft = (0, roster_1.addPlayer)((0, roster_1.toDraft)(row), player, env);
            if (holder) {
                draft = (0, roster_1.removePlayer)(draft, holder.id, "replaced", env);
            }
            return (0, models_1.success)(draft);
        });
        if (!saved.isSuccess) {
            return (0, models_1.forwardFailure)(saved);
        }
        const now = this.clock();
        const row = await this.markOnline(saved.result, identity.playerId, now);
        await this.publishChange(row, "state");
        return (0, models_1.success)({ playerId: identity.playerId, playerToken: identity.token, session: this.project(row, identity.playerId, now) });
    }
    /** Resolves the player behind a token: 404 / 410 / 401 / 403 kicked|left. */
    async authenticate(code, playerToken) {
        const found = await this.findLive(code);
        if (!found.isSuccess) {
            return (0, models_1.forwardFailure)(found);
        }
        const row = found.result;
        if ((0, models_1.isSessionExpired)(row, this.clock())) {
            return (0, models_1.failure)("The session has expired", "gone");
        }
        const player = authenticatePlayer(row, playerToken);
        return player.isSuccess ? (0, models_1.success)({ row, player: player.result }) : (0, models_1.forwardFailure)(player);
    }
    /** Polling fallback (§7.4). */
    async getView(code, playerToken) {
        const auth = await this.authenticate(code, playerToken);
        if (!auth.isSuccess) {
            return (0, models_1.forwardFailure)(auth);
        }
        const { player } = auth.result;
        let row = auth.result.row;
        const now = this.clock();
        const lastSeenAt = row.presence[player.id];
        if (!lastSeenAt || now.getTime() - Date.parse(lastSeenAt) >= exports.PRESENCE_TOUCH_INTERVAL_MS) {
            const wasOnline = (0, presence_1.isPlayerOnline)(player, row.presence, now);
            row = await this.markOnline(row, player.id, now);
            if (!wasOnline) {
                await this.publishChange(row, "presence");
            }
        }
        return (0, models_1.success)(this.project(row, player.id, now));
    }
    async getHistory(code, playerToken) {
        const auth = await this.authenticate(code, playerToken);
        if (!auth.isSuccess) {
            return (0, models_1.forwardFailure)(auth);
        }
        const { row } = auth.result;
        const { module } = this.deps;
        if (!module.getHistory || row.state.game === null) {
            return (0, models_1.success)([]);
        }
        return (0, models_1.success)(module.getHistory(row.state.game));
    }
    /** Action pipeline (§7.1), shared by the socket `action` event and `POST /actions`. */
    async dispatchAction(code, playerToken, request) {
        const parsed = action_model_1.actionRequestSchema.safeParse(request);
        if (!parsed.success) {
            return (0, models_1.failure)(zod_1.z.prettifyError(parsed.error), "bad-request");
        }
        const { type, payload } = parsed.data;
        const separator = type.indexOf(".");
        const namespace = separator > 0 ? type.slice(0, separator) : "";
        const name = separator > 0 ? type.slice(separator + 1) : "";
        const unknownAction = () => (0, models_1.failure)(`Unknown action '${type}'`, "bad-request");
        let actorId = null;
        const saved = await this.mutate(code, null, (row, now) => {
            const actor = authenticatePlayer(row, playerToken);
            if (!actor.isSuccess) {
                return (0, models_1.forwardFailure)(actor);
            }
            actorId = actor.result.id;
            const rejected = this.rejectSession(row);
            if (rejected) {
                return rejected;
            }
            const { module } = this.deps;
            const env = { actorId, now, rng: this.rng, module };
            const draft = (0, roster_1.toDraft)(row);
            if (namespace === "lobby") {
                const lobbyAction = Object.hasOwn(lobby_actions_1.lobbyActions, name) ? lobby_actions_1.lobbyActions[name] : undefined;
                if (!lobbyAction) {
                    return unknownAction();
                }
                const lobbyPayload = lobbyAction.schema.safeParse(payload ?? {});
                if (!lobbyPayload.success) {
                    return (0, models_1.failure)(zod_1.z.prettifyError(lobbyPayload.error), "bad-request");
                }
                return lobbyAction.handle(env, draft, lobbyPayload.data);
            }
            if (namespace !== module.type) {
                return unknownAction();
            }
            const gameAction = Object.hasOwn(module.actions, name) ? module.actions[name] : undefined;
            if (!gameAction) {
                return unknownAction();
            }
            if (row.status !== "in_progress" || draft.state.game === null) {
                return (0, models_1.failure)("The game is not in progress", "conflict");
            }
            const gamePayload = gameAction.schema.safeParse(payload ?? {});
            if (!gamePayload.success) {
                return (0, models_1.failure)(zod_1.z.prettifyError(gamePayload.error), "bad-request");
            }
            const transition = gameAction.handle((0, roster_1.buildGameContext)(draft, env), draft.state.game, gamePayload.data);
            if (!transition.isSuccess) {
                return (0, models_1.forwardFailure)(transition);
            }
            const { state: game, finished } = transition.result;
            return (0, models_1.success)({ ...draft, status: finished ? "finished" : draft.status, state: { ...draft.state, game } });
        });
        if (!saved.isSuccess) {
            return (0, models_1.forwardFailure)(saved);
        }
        await this.publishChange(saved.result, "state");
        return (0, models_1.success)(this.project(saved.result, actorId));
    }
    /** The module refuses this session (plan §8: `409 outdated` after a data change). */
    rejectSession(row) {
        const rejection = this.deps.module.rejectSession?.(row.state.settings);
        return rejection ? (0, models_1.failure)(rejection.message, "conflict", rejection.code) : null;
    }
    /** Load → reduce → compare-and-swap, re-running the (pure) reducer when another write won. */
    async mutate(code, initial, reduce) {
        for (let attempt = 1; attempt <= this.maxCasAttempts; attempt++) {
            let row = attempt === 1 ? initial : null;
            if (!row) {
                const found = await this.findLive(code);
                if (!found.isSuccess) {
                    return (0, models_1.forwardFailure)(found);
                }
                row = found.result;
            }
            const now = this.clock();
            if ((0, models_1.isSessionExpired)(row, now)) {
                return (0, models_1.failure)("The session has expired", "gone");
            }
            const draft = reduce(row, now);
            if (!draft.isSuccess) {
                return (0, models_1.forwardFailure)(draft);
            }
            const saved = await this.deps.repository.compareAndSwap(row.id, row.version, draft.result);
            if (!saved.isSuccess) {
                return (0, models_1.forwardFailure)(saved);
            }
            if (saved.result) {
                return (0, models_1.success)(saved.result);
            }
            if (attempt < this.maxCasAttempts) {
                await sleep(this.retryDelayMs(attempt));
            }
        }
        logger_1.logger.warn("cas-retries-exhausted", { code, attempts: this.maxCasAttempts });
        return (0, models_1.failure)("The session was changed by someone else at the same time, please retry", "conflict");
    }
    async findLive(code) {
        if (!(0, sessionCode_1.isValidSessionCode)(code)) {
            return (0, models_1.failure)("Session not found", "not-found");
        }
        const found = await this.deps.repository.findLiveByCode(code);
        if (!found.isSuccess) {
            return (0, models_1.forwardFailure)(found);
        }
        return found.result ? (0, models_1.success)(found.result) : (0, models_1.failure)("Session not found", "not-found");
    }
    /** Presence write, reflected in the returned row copy (the RPC doesn't return the row). */
    async markOnline(row, playerId, now) {
        const result = await this.deps.repository.setPresence(row.id, [playerId], true);
        if (!result.isSuccess) {
            logger_1.logger.warn("presence-update-failed", { sessionId: row.id, playerId });
            return row;
        }
        return { ...row, presence: { ...row.presence, [playerId]: now.toISOString() } };
    }
    async publishChange(row, reason) {
        try {
            this.onSaved?.(row, reason);
        }
        catch (error) {
            logger_1.logger.error("local-emit-failed", { sessionId: row.id, error });
        }
        try {
            await this.deps.bus.publish(row.id, { version: row.version, reason });
        }
        catch (error) {
            logger_1.logger.error("relay-publish-failed", { sessionId: row.id, version: row.version, reason, error });
        }
    }
}
exports.SessionService = SessionService;
function authenticatePlayer(row, playerToken) {
    if (!playerToken) {
        return (0, models_1.failure)("Player token is required", "unauthorized");
    }
    const tokenHash = (0, crypto_1.sha256)(playerToken);
    const player = row.state.players.find((candidate) => candidate.tokenHash === tokenHash);
    if (!player) {
        return (0, models_1.failure)("Unknown player token", "unauthorized");
    }
    if (player.status === "kicked") {
        return (0, models_1.failure)("You were kicked from this session", "forbidden", "kicked");
    }
    if (player.status === "left") {
        return (0, models_1.failure)("You are no longer in this session", "forbidden", "left");
    }
    return (0, models_1.success)(player);
}
/** Reasons a session doesn't accept new players (capacity is checked separately). */
function getJoinBlocker(row) {
    if (row.status === "finished") {
        return (0, models_1.failure)("The game has finished", "conflict", "session-finished");
    }
    if (row.status === "in_progress" && !row.state.settings.allowJoinInProgress) {
        return (0, models_1.failure)("The game has already started", "conflict", "session-started");
    }
    return null;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=session.service.js.map