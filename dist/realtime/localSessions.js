"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalSessions = void 0;
/** Per-instance socket bookkeeping. Nothing here is a source of truth. */
class LocalSessions {
    sessions = new Map();
    add(socket, version, now) {
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
    remove(socket) {
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
    get(sessionId) {
        return this.sessions.get(sessionId);
    }
    ids() {
        return [...this.sessions.keys()];
    }
    hasPlayer(sessionId, playerId) {
        return [...(this.sessions.get(sessionId)?.sockets ?? [])].some((socket) => socket.data.playerId === playerId);
    }
    playerIds(sessionId) {
        return [...new Set([...(this.sessions.get(sessionId)?.sockets ?? [])].map((socket) => socket.data.playerId))];
    }
}
exports.LocalSessions = LocalSessions;
//# sourceMappingURL=localSessions.js.map