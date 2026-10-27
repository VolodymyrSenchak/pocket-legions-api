import { randomUUID } from "node:crypto";
import {
  failure,
  isSessionExpired,
  NewSessionRow,
  Result,
  SESSION_LIFETIME_MS,
  SessionDraft,
  SessionRow,
  SessionVersionInfo,
  success,
} from "../models";
import { SessionRepository } from "./sessionRepository.service";

export interface InMemorySessionRepositoryOptions {
  /** Used for `updated_at` and presence timestamps (the DB uses now()). */
  clock?: () => Date;
  /** Simulated latency per call; 0 still yields to the event loop so concurrent calls interleave. */
  latencyMs?: number;
}

/** Same semantics as the Supabase repository; for tests and local single-process dev. */
export class InMemorySessionRepository implements SessionRepository {
  private readonly rows = new Map<string, SessionRow>();
  private forcedConflicts = 0;

  constructor(private readonly options: InMemorySessionRepositoryOptions = {}) {}

  /** The next `count` compare-and-swap calls report a lost race. */
  forceConflicts(count: number): void {
    this.forcedConflicts += count;
  }

  getAll(): SessionRow[] {
    return [...this.rows.values()].map((row) => structuredClone(row));
  }

  async insertWithUniqueCode(row: NewSessionRow, generateCode: () => string, now: Date): Promise<Result<SessionRow>> {
    await this.delay();
    for (let attempt = 1; attempt <= 10; attempt++) {
      const code = generateCode();
      for (const existing of this.rows.values()) {
        if (existing.code === code && !existing.archived && isSessionExpired(existing, now)) {
          existing.archived = true;
        }
      }
      if ([...this.rows.values()].some((existing) => existing.code === code && !existing.archived)) {
        continue;
      }
      const createdAt = now.toISOString();
      const inserted: SessionRow = {
        ...structuredClone(row),
        id: randomUUID(),
        code,
        version: 1,
        archived: false,
        createdAt,
        updatedAt: createdAt,
        expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString(),
      };
      this.rows.set(inserted.id, inserted);
      return success(structuredClone(inserted));
    }
    return failure("Could not allocate a unique session code", "conflict");
  }

  async findLiveByCode(code: string): Promise<Result<SessionRow | null>> {
    await this.delay();
    const row = [...this.rows.values()].find((existing) => existing.code === code && !existing.archived);
    return success(row ? structuredClone(row) : null);
  }

  async findById(id: string): Promise<Result<SessionRow | null>> {
    await this.delay();
    const row = this.rows.get(id);
    return success(row && !row.archived ? structuredClone(row) : null);
  }

  async compareAndSwap(id: string, expectedVersion: number, draft: SessionDraft): Promise<Result<SessionRow | null>> {
    await this.delay();
    if (this.forcedConflicts > 0) {
      this.forcedConflicts--;
      return success(null);
    }
    const row = this.rows.get(id);
    if (!row || row.archived || row.version !== expectedVersion) {
      return success(null);
    }
    const updated: SessionRow = {
      ...row,
      state: structuredClone(draft.state),
      status: draft.status,
      hostPlayerId: draft.hostPlayerId,
      version: row.version + 1,
      updatedAt: this.now().toISOString(),
    };
    this.rows.set(id, updated);
    return success(structuredClone(updated));
  }

  async getVersions(ids: string[]): Promise<Result<SessionVersionInfo[]>> {
    await this.delay();
    return success(
      ids
        .map((id) => this.rows.get(id))
        .filter((row): row is SessionRow => !!row && !row.archived)
        .map((row) => ({ id: row.id, version: row.version, status: row.status, expiresAt: row.expiresAt }))
    );
  }

  async setPresence(id: string, playerIds: string[], online: boolean): Promise<Result<void>> {
    await this.delay();
    const row = this.rows.get(id);
    if (row && !row.archived) {
      const lastSeenAt = online ? this.now().toISOString() : null;
      row.presence = { ...row.presence, ...Object.fromEntries(playerIds.map((playerId) => [playerId, lastSeenAt])) };
    }
    return success(undefined);
  }

  private now(): Date {
    return this.options.clock ? this.options.clock() : new Date();
  }

  private delay(): Promise<void> {
    const ms = this.options.latencyMs ?? 0;
    return new Promise((resolve) => (ms > 0 ? setTimeout(resolve, ms) : setImmediate(resolve)));
  }
}
