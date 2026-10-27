import { PlayerRecord, SessionRow } from "../models";
import { isPlayerOnline } from "../services/presence";
import { SessionRepository } from "../services/sessionRepository.service";
import { logger } from "../utils/logger";
import { Broadcaster } from "./broadcaster";
import { LocalSessions } from "./localSessions";
import { SessionBus } from "./sessionBus";

export interface PresenceTrackerDeps {
  repository: SessionRepository;
  localSessions: LocalSessions;
  broadcaster: Broadcaster;
  bus: SessionBus;
  clock: () => Date;
}

export interface PresenceTrackerOptions {
  /** A disconnect only counts once the player hasn't come back within this time (hides planned reconnects). */
  graceMs: number;
  heartbeatMs: number;
}

/** Best-effort online/offline status for the UI (§3.9). */
export class PresenceTracker {
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly graceTimers = new Set<NodeJS.Timeout>();

  constructor(private readonly deps: PresenceTrackerDeps, private readonly options: PresenceTrackerOptions) {}

  start(): void {
    this.heartbeatTimer ??= setInterval(() => void this.heartbeat(), this.options.heartbeatMs).unref();
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.graceTimers.forEach((timer) => clearTimeout(timer));
    this.graceTimers.clear();
  }

  async connected(row: SessionRow, player: PlayerRecord): Promise<void> {
    const wasOnline = isPlayerOnline(player, row.presence, this.deps.clock());
    const result = await this.deps.repository.setPresence(row.id, [player.id], true);
    if (!result.isSuccess) {
      return;
    }
    if (!wasOnline) {
      await this.announce(row.id, row.version);
    }
  }

  disconnected(sessionId: string, playerId: string): void {
    const disconnectedAt = this.deps.clock().getTime();
    const timer = setTimeout(() => {
      this.graceTimers.delete(timer);
      void this.markOfflineIfGone(sessionId, playerId, disconnectedAt).catch((error) =>
        logger.error("presence-offline-failed", { sessionId, playerId, error })
      );
    }, this.options.graceMs);
    timer.unref();
    this.graceTimers.add(timer);
  }

  /** One presence write per session held by this instance, covering all its connected players. */
  async heartbeat(): Promise<void> {
    await Promise.all(
      this.deps.localSessions.ids().map((sessionId) =>
        this.deps.repository.setPresence(sessionId, this.deps.localSessions.playerIds(sessionId), true)
      )
    );
  }

  private async markOfflineIfGone(sessionId: string, playerId: string, disconnectedAt: number): Promise<void> {
    if (this.deps.localSessions.hasPlayer(sessionId, playerId)) {
      return;
    }
    const found = await this.deps.repository.findById(sessionId);
    const row = found.result;
    if (!row) {
      return;
    }
    const player = row.state.players.find((candidate) => candidate.id === playerId);
    const lastSeenAt = row.presence[playerId];
    // not active any more, already offline, or reconnected on another instance
    if (!player || player.status !== "active" || !lastSeenAt || Date.parse(lastSeenAt) >= disconnectedAt) {
      return;
    }
    const result = await this.deps.repository.setPresence(sessionId, [playerId], false);
    if (result.isSuccess) {
      await this.announce(sessionId, row.version);
    }
  }

  private async announce(sessionId: string, version: number): Promise<void> {
    try {
      await this.deps.bus.publish(sessionId, { version, reason: "presence" });
    } catch (error) {
      logger.error("relay-publish-failed", { sessionId, reason: "presence", error });
    }
    await this.deps.broadcaster.requestReload(sessionId);
  }
}
