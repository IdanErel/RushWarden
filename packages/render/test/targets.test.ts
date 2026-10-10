import { describe, expect, it } from 'vitest';
import { emptyMap } from '@rushwarden/sim';
import { fitGrid } from '../src/geometry.js';
import {
  hitTarget,
  moveCursor,
  rectToPx,
  targetKey,
  targetTileRect,
  tileFromPoint,
  type TargetMark,
} from '../src/targets.js';

const map = emptyMap();
const X: TargetMark = { kind: 'intersection', x: 3, y: 4 };
const segs: TargetMark[] = [
  { kind: 'segment', x: 3, y: 1 }, // north
  { kind: 'segment', x: 5, y: 4 }, // east
  { kind: 'segment', x: 3, y: 7 }, // south
  { kind: 'segment', x: 1, y: 4 }, // west
];

describe('targets', () => {
  it('keys targets stably', () => {
    expect(targetKey(X)).toBe('intersection:3,4');
    expect(targetKey({ kind: 'edge', edge: 2 })).toBe('edge:2');
    expect(targetKey({ kind: 'district' })).toBe('district');
  });

  it('maps targets to tile rects and px', () => {
    expect(targetTileRect(X, map)).toEqual({ x: 3, y: 4, w: 1, h: 1 });
    expect(targetTileRect({ kind: 'edge', edge: 1 }, map)).toEqual({ x: 6, y: 4, w: 1, h: 1 });
    expect(targetTileRect({ kind: 'edge', edge: 9 }, map)).toBeNull();
    expect(targetTileRect({ kind: 'district' }, map)).toEqual({ x: 0, y: 0, w: 7, h: 9 });
    const fit = fitGrid(390, 600, 6);
    expect(rectToPx({ x: 1, y: 2, w: 1, h: 1 }, fit)).toEqual({
      x: fit.originX + 54,
      y: fit.originY + 108,
      w: 54,
      h: 54,
    });
  });

  it('finds the tile under a point', () => {
    const fit = fitGrid(390, 600, 6);
    expect(tileFromPoint(fit.originX + 3.5 * 54, fit.originY + 4.2 * 54, fit)).toEqual({
      x: 3,
      y: 4,
    });
    expect(tileFromPoint(0, 0, fit)).toBeNull();
    expect(tileFromPoint(fit.originX + 7 * 54 + 1, fit.originY, fit)).toBeNull();
  });

  it('resolves taps: exact tile, then edge tile, then district', () => {
    expect(hitTarget([...segs, X], { x: 3, y: 4 }, map)).toBe(4);
    expect(hitTarget([{ kind: 'edge', edge: 0 }], { x: 3, y: 0 }, map)).toBe(0);
    expect(hitTarget([X, { kind: 'district' }], { x: 0, y: 0 }, map)).toBe(1);
    expect(hitTarget([X], null, map)).toBe(-1);
  });

  it('moves the keyboard cursor spatially', () => {
    const all = [X, ...segs];
    expect(moveCursor(all, null, 'n', map)).toBe(0);
    expect(moveCursor(all, 0, 'n', map)).toBe(1);
    expect(moveCursor(all, 0, 'e', map)).toBe(2);
    expect(moveCursor(all, 0, 's', map)).toBe(3);
    expect(moveCursor(all, 0, 'w', map)).toBe(4);
    // Nothing further north of the north segment: stay.
    expect(moveCursor(all, 1, 'n', map)).toBe(1);
    // Outside the cone, the half-plane still finds one.
    expect(moveCursor([segs[0]!, segs[1]!], 0, 's', map)).toBe(1);
    expect(moveCursor([], 0, 'n', map)).toBeNull();
    expect(moveCursor(all, 99, 'n', map)).toBe(0);
  });
});
