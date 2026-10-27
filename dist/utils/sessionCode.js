"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSessionCode = generateSessionCode;
exports.isValidSessionCode = isValidSessionCode;
const SESSION_CODE_PATTERN = /^[0-9]{6}$/;
/** 6 digits, leading zeros allowed ("004213"). */
function generateSessionCode(rng) {
    return String(rng.int(1_000_000)).padStart(6, "0");
}
function isValidSessionCode(code) {
    return SESSION_CODE_PATTERN.test(code);
}
//# sourceMappingURL=sessionCode.js.map