"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const routes_1 = require("./routes");
const corsUtils_1 = require("./utils/corsUtils");
const errorHandler_1 = require("./middlewares/errorHandler");
function createApp(deps, options = {}) {
    const app = (0, express_1.default)();
    if (process.env.VERCEL) {
        // one proxy hop, so rate limits key on the client IP
        app.set("trust proxy", 1);
    }
    app.use((0, cors_1.default)((0, corsUtils_1.getCorsOptions)()));
    app.use(express_1.default.json({ limit: "32kb" }));
    app.use(express_1.default.urlencoded({ extended: true, limit: "32kb" }));
    (0, routes_1.useRoutes)(app, deps, options);
    app.use(errorHandler_1.errorHandler);
    return app;
}
//# sourceMappingURL=app.js.map