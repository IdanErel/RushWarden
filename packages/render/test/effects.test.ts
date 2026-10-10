import { describe, expect, it } from 'vitest';
import { GRID_HEIGHT, GRID_WIDTH, ROUND_TICKS, emptyMap, type MapEdge } from '@rushwarden/sim';
import {
  HEAT_BINS,
  HEAT_GUTTER_PX,
  HEAT_LEVELS,
  HEAT_STRIP_MIN_PX,
  PULSE_PERIOD_MS,
  SHAKE_MS,
  SHAKE_PX,
  demandBins,
  heatLevel,
  maxBin,
  pulseAlpha,
  shakeOffset,
  stripRect,
  TRAIL_HALF_WIDTH,
  trailAlpha,
  trailCells,
  trailPieces,
} from '../src/effects.js';
import { BODY_WIDTH } from '../src/shapes.js';
import { OLD_TOWN, luminance } from '../src/palette.js';
import { fitGrid } from '../src/geometry.js';

const normal = { reducedMotion: false };
const reduced = { reducedMotion: true };

describe('speed trails (GDD §7)', () => {
  it('are 1–3 cells long by speed and absent when stopped', () => {
    expect([0, 1, 2, 3, 4].map((v) => trailCells(v, normal))).toEqual([0, 1, 2, 3, 3]);
    expect(trailCells(Number.NaN, normal)).toBe(0);
  });

  it('are off under reduced motion (§8)', () => {
    expect(trailCells(3, reduced)).toBe(0);
  });

  it('fade out away from the vehicle', () => {
    const a = [0, 1, 2].map((i) => trailAlpha(i, 3));
    expect(a[0]).toBeGreaterThan(a[1]!);
    expect(a[1]).toBeGreaterThan(a[2]!);
    expect(a[2]).toBeGreaterThan(0);
    expect(trailAlpha(3, 3)).toBe(0);
    expect(trailAlpha(0, 0)).toBe(0);
  });

  it('read as one tapering streak, not as parked vehicles (#24 review note 2)', () => {
    for (const len of [1, 2, 3]) {
      for (const n of [1, 2, 3]) {
        const p = trailPieces(n, len);
        expect(p).toHaveLength(n);
        // Starts at the tail and runs backwards with no gaps between pieces.
        expect(p[0]!.a0).toBeCloseTo(-(len - 0.5));
        for (let i = 1; i < n; i++) {
          expect(p[i]!.a0).toBe(p[i - 1]!.a1);
          expect(p[i]!.h0).toBe(p[i - 1]!.h1);
        }
        // At most a third of the body wide, narrowing to a point.
        expect(p[0]!.h0 * 2).toBeLessThanOrEqual(BODY_WIDTH / 3 + 1e-9);
        for (const q of p) expect(q.h1).toBeLessThan(q.h0);
        expect(p[n - 1]!.h1).toBe(0);
      }
    }
    expect(TRAIL_HALF_WIDTH * 2).toBeLessThan(BODY_WIDTH);
    expect(trailPieces(0, 1)).toEqual([]);
  });
});

describe('queue pulse (GDD §7)', () => {
  it('pulses once per second', () => {
    const samples = Array.from({ length: 100 }, (_, i) => pulseAlpha(i * 20, normal));
    // Over 2 s: the pulse that starts at t=0, then exactly one more rising edge (at 1000 ms).
    let rises = 0;
    for (let i = 1; i < samples.length; i++) if (samples[i]! > samples[i - 1]!) rises++;
    expect(rises).toBe(1);
    expect(pulseAlpha(0, normal)).toBe(1);
    expect(pulseAlpha(PULSE_PERIOD_MS, normal)).toBe(1);
    expect(pulseAlpha(PULSE_PERIOD_MS / 2, normal)).toBe(0);
    expect(pulseAlpha(-10, normal)).toBe(0);
  });

  it('is a steady outline under reduced motion', () => {
    expect(pulseAlpha(0, reduced)).toBe(pulseAlpha(500, reduced));
    expect(pulseAlpha(0, reduced)).toBeGreaterThan(0);
  });
});

