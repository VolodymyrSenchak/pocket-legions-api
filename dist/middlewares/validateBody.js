"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateBody = validateBody;
exports.getValidatedBody = getValidatedBody;
const zod_1 = require("zod");
const requestUtils_1 = require("../utils/requestUtils");
/** Validates `req.body` with a zod schema → 400; the parsed body is available via `getValidatedBody`. */
function validateBody(schema) {
    return (req, res, next) => {
        const parsed = schema.safeParse(req.body ?? {});
        if (!parsed.success) {
            (0, requestUtils_1.sendApiError)(res, "bad-request", zod_1.z.prettifyError(parsed.error));
            return;
        }
        res.locals.body = parsed.data;
        next();
    };
}
function getValidatedBody(res) {
    return res.locals.body;
}
//# sourceMappingURL=validateBody.js.map