"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCorsOptions = exports.corsOrigin = exports.CORS_ERROR_MESSAGE = void 0;
exports.CORS_ERROR_MESSAGE = "Not allowed by CORS";
/** Allowed browser origins come only from the `CORS_ORIGINS` env (comma-separated); requests without an Origin always pass. */
function getAllowedOrigins() {
    return (process.env.CORS_ORIGINS ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
}
const corsOrigin = (origin, callback) => {
    if (!origin || getAllowedOrigins().includes(origin)) {
        callback(null, true); // Allow the request
    }
    else {
        callback(new Error(exports.CORS_ERROR_MESSAGE)); // Block the request
    }
};
exports.corsOrigin = corsOrigin;
const getCorsOptions = () => ({
    origin: exports.corsOrigin,
    // the polling fallback reads the ETag to send If-None-Match
    exposedHeaders: ["ETag"],
});
exports.getCorsOptions = getCorsOptions;
//# sourceMappingURL=corsUtils.js.map