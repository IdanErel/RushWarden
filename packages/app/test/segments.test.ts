import { describe, expect, it } from 'vitest';
import { emptyMap } from '@rushwarden/sim';
import { reverseSegment, segmentAt, segmentRuns } from '../src/index.js';

describe('segment targets (ADR-031)', () => {
  const map = emptyMap();

  it('turns a tile into the straight run of non-intersection road tiles through it', () => {
    expect(segmentAt(map, 3, 1)).toEqual({
      kind: 'segment',
      from: { x: 3, y: 0 },
      to: { x: 3, y: 3 },
    });
    expect(segmentAt(map, 5, 4)).toEqual({
      kind: 'segment',
      from: { x: 4, y: 4 },
      to: { x: 6, y: 4 },
    });
  });

  it('lists every run once, in a fixed order, and every road tile lies on one', () => {
    const runs = segmentRuns(map);
    expect(runs).toEqual([
      { kind: 'segment', from: { x: 3, y: 0 }, to: { x: 3, y: 3 } },
      { kind: 'segment', from: { x: 0, y: 4 }, to: { x: 2, y: 4 } },
      { kind: 'segment', from: { x: 4, y: 4 }, to: { x: 6, y: 4 } },
      { kind: 'segment', from: { x: 3, y: 5 }, to: { x: 3, y: 8 } },
    ]);
    expect(segmentRuns(map)).toEqual(runs);
  });

  it('reverses a segment', () => {
    expect(reverseSegment({ kind: 'segment', from: { x: 0, y: 4 }, to: { x: 2, y: 4 } })).toEqual({
      kind: 'segment',
      from: { x: 2, y: 4 },
      to: { x: 0, y: 4 },
    });
  });
});