describe('gridlock shake (GDD §7)', () => {
  it('moves the camera at most 4 px and stops at 300 ms', () => {
    let peak = 0;
    for (let t = 0; t < SHAKE_MS; t += 5) {
      const [x, y] = shakeOffset(t, normal);
      peak = Math.max(peak, Math.abs(x), Math.abs(y));
    }
    expect(peak).toBeLessThanOrEqual(SHAKE_PX);
    expect(peak).toBeGreaterThan(SHAKE_PX / 2);
    expect(shakeOffset(SHAKE_MS, normal)).toEqual([0, 0]);
    expect(shakeOffset(-1, normal)).toEqual([0, 0]);
  });

  it('never shakes under reduced motion (§8)', () => {
    expect(shakeOffset(10, reduced)).toEqual([0, 0]);
  });
});

describe('demand heat-strips', () => {
  const map = emptyMap();

  it('bins spawns per edge per second', () => {
    const bins = demandBins(
      [
        { tick: 0, edge: 0, vehicleType: 0, destinationEdge: 2 },
        { tick: 19, edge: 0, vehicleType: 0, destinationEdge: 2 },
        { tick: 20, edge: 0, vehicleType: 0, destinationEdge: 2 },
        { tick: ROUND_TICKS - 1, edge: 3, vehicleType: 3, destinationEdge: 1 },
        { tick: 5, edge: 99, vehicleType: 0, destinationEdge: 1 }, // unknown edge: ignored
        { tick: ROUND_TICKS, edge: 1, vehicleType: 0, destinationEdge: 2 }, // out of range
      ],
      map.edges,
    );
    expect(HEAT_BINS).toBe(15);
    expect([...bins.get(0)!.slice(0, 2)]).toEqual([2, 1]);
    expect(bins.get(3)![14]).toBe(1);
    expect([...bins.get(1)!].every((v) => v === 0)).toBe(true);
    expect(maxBin(bins)).toBe(2);
  });

  it('quantises against the busiest second on the map', () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(10, 10)).toBe(HEAT_LEVELS);
    expect(heatLevel(6, 10)).toBe(3);
    expect(heatLevel(5, 0)).toBe(0);
  });

  it('uses a ramp that darkens with each level (readable without colour)', () => {
    const ramp = [OLD_TOWN.heat0, OLD_TOWN.heat1, OLD_TOWN.heat2, OLD_TOWN.heat3, OLD_TOWN.heat4];
    for (let i = 1; i < ramp.length; i++)
      expect(luminance(ramp[i]!)).toBeLessThan(luminance(ramp[i - 1]!) * 0.85);
  });

  it('places each strip in the gutter outside its edge, along the boundary', () => {
    const g = 0.1;
    const rects = map.edges.map((e: MapEdge) => [e.side, stripRect(e, GRID_WIDTH, GRID_HEIGHT, g)]);
    for (const [side, r] of rects as [string, ReturnType<typeof stripRect>][]) {
      const outside = r.y + r.h <= 0 || r.y >= GRID_HEIGHT || r.x + r.w <= 0 || r.x >= GRID_WIDTH;
      expect(outside).toBe(true);
      expect(r.horizontal).toBe(side === 'n' || side === 's');
      expect(Math.max(r.w, r.h)).toBeLessThanOrEqual(1);
      expect(Math.min(r.w, r.h)).toBeLessThanOrEqual(g);
    }
  });

  it('draws strips at least 6 px thick at the 390 px design width (ADR-015)', () => {
    const tilePx = fitGrid(390, 844 * 0.7, HEAT_GUTTER_PX).tilePx;
    for (const e of map.edges as MapEdge[]) {
      const r = stripRect(e, GRID_WIDTH, GRID_HEIGHT, HEAT_GUTTER_PX / tilePx);
      expect(Math.min(r.w, r.h) * tilePx).toBeGreaterThanOrEqual(HEAT_STRIP_MIN_PX - 1e-9);
      // ...and still inside the gutter, clear of the grid.
      const outside = r.y + r.h <= 0 || r.y >= GRID_HEIGHT || r.x + r.w <= 0 || r.x >= GRID_WIDTH;
      expect(outside).toBe(true);
    }
    expect(HEAT_STRIP_MIN_PX).toBe(6);
  });
});
