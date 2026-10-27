"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const auth_service_1 = require("./auth.service");
// Session/game services share per-instance realtime state, so they are wired in src/runtime.ts instead.
class ServiceFactory {
    container = new Map();
    constructor() {
        this.container.set(auth_service_1.AuthService, () => new auth_service_1.AuthService());
    }
    getService(service) {
        const serviceFactory = this.container.get(service);
        if (!serviceFactory) {
            throw new Error(`Service ${service.name} is not registered in the container.`);
        }
        return serviceFactory();
    }
}
exports.default = new ServiceFactory();
//# sourceMappingURL=serviceFactory.js.map