"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setReqContext = setReqContext;
exports.getReqContext = getReqContext;
exports.getUserId = getUserId;
exports.setResResult = setResResult;
exports.sendApiResult = sendApiResult;
exports.sendApiError = sendApiError;
exports.toApiError = toApiError;
exports.getStatusCode = getStatusCode;
const logger_1 = require("./logger");
function setReqContext(req, contextParts) {
    req.context = { ...req.context, ...contextParts };
}
function getReqContext(req) {
    return req.context;
}
function getUserId(req) {
    return getReqContext(req).user?.id;
}
function setResResult(res, result, mapper, fixedErrorStatus) {
    const status = result.isSuccess
        ? 200
        : fixedErrorStatus ? fixedErrorStatus : getStatusCode(result.errorStatus);
    const json = result.isSuccess
        ? mapper ? mapper(result.result) : result.result
        : result.error;
    res.status(status).json(json);
    return res;
}
/** Session API responses: success body as is, errors as `{ error: { code, message } }`. */
function sendApiResult(res, result, successStatus = 200) {
    if (result.isSuccess) {
        return res.status(successStatus).json(result.result);
    }
    const error = toApiError(result);
    return sendApiError(res, result.errorStatus ?? "internal-server-error", error.message, error.code, error.reason);
}
function sendApiError(res, status, message, code, reason) {
    const httpStatus = getStatusCode(status);
    if (httpStatus >= 500) {
        logger_1.logger.error("http-5xx", { status, message });
    }
    return res.status(httpStatus).json({ error: { code: code ?? status, message, ...(reason ? { reason } : {}) } });
}
function toApiError(result) {
    const status = result.errorStatus ?? "internal-server-error";
    const internal = getStatusCode(status) >= 500;
    const message = result.error instanceof Error ? result.error.message : result.error ?? "Unknown error";
    if (internal) {
        logger_1.logger.error("internal-error", { status, message });
    }
    return {
        code: result.errorCode ?? status,
        message: internal ? "Internal server error" : message,
        ...(result.errorReason && !internal ? { reason: result.errorReason } : {}),
    };
}
function getStatusCode(errorStatus) {
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
//# sourceMappingURL=requestUtils.js.map