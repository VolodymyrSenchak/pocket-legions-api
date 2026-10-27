"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENV_VARIABLES = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = __importDefault(require("fs"));
// Load .env.local if it exists, otherwise fallback to .env
if (fs_1.default.existsSync(".env.local")) {
    dotenv_1.default.config({ path: ".env.local" });
}
else {
    dotenv_1.default.config();
}
exports.ENV_VARIABLES = {
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 8080,
};
//# sourceMappingURL=envVariables.js.map