"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useRoutes = useRoutes;
const home_routes_1 = require("./home.routes");
const auth_routes_1 = require("./auth.routes");
const session_routes_1 = require("./session.routes");
function useRoutes(app, deps, options = {}) {
    app.use("/api", (0, home_routes_1.useHomeRoutes)());
    app.use("/api/auth", (0, auth_routes_1.useAuthRoutes)());
    app.use("/api/sessions", (0, session_routes_1.useSessionRoutes)(deps.sessionService, options));
}
//# sourceMappingURL=index.js.map