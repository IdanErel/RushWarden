/**
 * Integer helpers. This is the only file in packages/sim allowed to use `/`
 * (enforced by ESLint). Every quantity in the sim is an integer; results here are too.
 */

/** Integer division truncated toward zero, like C. Throws on division by zero. */
export function idiv(a: number, b: number): number {
  if (b === 0) throw new RangeError('idiv: division by zero');
  return Math.trunc(a / b);
}

/** Integer modulo that is always non-negative for positive `b`. */
export function imod(a: number, b: number): number {
  if (b === 0) throw new RangeError('imod: division by zero');
  const r = a % b;
  return r < 0 ? r + b : r;
}

/** Applies a percentage to an integer, truncating: `pct(250, 40) === 100`. */
export function pct(value: number, percent: number): number {
  return idiv(value * percent, 100);
}

/** Clamps an integer into [lo, hi]. */
export function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}
