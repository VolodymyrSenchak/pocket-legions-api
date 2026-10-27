"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const corsUtils_1 = require("../utils/corsUtils");
const requestUtils_1 = require("../utils/requestUtils");
/** Last-resort handler: malformed/oversized JSON → 400, CORS → 403, anything else → 500. */
function errorHandler(err, _req, res, next) {
    if (res.headersSent) {
        next(err);
        return;
    }
    if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
        (0, requestUtils_1.sendApiError)(res, "bad-request", err.type === "entity.too.large" ? "Request body is too large" : "Malformed JSON body");
        return;
    }
    if (err?.message === corsUtils_1.CORS_ERROR_MESSAGE) {
        (0, requestUtils_1.sendApiError)(res, "forbidden", corsUtils_1.CORS_ERROR_MESSAGE);
        return;
    }
    (0, requestUtils_1.sendApiError)(res, "internal-server-error", err instanceof Error ? err.message : "Internal server error");
}
//# sourceMappingURL=errorHandler.js.map