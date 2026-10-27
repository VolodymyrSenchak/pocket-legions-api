import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keyLength: number) => Promise<Buffer>;
const SCRYPT_KEY_LENGTH = 32;

export function generatePlayerToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createPlayerIdentity(): { playerId: string; token: string; tokenHash: string } {
  const token = generatePlayerToken();
  return { playerId: randomUUID(), token, tokenHash: sha256(token) };
}

/** Format: `scrypt$<salt base64url>$<key base64url>` */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT_KEY_LENGTH);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, saltPart, keyPart] = stored.split("$");
  if (algorithm !== "scrypt" || !saltPart || !keyPart) {
    return false;
  }
  const expected = Buffer.from(keyPart, "base64url");
  const actual = await scryptAsync(password, Buffer.from(saltPart, "base64url"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
