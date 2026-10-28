import { SupabaseClient } from "@supabase/supabase-js";
import {
  failure,
  NewSessionRow,
  PresenceMap,
  Result,
  SessionDraft,
  SessionRow,
  SessionState,
  SessionStatus,
  SessionVersionInfo,
  success,
} from "../models";
import { logger } from "../utils/logger";

export interface SessionRepository {
  /** Archives expired rows with the same code, inserts, and retries with a new code on a collision. */
  insertWithUniqueCode(row: NewSessionRow, generateCode: () => string, now: Date): Promise<Result<SessionRow>>;
  findLiveByCode(code: string): Promise<Result<SessionRow | null>>;
  findById(id: string): Promise<Result<SessionRow | null>>;
  /** Writes state/status/host and bumps the version only if it still equals `expectedVersion`. `null` = lost the race. */
  compareAndSwap(id: string, expectedVersion: number, draft: SessionDraft): Promise<Result<SessionRow | null>>;
  getVersions(ids: string[]): Promise<Result<SessionVersionInfo[]>>;
  /** Atomic presence merge; never changes the version. */
  setPresence(id: string, playerIds: string[], online: boolean): Promise<Result<void>>;
}

// The deployed database still uses the game's old name; renaming needs a migration.
const TABLE = "pocket_legions_session";
const PRESENCE_RPC = "pocket_legions_session_presence";
const UNIQUE_VIOLATION = "23505";
const MAX_CODE_ATTEMPTS = 10;
const COLUMNS =
  "id, code, status, password_hash, host_player_id, state, presence, version, archived, created_at, updated_at, expires_at";

interface SessionRecord {
  id: string;
  code: string;
  status: SessionStatus;
  password_hash: string | null;
  host_player_id: string;
  state: SessionState;
  presence: PresenceMap | null;
  version: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

const toIso = (value: string) => new Date(value).toISOString();

function toSessionRow(record: SessionRecord): SessionRow {
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

function dbFailure<T>(operation: string, error: { message: string; code?: string }): Result<T> {
  logger.error("db-error", { operation, message: error.message, code: error.code });
  return failure(error.message, "db-error");
}

export class SupabaseSessionRepository implements SessionRepository {
  constructor(private readonly db: SupabaseClient) {}

  async insertWithUniqueCode(row: NewSessionRow, generateCode: () => string, now: Date): Promise<Result<SessionRow>> {
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
      return success(toSessionRow(data as SessionRecord));
    }
    return failure("Could not allocate a unique session code", "conflict");
  }

  async findLiveByCode(code: string): Promise<Result<SessionRow | null>> {
    const { data, error } = await this.db.from(TABLE).select(COLUMNS).eq("code", code).eq("archived", false).maybeSingle();
    return error ? dbFailure("find-by-code", error) : success(data ? toSessionRow(data as SessionRecord) : null);
  }

  async findById(id: string): Promise<Result<SessionRow | null>> {
    const { data, error } = await this.db.from(TABLE).select(COLUMNS).eq("id", id).eq("archived", false).maybeSingle();
    return error ? dbFailure("find-by-id", error) : success(data ? toSessionRow(data as SessionRecord) : null);
  }

  async compareAndSwap(id: string, expectedVersion: number, draft: SessionDraft): Promise<Result<SessionRow | null>> {
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
    const records = (data ?? []) as SessionRecord[];
    return success(records.length ? toSessionRow(records[0]) : null);
  }

  async getVersions(ids: string[]): Promise<Result<SessionVersionInfo[]>> {
    if (ids.length === 0) {
      return success([]);
    }
    const { data, error } = await this.db
      .from(TABLE)
      .select("id, version, status, expires_at")
      .in("id", ids)
      .eq("archived", false);
    if (error) {
      return dbFailure("get-versions", error);
    }
    return success(
      ((data ?? []) as Pick<SessionRecord, "id" | "version" | "status" | "expires_at">[]).map((record) => ({
        id: record.id,
        version: record.version,
        status: record.status,
        expiresAt: toIso(record.expires_at),
      }))
    );
  }

  async setPresence(id: string, playerIds: string[], online: boolean): Promise<Result<void>> {
    if (playerIds.length === 0) {
      return success(undefined);
    }
    const { error } = await this.db.rpc(PRESENCE_RPC, {
      p_session_id: id,
      p_player_ids: playerIds,
      p_online: online,
    });
    return error ? dbFailure("set-presence", error) : success(undefined);
  }
}
