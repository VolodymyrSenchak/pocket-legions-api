import { NextFunction, Request, Response } from "express";
import { CORS_ERROR_MESSAGE } from "../utils/corsUtils";
import { sendApiError } from "../utils/requestUtils";

/** Last-resort handler: malformed/oversized JSON → 400, CORS → 403, anything else → 500. */
export function errorHandler(err: any, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
    sendApiError(res, "bad-request", err.type === "entity.too.large" ? "Request body is too large" : "Malformed JSON body");
    return;
  }
  if (err?.message === CORS_ERROR_MESSAGE) {
    sendApiError(res, "forbidden", CORS_ERROR_MESSAGE);
    return;
  }
  sendApiError(res, "internal-server-error", err instanceof Error ? err.message : "Internal server error");
}
