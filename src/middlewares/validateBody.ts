import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { sendApiError } from "../utils/requestUtils";

/** Validates `req.body` with a zod schema → 400; the parsed body is available via `getValidatedBody`. */
export function validateBody<T>(schema: z.ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendApiError(res, "bad-request", z.prettifyError(parsed.error));
      return;
    }
    res.locals.body = parsed.data;
    next();
  };
}

export function getValidatedBody<T>(res: Response): T {
  return res.locals.body as T;
}
