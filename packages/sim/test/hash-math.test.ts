import { describe, expect, it } from 'vitest';
import { Hasher, hashValue } from '../src/hash.js';
import { clamp, idiv, imod, pct } from '../src/math.js';

describe('Hasher', () => {
  it('produces 16 hex characters and is stable', () => {
    const d = new Hasher().int(1).str('ab').bool(true).ints([1, 2]).digest();
    expect(d).toMatch(/^[0-9a-f]{16}$/);
    expect(new Hasher().int(1).str('ab').bool(true).ints([1, 2]).digest()).toBe(d);
  });

  it('is sensitive to order and boundaries', () => {
    expect(new Hasher().str('ab').str('c').digest()).not.toBe(
      new Hasher().str('a').str('bc').digest(),
    );
    expect(new Hasher().int(1).int(2).digest()).not.toBe(new Hasher().int(2).int(1).digest());
  });

  it('hashValue ignores key order and rejects floats', () => {
    const a = hashValue(new Hasher(), { x: 1, y: [true, 'z', null] }).digest();
    const b = hashValue(new Hasher(), { y: [true, 'z', undefined], x: 1 }).digest();
    expect(a).toBe(b);
    expect(hashValue(new Hasher(), new Uint16Array([1, 2])).digest()).toBe(
      hashValue(new Hasher(), [1, 2]).digest(),
    );
    expect(() => hashValue(new Hasher(), { x: 0.5 })).toThrow(TypeError);
    expect(() => hashValue(new Hasher(), () => 1)).toThrow(TypeError);
  });
});

describe('integer math', () => {
  it('idiv truncates toward zero and rejects zero', () => {
    expect(idiv(7, 2)).toBe(3);
    expect(idiv(-7, 2)).toBe(-3);
    expect(() => idiv(1, 0)).toThrow(RangeError);
  });
  it('imod is non-negative', () => {
    expect(imod(-1, 4)).toBe(3);
    expect(imod(5, 4)).toBe(1);
    expect(() => imod(1, 0)).toThrow(RangeError);
  });
  it('pct and clamp', () => {
    expect(pct(250, 40)).toBe(100);
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});
