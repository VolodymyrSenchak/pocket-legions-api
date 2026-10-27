"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.passThrough = void 0;
exports.createRateLimiter = createRateLimiter;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const requestUtils_1 = require("../utils/requestUtils");
/**
 * Best-effort, per-instance rate limit. The real protection for the enumerable endpoints
 * is the Vercel WAF rate-limit rule (see the implementation plan §3.7).
 */
function createRateLimiter(options) {
    return (0, express_rate_limit_1.default)({
        windowMs: options.windowMs,
        limit: options.limit,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        handler: (_req, res) => {
            (0, requestUtils_1.sendApiError)(res, "too-many-requests", "Too many requests, please try again later");
        },
    });
}
const passThrough = (_req, _res, next) => next();
exports.passThrough = passThrough;
//# sourceMappingURL=rateLimit.js.map