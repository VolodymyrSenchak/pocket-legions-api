"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatePlayerToken = generatePlayerToken;
exports.sha256 = sha256;
exports.createPlayerIdentity = createPlayerIdentity;
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
const node_crypto_1 = require("node:crypto");
const node_util_1 = require("node:util");
const scryptAsync = (0, node_util_1.promisify)(node_crypto_1.scrypt);
const SCRYPT_KEY_LENGTH = 32;
function generatePlayerToken() {
    return (0, node_crypto_1.randomBytes)(32).toString("base64url");
}
function sha256(value) {
    return (0, node_crypto_1.createHash)("sha256").update(value).digest("hex");
}
function createPlayerIdentity() {
    const token = generatePlayerToken();
    return { playerId: (0, node_crypto_1.randomUUID)(), token, tokenHash: sha256(token) };
}
/** Format: `scrypt$<salt base64url>$<key base64url>` */
async function hashPassword(password) {
    const salt = (0, node_crypto_1.randomBytes)(16);
    const key = await scryptAsync(password, salt, SCRYPT_KEY_LENGTH);
    return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}
async function verifyPassword(password, stored) {
    const [algorithm, saltPart, keyPart] = stored.split("$");
    if (algorithm !== "scrypt" || !saltPart || !keyPart) {
        return false;
    }
    const expected = Buffer.from(keyPart, "base64url");
    const actual = await scryptAsync(password, Buffer.from(saltPart, "base64url"), expected.length);
    return actual.length === expected.length && (0, node_crypto_1.timingSafeEqual)(actual, expected);
}
//# sourceMappingURL=crypto.js.map