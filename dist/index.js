"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_http_1 = __importDefault(require("node:http"));
const envVariables_1 = require("./utils/envVariables");
const runtime_1 = require("./runtime");
const runtime = (0, runtime_1.createSupabaseRuntime)();
const server = node_http_1.default.createServer(runtime.app);
runtime.attachRealtime(server);
// On Vercel the platform owns the listener; the exported server is the entry.
if (!process.env.VERCEL) {
    server
        .listen(envVariables_1.ENV_VARIABLES.port, "localhost", function () {
        console.log(`Server is running on port ${envVariables_1.ENV_VARIABLES.port}.`);
    })
        .on("error", (err) => {
        if (err.code === "EADDRINUSE") {
            console.log("Error: address already in use");
        }
        else {
            console.log(err);
        }
    });
}
exports.default = server;
//# sourceMappingURL=index.js.map