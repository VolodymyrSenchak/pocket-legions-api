import { randomInt } from "node:crypto";

/** Randomness source, injectable so game logic can be tested deterministically. */
export interface Rng {
  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
}

function pickWith<T>(int: (max: number) => number, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error("Cannot pick from an empty list");
  }
  return items[int(items.length)];
}

export const cryptoRng: Rng = {
  int: (maxExclusive) => randomInt(0, maxExclusive),
  pick: (items) => pickWith((max) => randomInt(0, max), items),
};

/** Deterministic PRNG (mulberry32) for tests. */
export function createSeededRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (maxExclusive: number) => Math.floor(next() * maxExclusive);
  return { int, pick: (items) => pickWith(int, items) };
}

/** Used where randomness must not happen (e.g. projections). */
export const forbiddenRng: Rng = {
  int: () => {
    throw new Error("Randomness is not allowed here");
  },
  pick: () => {
    throw new Error("Randomness is not allowed here");
  },
};
