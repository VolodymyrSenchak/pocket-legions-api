"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.joinSessionBodySchema = exports.createSessionBodySchema = exports.passwordSchema = exports.nicknameSchema = exports.PASSWORD_MAX_LENGTH = exports.NICKNAME_MAX_LENGTH = void 0;
const zod_1 = require("zod");
exports.NICKNAME_MAX_LENGTH = 20;
exports.PASSWORD_MAX_LENGTH = 64;
exports.nicknameSchema = zod_1.z
    .string()
    .trim()
    .min(1, "Nickname is required")
    .max(exports.NICKNAME_MAX_LENGTH, `Nickname must be at most ${exports.NICKNAME_MAX_LENGTH} characters`);
/** An empty password means "no password". */
exports.passwordSchema = zod_1.z.string().max(exports.PASSWORD_MAX_LENGTH, `Password must be at most ${exports.PASSWORD_MAX_LENGTH} characters`);
exports.createSessionBodySchema = zod_1.z.object({
    nickname: exports.nicknameSchema,
    password: exports.passwordSchema.optional(),
    settings: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
});
exports.joinSessionBodySchema = zod_1.z.object({
    nickname: exports.nicknameSchema,
    password: exports.passwordSchema.optional(),
});
//# sourceMappingURL=session.schemas.js.map