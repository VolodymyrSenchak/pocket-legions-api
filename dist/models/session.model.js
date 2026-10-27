"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSION_LIFETIME_MS = void 0;
exports.isSessionExpired = isSessionExpired;
exports.SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;
function isSessionExpired(row, now) {
    return Date.parse(row.expiresAt) <= now.getTime();
}
//# sourceMappingURL=session.model.js.map