import { GameContext } from "../games/gameModule";
import { ActionContext } from "../models/action.model";
import { PlayerRecord, RemovalReason, SessionDraft, SessionRow, SessionState } from "../models";

export function getActivePlayers(state: Pick<SessionState, "players">): PlayerRecord[] {
  return state.players.filter((player) => player.status === "active");
}

export function isSameNickname(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Deep copy of the mutable part of a row, so reducers never touch the loaded row. */
export function toDraft(row: SessionRow): SessionDraft {
  return structuredClone({ status: row.status, hostPlayerId: row.hostPlayerId, state: row.state });
}

export function buildGameContext(
  draft: SessionDraft,
  env: Pick<ActionContext, "actorId" | "now" | "rng">
): GameContext<any> {
  return {
    actorId: env.actorId,
    hostPlayerId: draft.hostPlayerId,
    activePlayers: getActivePlayers(draft.state),
    settings: draft.state.settings,
    status: draft.status,
    now: env.now,
    rng: env.rng,
  };
}

function earliestJoined(players: PlayerRecord[]): PlayerRecord {
  // Array.prototype.sort is stable, so ties keep join order
  return [...players].sort((a, b) => Date.parse(a.joinedAt) - Date.parse(b.joinedAt))[0];
}

/**
 * Marks a player as no longer active and applies the side effects:
 * host passes to the earliest-joined active player, the game module is notified,
 * and the session finishes when nobody is left.
 */
export function removePlayer(draft: SessionDraft, playerId: string, reason: RemovalReason, env: ActionContext): SessionDraft {
  const players = draft.state.players.map((player): PlayerRecord =>
    player.id === playerId
      ? { ...player, status: reason === "kicked" ? "kicked" : "left", removalReason: reason }
      : player
  );
  let next: SessionDraft = { ...draft, state: { ...draft.state, players } };

  const remaining = getActivePlayers(next.state);
  if (remaining.length === 0) {
    return { ...next, status: "finished" };
  }
  if (next.hostPlayerId === playerId) {
    next = { ...next, hostPlayerId: earliestJoined(remaining).id };
  }
  if (next.status === "in_progress" && next.state.game !== null && env.module.onPlayerRemoved) {
    const transition = env.module.onPlayerRemoved(buildGameContext(next, env), next.state.game, playerId);
    next = {
      ...next,
      status: transition.finished ? "finished" : next.status,
      state: { ...next.state, game: transition.state },
    };
  }
  return next;
}

/** Adds a player and lets the game module include them in a running game. */
export function addPlayer(draft: SessionDraft, player: PlayerRecord, env: ActionContext): SessionDraft {
  let next: SessionDraft = { ...draft, state: { ...draft.state, players: [...draft.state.players, player] } };
  if (next.status === "in_progress" && next.state.game !== null && env.module.onPlayerJoined) {
    const game = env.module.onPlayerJoined(buildGameContext(next, env), next.state.game, player.id);
    next = { ...next, state: { ...next.state, game } };
  }
  return next;
}
