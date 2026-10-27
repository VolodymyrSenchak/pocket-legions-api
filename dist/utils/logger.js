"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const LEVEL_ORDER = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
function threshold() {
    const configured = process.env.LOG_LEVEL;
    return (configured && LEVEL_ORDER[configured]) ?? LEVEL_ORDER.info;
}
function serialize(data = {}) {
    return Object.fromEntries(Object.entries(data).map(([key, value]) => value instanceof Error ? [key, { message: value.message, stack: value.stack }] : [key, value]));
}
function write(level, event, data) {
    if (LEVEL_ORDER[level] < threshold()) {
        return;
    }
    const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...serialize(data) });
    if (level === "error" || level === "warn") {
        console.error(line);
    }
    else {
        console.log(line);
    }
}
/** Structured (JSON line) logger. `LOG_LEVEL=silent` disables output. */
exports.logger = {
    debug: (event, data) => write("debug", event, data),
    info: (event, data) => write("info", event, data),
    warn: (event, data) => write("warn", event, data),
    error: (event, data) => write("error", event, data),
};
//# sourceMappingURL=logger.js.map