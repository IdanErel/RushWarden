/**
 * 64-bit state hash (GDD section 3: RoundResult carries "a 64-bit hash of the final state").
 * Two independent 32-bit lanes of a murmur3-style mix, rendered as 16 lowercase hex characters.
 * Integer-only and identical on every JS engine.
 */
export class Hasher {
  private h1 = 0x8badf00d;
  private h2 = 0x1b873593;

  /** Feeds one integer (taken as int32; callers keep values inside that range). */
  int(n: number): this {
    const k = n | 0;
    let k1 = Math.imul(k, 0xcc9e2d51);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, 0x1b873593);
    this.h1 ^= k1;
    this.h1 = (this.h1 << 13) | (this.h1 >>> 19);
    this.h1 = (Math.imul(this.h1, 5) + 0xe6546b64) | 0;

    let k2 = Math.imul(k ^ 0x5bd1e995, 0x85ebca6b);
    k2 = (k2 << 17) | (k2 >>> 15);
    k2 = Math.imul(k2, 0xc2b2ae35);
    this.h2 ^= k2;
    this.h2 = (this.h2 << 11) | (this.h2 >>> 21);
    this.h2 = (Math.imul(this.h2, 9) + 0x38b34ae5) | 0;
    return this;
  }

  /** Feeds a string by UTF-16 code units, length-prefixed so "ab"+"c" differs from "a"+"bc". */
  str(s: string): this {
    this.int(s.length);
    for (let i = 0; i < s.length; i++) this.int(s.charCodeAt(i));
    return this;
  }

  /** Feeds a boolean. */
  bool(b: boolean): this {
    return this.int(b ? 1 : 0);
  }

  /** Feeds every element of an integer array, length-prefixed. */
  ints(a: ArrayLike<number>): this {
    this.int(a.length);
    for (let i = 0; i < a.length; i++) this.int(a[i]!);
    return this;
  }

  /** Finalizes into 16 hex characters. The hasher can keep being fed afterwards. */
  digest(): string {
    const f = (h: number, len: number): number => {
      let x = h ^ len;
      x ^= x >>> 16;
      x = Math.imul(x, 0x85ebca6b);
      x ^= x >>> 13;
      x = Math.imul(x, 0xc2b2ae35);
      x ^= x >>> 16;
      return x >>> 0;
    };
    const a = f(this.h1, 0x9e37);
    const b = f(this.h2 ^ a, 0x79b9);
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  }
}

/**
 * Feeds an arbitrary JSON-like value with sorted object keys, so two structurally equal inputs
 * hash equally regardless of key order. Non-integer numbers are rejected: the sim is integer-only.
 */
export function hashValue(h: Hasher, v: unknown): Hasher {
  if (v === null || v === undefined) return h.int(0);
  switch (typeof v) {
    case 'number':
      if (!Number.isInteger(v)) throw new TypeError(`non-integer number in sim input: ${v}`);
      return h.int(1).int(v);
    case 'boolean':
      return h.int(2).bool(v);
    case 'string':
      return h.int(3).str(v);
    case 'object': {
      if (Array.isArray(v) || ArrayBuffer.isView(v)) {
        const arr = v as ArrayLike<unknown>;
        h.int(4).int(arr.length);
        for (let i = 0; i < arr.length; i++) hashValue(h, arr[i]);
        return h;
      }
      const keys = Object.keys(v as object).sort();
      h.int(5).int(keys.length);
      for (const k of keys) hashValue(h.str(k), (v as Record<string, unknown>)[k]);
      return h;
    }
    default:
      throw new TypeError(`unhashable value of type ${typeof v}`);
  }
}
