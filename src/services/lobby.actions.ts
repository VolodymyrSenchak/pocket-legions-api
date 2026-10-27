import { z } from "zod";
import { ActionContext } from "../models/action.model";
import { failure, forwardFailure, Result, SessionDraft, success } from "../models";
import { buildGameContext, getActivePlayers, removePlayer } from "./roster";

/** Game-agnostic lobby action (wire type: `lobby.<name>`). */
export interface LobbyAction {
  schema: z.ZodType;
  handle(env: ActionContext, draft: SessionDraft, payload: unknown): Result<SessionDraft>;
}

function defineLobbyAction<TPayload>(
  schema: z.ZodType<TPayload>,
  handle: (env: ActionContext, draft: SessionDraft, payload: TPayload) => Result<SessionDraft>
): LobbyAction {
  return { schema, handle: (env, draft, payload) => handle(env, draft, payload as TPayload) };
}

function requireHost(env: ActionContext, draft: SessionDraft): Result<SessionDraft> | null {
  return draft.hostPlayerId === env.actorId ? null : failure("Only the host can do this", "forbidden");
}

function findOtherActivePlayer(env: ActionContext, draft: SessionDraft, playerId: string): Result<SessionDraft> | null {
  if (playerId === env.actorId) {
    return failure("You can't target yourself", "bad-request");
  }
  const target = getActivePlayers(draft.state).find((player) => player.id === playerId);
  return target ? null : failure("Player not found", "not-found");
}

const playerIdPayload = z.object({ playerId: z.string().min(1) });

export const lobbyActions: Record<string, LobbyAction> = {
  start: defineLobbyAction(z.object({}), (env, draft) => {
    const denied = requireHost(env, draft);
    if (denied) return denied;
    if (draft.status !== "pending") {
      return failure("The game has already started", "conflict");
    }
    if (getActivePlayers(draft.state).length < env.module.minPlayers) {
      return failure(`At least ${env.module.minPlayers} players are needed to start`, "conflict");
    }

    const started: SessionDraft = { ...draft, status: "in_progress" };
    const initial = env.module.createInitialState(buildGameContext(started, env));
    if (!initial.isSuccess) {
      return forwardFailure(initial);
    }
    return success({ ...started, state: { ...started.state, game: initial.result } });
  }),

  kick: defineLobbyAction(playerIdPayload, (env, draft, { playerId }) => {
    const denied = requireHost(env, draft) ?? findOtherActivePlayer(env, draft, playerId);
    if (denied) return denied;
    return success(removePlayer(draft, playerId, "kicked", env));
  }),

  transferHost: defineLobbyAction(playerIdPayload, (env, draft, { playerId }) => {
    const denied = requireHost(env, draft) ?? findOtherActivePlayer(env, draft, playerId);
    if (denied) return denied;
    return success({ ...draft, hostPlayerId: playerId });
  }),

  leave: defineLobbyAction(z.object({}), (env, draft) => success(removePlayer(draft, env.actorId, "left", env))),

  end: defineLobbyAction(z.object({}), (env, draft) => {
    const denied = requireHost(env, draft);
    if (denied) return denied;
    if (draft.status !== "in_progress") {
      return failure("The game is not in progress", "conflict");
    }
    return success({ ...draft, status: "finished" });
  }),
};
