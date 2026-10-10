/**
 * xoshiro128** seeded PRNG (GDD section 3). The round owns one instance; nothing else in
 * packages/sim produces randomness. State is four uint32 words so it can be hashed and copied.
 */

export interface PrngState {
  readonly s: Uint32Array;
}

/** splitmix32, used only to expand a 32-bit seed into the four xoshiro words. */
function splitmix32(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** Creates a generator from a 32-bit integer seed. The same seed always yields the same stream. */
export function createPrng(seed: number): PrngState {
  const next = splitmix32(seed);
  const s = new Uint32Array(4);
  for (let i = 0; i < 4; i++) s[i] = next();
  // xoshiro must not start from the all-zero state.
  if ((s[0]! | s[1]! | s[2]! | s[3]!) === 0) s[0] = 1;
  return { s };
}

/** Copies a generator so a lookahead (for example a bot's preview) cannot advance the original. */
export function clonePrng(p: PrngState): PrngState {
  return { s: new Uint32Array(p.s) };
}

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

/** Next uint32 in [0, 2^32). */
export function nextU32(p: PrngState): number {
  const s = p.s;
  const result = Math.imul(rotl(Math.imul(s[1]!, 5) >>> 0, 7), 9) >>> 0;
  const t = (s[1]! << 9) >>> 0;
  s[2] = s[2]! ^ s[0]!;
  s[3] = s[3]! ^ s[1]!;
  s[1] = s[1]! ^ s[2]!;
  s[0] = s[0]! ^ s[3]!;
  s[2] = s[2]! ^ t;
  s[3] = rotl(s[3]!, 11);
  return result;
}

/**
 * Uniform integer in [0, bound) without modulo bias (rejection sampling).
 * `bound` must be an integer in [1, 2^32].
 */
export function nextInt(p: PrngState, bound: number): number {
  if (!Number.isInteger(bound) || bound < 1 || bound > 0x100000000) {
    throw new RangeError(`nextInt: bad bound ${bound}`);
  }
  const limit = 0x100000000 - (0x100000000 % bound);
  for (;;) {
    const r = nextU32(p);
    if (r < limit) return r % bound;
  }
}

/** True with probability `permille`/1000. Used for p_slow (GDD section 3, tick rule 3). */
export function chancePermille(p: PrngState, permille: number): boolean {
  if (permille <= 0) return false;
  if (permille >= 1000) return true;
  return nextInt(p, 1000) < permille;
}
