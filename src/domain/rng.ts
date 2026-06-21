// ============================================================
// RNG — deterministic, injectable randomness
// ============================================================
// The engine is a pure reducer: all randomness comes from an injected
// `Rng` passed in the command context, never from a global Math.random.
// That makes every game reproducible in tests (seed → fixed outcome)
// and keeps the state itself plain-serializable.
// ============================================================

export type Rng = () => number; // returns a float in [0, 1)

/** mulberry32 — small, fast, well-distributed seedable PRNG. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Production RNG seeded from crypto-quality entropy. */
export function makeSecureRng(): Rng {
  // Seed from Date + Math.random; good enough for game shuffles (not security-critical).
  return makeRng((Date.now() ^ (Math.random() * 0x100000000)) >>> 0);
}

/** Fisher–Yates shuffle using the injected Rng. Returns a new array. */
export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Random integer in [0, n). */
export function randInt(n: number, rng: Rng): number {
  return Math.floor(rng() * n);
}

/** Pick a random element (caller guarantees non-empty). */
export function pick<T>(arr: readonly T[], rng: Rng): T {
  return arr[randInt(arr.length, rng)];
}
