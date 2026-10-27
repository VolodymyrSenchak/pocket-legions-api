"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.useAuthRoutes = void 0;
const express_1 = require("express");
const serviceFactory_1 = __importDefault(require("../services/serviceFactory"));
const auth_service_1 = require("../services/auth.service");
const models_1 = require("../models");
const requestUtils_1 = require("../utils/requestUtils");
const validateToken_1 = require("../middlewares/validateToken");
const useAuthRoutes = () => {
    const router = (0, express_1.Router)();
    const authSrv = () => serviceFactory_1.default.getService(auth_service_1.AuthService);
    router.post("/login", async (req, res) => {
        const result = await authSrv().login(req.body);
        (0, requestUtils_1.setResResult)(res, result, null, 401);
    });
    router.post("/google", async (req, res) => {
        const { idToken, nonce, accessToken } = req.body;
        if (!idToken) {
            (0, requestUtils_1.setResResult)(res, (0, models_1.failure)("idToken is required", "bad-request"));
            return;
        }
        const result = await authSrv().loginWithGoogle({ idToken, nonce, accessToken });
        (0, requestUtils_1.setResResult)(res, result, null, 401);
    });
    router.post("/refreshToken", async (req, res) => {
        const { refreshToken } = req.body;
        const result = await authSrv().refreshToken(refreshToken);
        (0, requestUtils_1.setResResult)(res, result, null, 401);
    });
    router.post("/register", async (req, res) => {
        const result = await authSrv().register(req.body);
        (0, requestUtils_1.setResResult)(res, result);
    });
    router.get("/userDetails", validateToken_1.validateToken, (req, res) => {
        const user = (0, requestUtils_1.getReqContext)(req).user;
        res.status(200).json(user);
    });
    router.post("/resetPassword", async (req, res) => {
        const result = await authSrv().resetPassword(req.body);
        (0, requestUtils_1.setResResult)(res, result);
    });
    router.post("/changePassword", validateToken_1.validateToken, async (req, res) => {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            (0, requestUtils_1.setResResult)(res, (0, models_1.failure)("currentPassword and newPassword are required", "bad-request"));
            return;
        }
        const user = (0, requestUtils_1.getReqContext)(req).user;
        const result = await authSrv().changePassword({
            userId: (0, requestUtils_1.getUserId)(req),
            email: user.email,
            currentPassword,
            newPassword,
        });
        (0, requestUtils_1.setResResult)(res, result);
    });
    router.post("/changePasswordForgotten", validateToken_1.validateToken, async (req, res) => {
        const { newPassword } = req.body;
        if (!newPassword) {
            (0, requestUtils_1.setResResult)(res, (0, models_1.failure)("newPassword is required", "bad-request"));
            return;
        }
        const result = await authSrv().changePasswordForgotten({
            userId: (0, requestUtils_1.getUserId)(req),
            newPassword,
        });
        (0, requestUtils_1.setResResult)(res, result);
    });
    return router;
};
exports.useAuthRoutes = useAuthRoutes;
//# sourceMappingURL=auth.routes.js.map