"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.success = success;
exports.failure = failure;
exports.forwardFailure = forwardFailure;
exports.fromDbResult = fromDbResult;
function success(result) {
    return {
        result,
        isSuccess: true,
    };
}
function failure(error, errorStatus = "internal-server-error", errorCode) {
    return {
        error,
        errorStatus,
        ...(errorCode ? { errorCode } : {}),
        isSuccess: false,
    };
}
/** Re-types a failed result so it can be returned from a function with a different result type. */
function forwardFailure(result) {
    return result;
}
function fromDbResult(result, error) {
    return error ? failure(error, 'db-error') : success(result);
}
//# sourceMappingURL=result.js.map