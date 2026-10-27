"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.roll = roll;
exports.rollRange = rollRange;
/** `percent` in 0..100. Rolls nothing at 0 % or 100 %, so a fixed test rng isn't consumed by certain outcomes. */
function roll(rng, percent) {
    if (percent <= 0)
        return false;
    if (percent >= 100)
        return true;
    return rng.int(100) < percent;
}
/** Integer in [min, max]. */
function rollRange(rng, min, max) {
    return max <= min ? min : min + rng.int(max - min + 1);
}
//# sourceMappingURL=rng.js.map