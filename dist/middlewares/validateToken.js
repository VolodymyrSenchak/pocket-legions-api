"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateToken = void 0;
const serviceFactory_1 = __importDefault(require("../services/serviceFactory"));
const auth_service_1 = require("../services/auth.service");
const requestUtils_1 = require("../utils/requestUtils");
const validateToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    const token = authHeader.split(" ")[1];
    const authService = serviceFactory_1.default.getService(auth_service_1.AuthService);
    const userOperation = await authService.getUser(token);
    if (!userOperation.isSuccess) {
        return res.status(401).json({ error: "Invalid token" });
    }
    else {
        (0, requestUtils_1.setReqContext)(req, { user: userOperation.result });
    }
    next();
};
exports.validateToken = validateToken;
//# sourceMappingURL=validateToken.js.map