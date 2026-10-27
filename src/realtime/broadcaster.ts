import { AnyGameModule } from "../games/gameModule";
import { isSessionExpired, SessionRow } from "../models";
import { SessionRepository } from "../services/sessionRepository.service";
import { projectSessionView } from "../services/sessionView";
import { logger } from "../utils/logger";
import { LocalSessions } from "./localSessions";
import { BusMessage } from "./sessionBus";

export interface BroadcasterDeps {
  repository: SessionRepository;
  localSessions: LocalSessions;
  module: AnyGameModule;
  clock: () => Date;
}

/** Pushes per-player snapshots to the sockets held by this instance. */
export class Broadcaster {
  private readonly reloads = new Map<string, { running: Promise<void>; again: boolean }>();

  constructor(private readonly deps: BroadcasterDeps) {}

  /** Emits a projected snapshot of `row` to each local socket of the session. */
  emitLocal(row: SessionRow): void {
    const local = this.deps.localSessions.get(row.id);
    if (!local || row.version < local.lastEmittedVersion) {
      return;
    }
    const now = this.deps.clock();
    if (isSessionExpired(row, now)) {
      this.expireLocal(row.id, row.expiresAt);
      return;
    }
    if (row.version > local.lastEmittedVersion) {
      local.lastEmittedVersion = row.version;
      local.lastChangeAt = now.getTime();
    }

    for (const socket of [...local.sockets]) {
      const player = row.state.players.find((candidate) => candidate.id === socket.data.playerId);
      if (!player || player.status !== "active") {
        socket.emit("player:removed", { reason: player?.removalReason ?? (player?.status === "kicked" ? "kicked" : "left") });
        socket.disconnect(true);
        continue;
      }
      socket.emit("session:state", projectSessionView(row, player.id, now, this.deps.module));
    }
  }

  onBusMessage(sessionId: string, message: BusMessage): void {
    const local = this.deps.localSessions.get(sessionId);
    if (!local || (message.reason === "state" && message.version <= local.lastEmittedVersion)) {
      return;
    }
    void this.requestReload(sessionId);
  }

  /** Reloads the row and emits it. Coalesced: at most one reload in flight per session, re-run once if more requests arrived. */
  requestReload(sessionId: string): Promise<void> {
    const inFlight = this.reloads.get(sessionId);
    if (inFlight) {
      inFlight.again = true;
      return inFlight.running;
    }
    const entry = { running: Promise.resolve(), again: false };
    entry.running = (async () => {
      try {
        do {
          entry.again = false;
          await this.reloadOnce(sessionId);
        } while (entry.again);
      } catch (error) {
        logger.error("broadcast-reload-failed", { sessionId, error });
      } finally {
        this.reloads.delete(sessionId);
      }
    })();
    this.reloads.set(sessionId, entry);
    return entry.running;
  }

  expireLocal(sessionId: string, expiresAt: string): void {
    for (const socket of [...(this.deps.localSessions.get(sessionId)?.sockets ?? [])]) {
      socket.emit("session:expired", { expiresAt });
      socket.disconnect(true);
    }
  }

  disconnectAll(sessionId: string): void {
    for (const socket of [...(this.deps.localSessions.get(sessionId)?.sockets ?? [])]) {
      socket.disconnect(true);
    }
  }

  private async reloadOnce(sessionId: string): Promise<void> {
    if (!this.deps.localSessions.get(sessionId)) {
      return;
    }
    const found = await this.deps.repository.findById(sessionId);
    if (!found.isSuccess) {
      logger.warn("broadcast-reload-failed", { sessionId });
      return;
    }
    if (!found.result) {
      this.disconnectAll(sessionId);
      return;
    }
    this.emitLocal(found.result);
  }
}
