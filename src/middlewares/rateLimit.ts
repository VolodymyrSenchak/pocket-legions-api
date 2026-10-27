import { NextFunction, Request, RequestHandler, Response } from "express";
import rateLimit from "express-rate-limit";
import { sendApiError } from "../utils/requestUtils";

/**
 * Best-effort, per-instance rate limit. The real protection for the enumerable endpoints
 * is the Vercel WAF rate-limit rule (see the implementation plan §3.7).
 */
export function createRateLimiter(options: { windowMs: number; limit: number }): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
      sendApiError(res, "too-many-requests", "Too many requests, please try again later");
    },
  });
}

export const passThrough: RequestHandler = (_req: Request, _res: Response, next: NextFunction) => next();
