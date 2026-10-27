import { AnyGameModule } from "../games/gameModule";
import { SessionRow, SessionView } from "../models";
import { getPollIntervalMs } from "../utils/pollInterval";
import { forbiddenRng } from "../utils/random";
import { isPlayerOnline } from "./presence";
import { buildGameContext, getActivePlayers } from "./roster";

/**
 * The only shape session data leaves the server in (HTTP responses and socket pushes).
 * Whitelist-based: secrets (token hashes, password hash) are never copied.
 * Deterministic for a given row, viewer and time, so it can back an ETag.
 */
export function projectSessionView(row: SessionRow, viewerId: string, now: Date, module: AnyGameModule): SessionView {
  const { state } = row;
  const viewer = state.players.find((player) => player.id === viewerId);
  if (!viewer) {
    throw new Error(`Player ${viewerId} is not part of session ${row.id}`);
  }

  const game = row.status !== "pending" && state.game !== null
    ? module.project(state.game, viewerId, buildGameContext(row, { actorId: viewerId, now, rng: forbiddenRng }))
    : null;

  return {
    code: row.code,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    hostPlayerId: row.hostPlayerId,
    me: { playerId: viewer.id, nickname: viewer.nickname, isHost: viewer.id === row.hostPlayerId },
    players: getActivePlayers(state).map((player) => ({
      id: player.id,
      nickname: player.nickname,
      isHost: player.id === row.hostPlayerId,
      isOnline: isPlayerOnline(player, row.presence, now),
      joinedAt: player.joinedAt,
    })),
    settings: { ...state.settings },
    poll: { intervalMs: getPollIntervalMs(row.status) },
    game,
  };
}
