"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemorySessionRepository = void 0;
const node_crypto_1 = require("node:crypto");
const models_1 = require("../models");
/** Same semantics as the Supabase repository; for tests and local single-process dev. */
class InMemorySessionRepository {
    options;
    rows = new Map();
    forcedConflicts = 0;
    constructor(options = {}) {
        this.options = options;
    }
    /** The next `count` compare-and-swap calls report a lost race. */
    forceConflicts(count) {
        this.forcedConflicts += count;
    }
    getAll() {
        return [...this.rows.values()].map((row) => structuredClone(row));
    }
    async insertWithUniqueCode(row, generateCode, now) {
        await this.delay();
        for (let attempt = 1; attempt <= 10; attempt++) {
            const code = generateCode();
            for (const existing of this.rows.values()) {
                if (existing.code === code && !existing.archived && (0, models_1.isSessionExpired)(existing, now)) {
                    existing.archived = true;
                }
            }
            if ([...this.rows.values()].some((existing) => existing.code === code && !existing.archived)) {
                continue;
            }
            const createdAt = now.toISOString();
            const inserted = {
                ...structuredClone(row),
                id: (0, node_crypto_1.randomUUID)(),
                code,
                version: 1,
                archived: false,
                createdAt,
                updatedAt: createdAt,
                expiresAt: new Date(now.getTime() + models_1.SESSION_LIFETIME_MS).toISOString(),
            };
            this.rows.set(inserted.id, inserted);
            return (0, models_1.success)(structuredClone(inserted));
        }
        return (0, models_1.failure)("Could not allocate a unique session code", "conflict");
    }
    async findLiveByCode(code) {
        await this.delay();
        const row = [...this.rows.values()].find((existing) => existing.code === code && !existing.archived);
        return (0, models_1.success)(row ? structuredClone(row) : null);
    }
    async findById(id) {
        await this.delay();
        const row = this.rows.get(id);
        return (0, models_1.success)(row && !row.archived ? structuredClone(row) : null);
    }
    async compareAndSwap(id, expectedVersion, draft) {
        await this.delay();
        if (this.forcedConflicts > 0) {
            this.forcedConflicts--;
            return (0, models_1.success)(null);
        }
        const row = this.rows.get(id);
        if (!row || row.archived || row.version !== expectedVersion) {
            return (0, models_1.success)(null);
        }
        const updated = {
            ...row,
            state: structuredClone(draft.state),
            status: draft.status,
            hostPlayerId: draft.hostPlayerId,
            version: row.version + 1,
            updatedAt: this.now().toISOString(),
        };
        this.rows.set(id, updated);
        return (0, models_1.success)(structuredClone(updated));
    }
    async getVersions(ids) {
        await this.delay();
        return (0, models_1.success)(ids
            .map((id) => this.rows.get(id))
            .filter((row) => !!row && !row.archived)
            .map((row) => ({ id: row.id, version: row.version, status: row.status, expiresAt: row.expiresAt })));
    }
    async setPresence(id, playerIds, online) {
        await this.delay();
        const row = this.rows.get(id);
        if (row && !row.archived) {
            const lastSeenAt = online ? this.now().toISOString() : null;
            row.presence = { ...row.presence, ...Object.fromEntries(playerIds.map((playerId) => [playerId, lastSeenAt])) };
        }
        return (0, models_1.success)(undefined);
    }
    now() {
        return this.options.clock ? this.options.clock() : new Date();
    }
    delay() {
        const ms = this.options.latencyMs ?? 0;
        return new Promise((resolve) => (ms > 0 ? setTimeout(resolve, ms) : setImmediate(resolve)));
    }
}
exports.InMemorySessionRepository = InMemorySessionRepository;
//# sourceMappingURL=sessionRepository.memory.js.map