"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPollIntervalMs = getPollIntervalMs;
const POLL_INTERVAL_MS = {
    pending: 3000,
    in_progress: 1500,
    finished: 10000,
};
/** Polling interval for the HTTP fallback (the client uses 10 s while the tab is hidden). */
function getPollIntervalMs(status) {
    return POLL_INTERVAL_MS[status];
}
//# sourceMappingURL=pollInterval.js.map