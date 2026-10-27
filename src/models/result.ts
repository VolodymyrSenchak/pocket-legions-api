export interface Result<T> {
  result?: T;
  error?: string | Error;
  errorStatus?: ErrorStatus;
  /** More specific machine-readable code for the client (defaults to `errorStatus`). */
  errorCode?: ErrorCode;
  /** Finer machine-readable detail, e.g. which army rule failed (`invalid-army` → `too-many-stacks`). */
  errorReason?: string;
  isSuccess: boolean;
}

export function success<T>(result: T): Result<T> {
  return {
    result,
    isSuccess: true,
  };
}

export function failure<T>(
  error: string | Error,
  errorStatus: ErrorStatus = "internal-server-error",
  errorCode?: ErrorCode
): Result<T> {
  return {
    error,
    errorStatus,
    ...(errorCode ? { errorCode } : {}),
    isSuccess: false,
  };
}

/** Re-types a failed result so it can be returned from a function with a different result type. */
export function forwardFailure<T>(result: Result<unknown>): Result<T> {
  return result as Result<T>;
}

export function fromDbResult<T>(result: T, error: Error): Result<T> {
  return error ? failure(error, 'db-error') : success(result);
}

export type ErrorStatus =
  | "db-error"
  | "not-found"
  | "unauthorized"
  | "forbidden"
  | "bad-request"
  | "conflict"
  | "gone"
  | "too-many-requests"
  | "internal-server-error";

export type ErrorCode =
  | ErrorStatus
  | "kicked"
  | "left"
  | "nickname-taken"
  | "session-full"
  | "session-finished"
  | "session-started"
  | "too-early"
  | "outdated"
  | "invalid-army"
  | "invalid-deploy"
  | "not-your-turn"
  | "illegal-action";
