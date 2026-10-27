import { SessionRepository } from "../services/sessionRepository.service";
import { logger } from "../utils/logger";
import { Broadcaster } from "./broadcaster";
import { LocalSessions } from "./localSessions";

export interface MaintenanceTickDeps {
  repository: SessionRepository;
  localSessions: LocalSessions;
  broadcaster: Broadcaster;
  clock: () => Date;
}

export interface MaintenanceTickOptions {
  intervalMs: number;
  /** Disconnect sockets of sessions that haven't changed for this long (`session:idle`). */
  idleTimeoutMs: number;
  /** Keep sockets of a finished session this long so players see the final state. */
  finishedGraceMs: number;
}

/** Per-instance safety net: missed relay messages, expiry and the idle policy. */
export class MaintenanceTick {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: MaintenanceTickDeps, private readonly options: MaintenanceTickOptions) {}

  start(): void {
    this.timer ??= setInterval(() => void this.runOnce(), this.options.intervalMs).unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.check();
    } catch (error) {
      logger.error("maintenance-tick-failed", { error });
    } finally {
      this.running = false;
    }
  }

  private async check(): Promise<void> {
    const { localSessions, broadcaster } = this.deps;
    const ids = localSessions.ids();
    if (ids.length === 0) {
      return;
    }
    const versions = await this.deps.repository.getVersions(ids);
    if (!versions.isSuccess) {
      return;
    }
    const byId = new Map(versions.result!.map((info) => [info.id, info]));

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
        logger.warn("safety-net-recovery", { sessionId, version: info.version, lastEmittedVersion });
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
