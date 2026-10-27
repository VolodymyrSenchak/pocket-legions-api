import { Rng } from "./random";

const SESSION_CODE_PATTERN = /^[0-9]{6}$/;

/** 6 digits, leading zeros allowed ("004213"). */
export function generateSessionCode(rng: Rng): string {
  return String(rng.int(1_000_000)).padStart(6, "0");
}

export function isValidSessionCode(code: string): boolean {
  return SESSION_CODE_PATTERN.test(code);
}
