/**
 * Randomness source. Structurally the same as the server's `Rng` (utils/random.ts), so `ctx.rng`
 * passes straight in; the engine never creates randomness of its own.
 */
export interface Rng {
  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
}

/** `percent` in 0..100. Rolls nothing at 0 % or 100 %, so a fixed test rng isn't consumed by certain outcomes. */
export function roll(rng: Rng, percent: number): boolean {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  return rng.int(100) < percent;
}

/** Integer in [min, max]. */
export function rollRange(rng: Rng, min: number, max: number): number {
  return max <= min ? min : min + rng.int(max - min + 1);
}
