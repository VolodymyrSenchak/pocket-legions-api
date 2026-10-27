import { AppSocket } from "./socketTypes";

export interface LocalSession {
  sessionId: string;
  sockets: Set<AppSocket>;
  lastEmittedVersion: number;
  /** Last time a new version was seen (ms); drives the idle policy. */
  lastChangeAt: number;
}

/** Per-instance socket bookkeeping. Nothing here is a source of truth. */
export class LocalSessions {
  private readonly sessions = new Map<string, LocalSession>();

  add(socket: AppSocket, version: number, now: number): { session: LocalSession; isFirst: boolean } {
    const { sessionId } = socket.data;
    let session = this.sessions.get(sessionId);
    const isFirst = !session;
    if (!session) {
      session = { sessionId, sockets: new Set(), lastEmittedVersion: version, lastChangeAt: now };
      this.sessions.set(sessionId, session);
    }
    session.sockets.add(socket);
    return { session, isFirst };
  }

  /** Returns true when the last local socket of the session left. */
  remove(socket: AppSocket): boolean {
    const session = this.sessions.get(socket.data.sessionId);
    if (!session || !session.sockets.delete(socket)) {
      return false;
    }
    if (session.sockets.size === 0) {
      this.sessions.delete(session.sessionId);
      return true;
    }
    return false;
  }

  get(sessionId: string): LocalSession | undefined {
    return this.sessions.get(sessionId);
  }

  ids(): string[] {
    return [...this.sessions.keys()];
  }

  hasPlayer(sessionId: string, playerId: string): boolean {
    return [...(this.sessions.get(sessionId)?.sockets ?? [])].some((socket) => socket.data.playerId === playerId);
  }

  playerIds(sessionId: string): string[] {
    return [...new Set([...(this.sessions.get(sessionId)?.sockets ?? [])].map((socket) => socket.data.playerId))];
  }
}
