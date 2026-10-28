"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabaseSessionRepository = void 0;
const models_1 = require("../models");
const logger_1 = require("../utils/logger");
// The deployed database still uses the game's old name; renaming needs a migration.
const TABLE = "pocket_legions_session";
const PRESENCE_RPC = "pocket_legions_session_presence";
const UNIQUE_VIOLATION = "23505";
const MAX_CODE_ATTEMPTS = 10;
const COLUMNS = "id, code, status, password_hash, host_player_id, state, presence, version, archived, created_at, updated_at, expires_at";
const toIso = (value) => new Date(value).toISOString();
function toSessionRow(record) {
    return {
        id: record.id,
        code: record.code,
        status: record.status,
        passwordHash: record.password_hash,
        hostPlayerId: record.host_player_id,
        state: record.state,
        presence: record.presence ?? {},
        version: record.version,
        archived: record.archived,
        createdAt: toIso(record.created_at),
        updatedAt: toIso(record.updated_at),
        expiresAt: toIso(record.expires_at),
    };
}
function dbFailure(operation, error) {
    logger_1.logger.error("db-error", { operation, message: error.message, code: error.code });
    return (0, models_1.failure)(error.message, "db-error");
}
class SupabaseSessionRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async insertWithUniqueCode(row, generateCode, now) {
        for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
            const code = generateCode();
            const archived = await this.db
                .from(TABLE)
                .update({ archived: true })
                .eq("code", code)
                .eq("archived", false)
                .lte("expires_at", now.toISOString());
            if (archived.error) {
                return dbFailure("archive-expired", archived.error);
            }
            const { data, error } = await this.db
                .from(TABLE)
                .insert({
                code,
                status: row.status,
                password_hash: row.passwordHash,
                host_player_id: row.hostPlayerId,
                state: row.state,
                presence: row.presence,
            })
                .select(COLUMNS)
                .single();
            if (error?.code === UNIQUE_VIOLATION) {
                continue;
            }
            if (error) {
                return dbFailure("insert", error);
            }
            return (0, models_1.success)(toSessionRow(data));
        }
        return (0, models_1.failure)("Could not allocate a unique session code", "conflict");
    }
    async findLiveByCode(code) {
        const { data, error } = await this.db.from(TABLE).select(COLUMNS).eq("code", code).eq("archived", false).maybeSingle();
        return error ? dbFailure("find-by-code", error) : (0, models_1.success)(data ? toSessionRow(data) : null);
    }
    async findById(id) {
        const { data, error } = await this.db.from(TABLE).select(COLUMNS).eq("id", id).eq("archived", false).maybeSingle();
        return error ? dbFailure("find-by-id", error) : (0, models_1.success)(data ? toSessionRow(data) : null);
    }
    async compareAndSwap(id, expectedVersion, draft) {
        const { data, error } = await this.db
            .from(TABLE)
            .update({
            state: draft.state,
            status: draft.status,
            host_player_id: draft.hostPlayerId,
            version: expectedVersion + 1,
            updated_at: new Date().toISOString(),
        })
            .eq("id", id)
            .eq("version", expectedVersion)
            .eq("archived", false)
            .select(COLUMNS);
        if (error) {
            return dbFailure("compare-and-swap", error);
        }
        const records = (data ?? []);
        return (0, models_1.success)(records.length ? toSessionRow(records[0]) : null);
    }
    async getVersions(ids) {
        if (ids.length === 0) {
            return (0, models_1.success)([]);
        }
        const { data, error } = await this.db
            .from(TABLE)
            .select("id, version, status, expires_at")
            .in("id", ids)
            .eq("archived", false);
        if (error) {
            return dbFailure("get-versions", error);
        }
        return (0, models_1.success)((data ?? []).map((record) => ({
            id: record.id,
            version: record.version,
            status: record.status,
            expiresAt: toIso(record.expires_at),
        })));
    }
    async setPresence(id, playerIds, online) {
        if (playerIds.length === 0) {
            return (0, models_1.success)(undefined);
        }
        const { error } = await this.db.rpc(PRESENCE_RPC, {
            p_session_id: id,
            p_player_ids: playerIds,
            p_online: online,
        });
        return error ? dbFailure("set-presence", error) : (0, models_1.success)(undefined);
    }
}
exports.SupabaseSessionRepository = SupabaseSessionRepository;
//# sourceMappingURL=sessionRepository.service.js.map