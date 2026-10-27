"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useSessionRoutes = useSessionRoutes;
const express_1 = require("express");
const rateLimit_1 = require("../middlewares/rateLimit");
const requirePlayer_1 = require("../middlewares/requirePlayer");
const validateBody_1 = require("../middlewares/validateBody");
const session_schemas_1 = require("../models/session.schemas");
const requestUtils_1 = require("../utils/requestUtils");
function useSessionRoutes(sessionService, options = {}) {
    const router = (0, express_1.Router)();
    const rateLimits = options.rateLimits ?? true;
    // create / info / join are the abuse-prone (enumerable) endpoints
    const lookupLimiter = rateLimits ? (0, rateLimit_1.createRateLimiter)({ windowMs: 60_000, limit: 30 }) : rateLimit_1.passThrough;
    const playerLimiter = rateLimits ? (0, rateLimit_1.createRateLimiter)({ windowMs: 60_000, limit: 300 }) : rateLimit_1.passThrough;
    router.post("/", lookupLimiter, (0, validateBody_1.validateBody)(session_schemas_1.createSessionBodySchema), async (_req, res) => {
        const result = await sessionService.create((0, validateBody_1.getValidatedBody)(res));
        (0, requestUtils_1.sendApiResult)(res, result, 201);
    });
    router.get("/:code/info", lookupLimiter, async (req, res) => {
        (0, requestUtils_1.sendApiResult)(res, await sessionService.info(req.params.code));
    });
    router.post("/:code/join", lookupLimiter, (0, validateBody_1.validateBody)(session_schemas_1.joinSessionBodySchema), async (req, res) => {
        const result = await sessionService.join(req.params.code, (0, validateBody_1.getValidatedBody)(res));
        (0, requestUtils_1.sendApiResult)(res, result);
    });
    // polling fallback; Express answers 304 when If-None-Match matches the ETag
    router.get("/:code/state", playerLimiter, requirePlayer_1.requirePlayer, async (req, res) => {
        const result = await sessionService.getView(req.params.code, (0, requirePlayer_1.getPlayerToken)(res));
        if (result.isSuccess) {
            res.set("Cache-Control", "private, no-cache");
        }
        (0, requestUtils_1.sendApiResult)(res, result);
    });
    router.post("/:code/actions", playerLimiter, requirePlayer_1.requirePlayer, async (req, res) => {
        (0, requestUtils_1.sendApiResult)(res, await sessionService.dispatchAction(req.params.code, (0, requirePlayer_1.getPlayerToken)(res), req.body));
    });
    router.get("/:code/history", playerLimiter, requirePlayer_1.requirePlayer, async (req, res) => {
        (0, requestUtils_1.sendApiResult)(res, await sessionService.getHistory(req.params.code, (0, requirePlayer_1.getPlayerToken)(res)));
    });
    return router;
}
//# sourceMappingURL=session.routes.js.map