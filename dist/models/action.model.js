"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.actionRequestSchema = void 0;
const zod_1 = require("zod");
exports.actionRequestSchema = zod_1.z.object({
    type: zod_1.z.string().min(1).max(100),
    payload: zod_1.z.unknown().optional(),
});
//# sourceMappingURL=action.model.js.map