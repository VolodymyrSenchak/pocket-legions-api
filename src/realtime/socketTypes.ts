import type { Server, Socket } from "socket.io";
import type { RemovalReason, SessionView } from "../models";
import type { ApiError } from "../utils/requestUtils";

export type ActionAck = { ok: true; session: SessionView } | { ok: false; error: ApiError };

export interface ServerToClientEvents {
  "session:state": (view: SessionView) => void;
  "session:expired": (payload: { expiresAt: string }) => void;
  "session:idle": (payload: Record<string, never>) => void;
  "player:removed": (payload: { reason: RemovalReason }) => void;
}

export interface ClientToServerEvents {
  action: (request: unknown, ack: (response: ActionAck) => void) => void;
}

export interface SocketData {
  sessionId: string;
  code: string;
  playerId: string;
  playerToken: string;
  connectedAt: number;
}

export type AppServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
