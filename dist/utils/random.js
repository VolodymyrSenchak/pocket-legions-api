"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.forbiddenRng = exports.cryptoRng = void 0;
exports.createSeededRng = createSeededRng;
const node_crypto_1 = require("node:crypto");
function pickWith(int, items) {
    if (items.length === 0) {
        throw new Error("Cannot pick from an empty list");
    }
    return items[int(items.length)];
}
exports.cryptoRng = {
    int: (maxExclusive) => (0, node_crypto_1.randomInt)(0, maxExclusive),
    pick: (items) => pickWith((max) => (0, node_crypto_1.randomInt)(0, max), items),
};
/** Deterministic PRNG (mulberry32) for tests. */
function createSeededRng(seed) {
    let a = seed >>> 0;
    const next = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (maxExclusive) => Math.floor(next() * maxExclusive);
    return { int, pick: (items) => pickWith(int, items) };
}
/** Used where randomness must not happen (e.g. projections). */
exports.forbiddenRng = {
    int: () => {
        throw new Error("Randomness is not allowed here");
    },
    pick: () => {
        throw new Error("Randomness is not allowed here");
    },
};
//# sourceMappingURL=random.js.map