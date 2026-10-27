"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defineGameAction = defineGameAction;
/** Binds a payload schema to a handler that receives the parsed payload type. */
function defineGameAction(schema, handle) {
    return { schema, handle: (ctx, state, payload) => handle(ctx, state, payload) };
}
//# sourceMappingURL=gameModule.js.map