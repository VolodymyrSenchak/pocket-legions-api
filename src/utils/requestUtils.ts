import {Request, Response} from "express";
import {User} from "@supabase/supabase-js";
import {ErrorCode, ErrorStatus, Result} from "../models";
import {logger} from "./logger";

export interface RequestContext {
  user?: User;
}

export interface ApiError {
  code: ErrorCode;
  message: string;
  reason?: string;
}

export function setReqContext(req: Request, contextParts: Partial<RequestContext>): void {
  (req as any).context = { ...(req as any).context, ...contextParts };
}

export function getReqContext(req: Request): RequestContext {
  return (req as any).context as RequestContext;
}

export function getUserId(req: Request): string | undefined {
  return getReqContext(req).user?.id;
}

export function setResResult<T>(
  res: Response,
  result: Result<T>,
  mapper?: ((result: T) => any) | null,
  fixedErrorStatus?: number
): Response {
  const status = result.isSuccess
    ? 200
    : fixedErrorStatus ? fixedErrorStatus : getStatusCode(result.errorStatus!);
  const json = result.isSuccess
    ? mapper ? mapper(result.result!) : result.result
    : result.error;
  res.status(status).json(json);
  return res;
}

/** Session API responses: success body as is, errors as `{ error: { code, message } }`. */
export function sendApiResult<T>(res: Response, result: Result<T>, successStatus = 200): Response {
  if (result.isSuccess) {
    return res.status(successStatus).json(result.result);
  }
  const error = toApiError(result);
  return sendApiError(res, result.errorStatus ?? "internal-server-error", error.message, error.code, error.reason);
}

export function sendApiError(res: Response, status: ErrorStatus, message: string, code?: ErrorCode, reason?: string): Response {
  const httpStatus = getStatusCode(status);
  if (httpStatus >= 500) {
    logger.error("http-5xx", { status, message });
  }
  return res.status(httpStatus).json({ error: { code: code ?? status, message, ...(reason ? { reason } : {}) } });
}

export function toApiError(result: Result<unknown>): ApiError {
  const status = result.errorStatus ?? "internal-server-error";
  const internal = getStatusCode(status) >= 500;
  const message = result.error instanceof Error ? result.error.message : result.error ?? "Unknown error";
  if (internal) {
    logger.error("internal-error", { status, message });
  }
  return {
    code: result.errorCode ?? status,
    message: internal ? "Internal server error" : message,
    ...(result.errorReason && !internal ? { reason: result.errorReason } : {}),
  };
}

export function getStatusCode(errorStatus: ErrorStatus): number {
  switch (errorStatus) {
    case "bad-request": return 400;
    case "unauthorized": return 401;
    case "forbidden": return 403;
    case "not-found": return 404;
    case "conflict": return 409;
    case "gone": return 410;
    case "too-many-requests": return 429;
    default: return 500;
  }
}
