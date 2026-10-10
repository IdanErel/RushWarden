import { describe, expect, it } from 'vitest';
import { chancePermille, clonePrng, createPrng, nextInt, nextU32 } from '../src/prng.js';

describe('xoshiro128**', () => {
  it('matches the reference output for state [1, 2, 3, 4]', () => {
    const p = { s: new Uint32Array([1, 2, 3, 4]) };
    expect([nextU32(p), nextU32(p), nextU32(p), nextU32(p)]).toEqual([11520, 0, 5927040, 70819200]);
  });

  it('is reproducible from a seed and differs across seeds', () => {
    const a = createPrng(42);
    const b = createPrng(42);
    const c = createPrng(43);
    const sa = Array.from({ length: 8 }, () => nextU32(a));
    expect(Array.from({ length: 8 }, () => nextU32(b))).toEqual(sa);
    expect(Array.from({ length: 8 }, () => nextU32(c))).not.toEqual(sa);
  });

  it('clones without sharing state', () => {
    const a = createPrng(7);
    const b = clonePrng(a);
    nextU32(a);
    expect(b.s).not.toEqual(a.s);
  });

  it('never starts from the all-zero state', () => {
    for (let seed = 0; seed < 64; seed++) {
      const s = createPrng(seed).s;
      expect(s[0]! | s[1]! | s[2]! | s[3]!).not.toBe(0);
    }
  });

  it('nextInt stays in range and rejects bad bounds', () => {
    const p = createPrng(1);
    for (let i = 0; i < 1000; i++) {
      const v = nextInt(p, 6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
    expect(nextInt(p, 1)).toBe(0);
    expect(() => nextInt(p, 0)).toThrow(RangeError);
    expect(() => nextInt(p, 2.5)).toThrow(RangeError);
  });

  it('chancePermille handles the edges and is roughly calibrated', () => {
    const p = createPrng(9);
    expect(chancePermille(p, 0)).toBe(false);
    expect(chancePermille(p, 1000)).toBe(true);
    let hits = 0;
    for (let i = 0; i < 10000; i++) if (chancePermille(p, 100)) hits++;
    expect(hits).toBeGreaterThan(850);
    expect(hits).toBeLessThan(1150);
  });
});
