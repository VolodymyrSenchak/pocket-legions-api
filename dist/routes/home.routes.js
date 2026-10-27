"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useHomeRoutes = useHomeRoutes;
const express_1 = require("express");
function useHomeRoutes() {
    const router = (0, express_1.Router)();
    router.get("/", (_req, res) => {
        res.status(200).json({ message: "Welcome to the API" });
    });
    return router;
}
//# sourceMappingURL=home.routes.js.map