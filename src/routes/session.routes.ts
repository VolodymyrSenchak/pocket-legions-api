import { Router } from "express";
import { createRateLimiter, passThrough } from "../middlewares/rateLimit";
import { getPlayerToken, requirePlayer } from "../middlewares/requirePlayer";
import { getValidatedBody, validateBody } from "../middlewares/validateBody";
import { CreateSessionBody, createSessionBodySchema, JoinSessionBody, joinSessionBodySchema } from "../models/session.schemas";
import { SessionService } from "../services/session.service";
import { sendApiResult } from "../utils/requestUtils";

export interface SessionRoutesOptions {
  /** In-app best-effort rate limits (default: on). */
  rateLimits?: boolean;
}

export function useSessionRoutes(sessionService: SessionService, options: SessionRoutesOptions = {}): Router {
  const router = Router();
  const rateLimits = options.rateLimits ?? true;
  // create / info / join are the abuse-prone (enumerable) endpoints
  const lookupLimiter = rateLimits ? createRateLimiter({ windowMs: 60_000, limit: 30 }) : passThrough;
  const playerLimiter = rateLimits ? createRateLimiter({ windowMs: 60_000, limit: 300 }) : passThrough;

  router.post("/", lookupLimiter, validateBody(createSessionBodySchema), async (_req, res) => {
    const result = await sessionService.create(getValidatedBody<CreateSessionBody>(res));
    sendApiResult(res, result, 201);
  });

  router.get("/:code/info", lookupLimiter, async (req, res) => {
    sendApiResult(res, await sessionService.info(req.params.code));
  });

  router.post("/:code/join", lookupLimiter, validateBody(joinSessionBodySchema), async (req, res) => {
    const result = await sessionService.join(req.params.code, getValidatedBody<JoinSessionBody>(res));
    sendApiResult(res, result);
  });

  // polling fallback; Express answers 304 when If-None-Match matches the ETag
  router.get("/:code/state", playerLimiter, requirePlayer, async (req, res) => {
    const result = await sessionService.getView(req.params.code, getPlayerToken(res));
    if (result.isSuccess) {
      res.set("Cache-Control", "private, no-cache");
    }
    sendApiResult(res, result);
  });

  router.post("/:code/actions", playerLimiter, requirePlayer, async (req, res) => {
    sendApiResult(res, await sessionService.dispatchAction(req.params.code, getPlayerToken(res), req.body));
  });

  router.get("/:code/history", playerLimiter, requirePlayer, async (req, res) => {
    sendApiResult(res, await sessionService.getHistory(req.params.code, getPlayerToken(res)));
  });

  return router;
}
