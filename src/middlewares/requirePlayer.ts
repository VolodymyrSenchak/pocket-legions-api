import { NextFunction, Request, Response } from "express";
import { sendApiError } from "../utils/requestUtils";

export const PLAYER_TOKEN_HEADER = "X-Player-Token";

/**
 * Requires the anonymous player token header (kept separate from the Supabase `Authorization` auth).
 * The player itself is resolved by the session service against the freshly loaded row,
 * so an action doesn't read the session twice.
 */
export function requirePlayer(req: Request, res: Response, next: NextFunction): void {
  const token = req.get(PLAYER_TOKEN_HEADER);
  if (!token) {
    sendApiError(res, "unauthorized", `${PLAYER_TOKEN_HEADER} header is required`);
    return;
  }
  res.locals.playerToken = token;
  next();
}

export function getPlayerToken(res: Response): string {
  return res.locals.playerToken as string;
}
