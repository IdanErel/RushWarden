import { describe, expect, it } from 'vitest';
import { CELLS_PER_TILE, VehicleType, type ControllerKind } from '@rushwarden/sim';
import { LANE_WIDTH, fitGrid } from '../src/geometry.js';
import { OLD_TOWN, contrast, luminance } from '../src/palette.js';
import {
  VEHICLE_LENGTH,
  chevronPoints,
  controllerShapes,
  octagonPoints,
  vehicleCellShapes,
  vehicleOutline,
  vehicleShapes,
  type Shape,
} from '../src/shapes.js';
import { HEAT_GUTTER_PX } from '../src/effects.js';

function bounds(shapes: Shape[]): { x0: number; x1: number; y0: number; y1: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const s of shapes) {
    const pts: [number, number][] =
      s.kind === 'rect'
        ? [
            [s.x, s.y],
            [s.x + s.w, s.y + s.h],
          ]
        : s.kind === 'circle'
          ? [
              [s.x - s.r, s.y - s.r],
              [s.x + s.r, s.y + s.r],
            ]
          : s.points.reduce<[number, number][]>((a, v, i) => {
              if (i % 2 === 0) a.push([v, s.points[i + 1]!]);
              return a;
            }, []);
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  return { x0, x1, y0, y1 };
}

const TYPES = Object.values(VehicleType);
const lane = LANE_WIDTH * CELLS_PER_TILE;

describe('vehicle shapes (GDD §7)', () => {
  it.each(TYPES)('type %i fits its length and its lane', (t) => {
    const b = bounds(vehicleShapes(t));
    const len = VEHICLE_LENGTH[t];
    expect(b.x1).toBeLessThanOrEqual(0.5);
    expect(b.x0).toBeGreaterThanOrEqual(-(len - 1) - 0.5);
    expect(b.y1 - b.y0).toBeLessThan(lane);
  });

  it('sizes vehicles by length: bike ≤ car < bus < truck', () => {
    const span = (t: number): number => {
      const b = bounds(vehicleShapes(t));
      return b.x1 - b.x0;
    };
    expect(span(VehicleType.Bike)).toBeLessThanOrEqual(span(VehicleType.Car));
    expect(span(VehicleType.Car)).toBeLessThan(span(VehicleType.Bus));
    expect(span(VehicleType.Bus)).toBeLessThan(span(VehicleType.Truck));
  });

  it('draws a car at least 12 px long on a 390 px wide phone', () => {
    // The scene keeps a heat-strip gutter (HEAT_GUTTER_PX) around the grid.
    const cellPx = fitGrid(390, 600, HEAT_GUTTER_PX).tilePx / CELLS_PER_TILE;
    const b = bounds(vehicleShapes(VehicleType.Car));
    expect((b.x1 - b.x0) * cellPx).toBeGreaterThanOrEqual(12);
  });

  it('tells every type apart by shape alone, ignoring colour (§7)', () => {
    const r = (n: number): string => n.toFixed(2);
    const sig = (t: number): string =>
      vehicleShapes(t)
        .map((s) => {
          switch (s.kind) {
            case 'rect':
              return `rect:${r(s.x)},${r(s.y)},${r(s.w)},${r(s.h)}`;
            case 'circle':
              return `circle:${r(s.x)},${r(s.y)},${r(s.r)}`;
            case 'poly':
              return `poly:${s.points.map(r).join(',')}`;
          }
        })
        .join('|');
    expect(new Set(TYPES.map(sig)).size).toBe(TYPES.length);
  });

  it('blinks the emergency beacon between two frames', () => {
    expect(vehicleShapes(VehicleType.Emergency, 0)).not.toEqual(
      vehicleShapes(VehicleType.Emergency, 1),
    );
    expect(vehicleShapes(VehicleType.Car, 0)).toEqual(vehicleShapes(VehicleType.Car, 1));
  });

  it('draws long vehicles one cell at a time, each inside its own cell', () => {
    for (const t of TYPES) {
      const len = VEHICLE_LENGTH[t];
      if (len === 1) {
        expect(vehicleCellShapes(t, 0)).toEqual(vehicleShapes(t));
        continue;
      }
      for (let c = 0; c < len; c++) {
        const b = bounds(vehicleCellShapes(t, c));
        // Inside the cell, with a bumper gap at each end so neighbours never overlap on a bend.
        expect(b.x0).toBeGreaterThanOrEqual(-0.5);
        expect(b.x1).toBeLessThanOrEqual(0.5);
        expect(b.x1 - b.x0).toBeGreaterThan(0.8);
        expect(Math.max(-b.y0, b.y1)).toBeLessThanOrEqual(lane / 2);
      }
    }
    // The truck's cab is its head cell; the bus has a window in each cell.
    const fills = (t: number, c: number) => vehicleCellShapes(t, c).map((x) => x.fill);
    expect(fills(VehicleType.Truck, 0)).toContain('truckCab');
    expect(fills(VehicleType.Truck, 1)).toEqual(['truckBox']);
    expect(fills(VehicleType.Bus, 0)).toContain('busWindow');
    expect(fills(VehicleType.Bus, 1)).toContain('busWindow');
  });

  it('falls back to a car for unknown types', () => {
    expect(vehicleShapes(99)).toEqual(vehicleShapes(VehicleType.Car));
  });

  it('keeps every vehicle body at WCAG AA graphics contrast (3:1) against the road', () => {
    for (const t of TYPES) {
      const first = vehicleShapes(t).find((s) => s.fill)!;
      expect(contrast(OLD_TOWN[first.fill!], OLD_TOWN.road)).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(OLD_TOWN.glyph, OLD_TOWN.intersection)).toBeGreaterThanOrEqual(3);
    expect(luminance(0xffffff)).toBeCloseTo(1);
    expect(contrast(0, 0xffffff)).toBeCloseTo(21);
  });
});

describe('controller glyphs (GDD §7)', () => {
  it('signal = three dots, roundabout = ring, stop = octagon, priority = chevron', () => {
    const sig = controllerShapes('signal');
    expect(sig.filter((s) => s.kind === 'circle')).toHaveLength(3);
    const ring = controllerShapes('roundabout');
    expect(ring).toEqual([expect.objectContaining({ kind: 'circle', stroke: 'glyph' })]);
    expect(ring[0]!.fill).toBeUndefined();
    const stop = controllerShapes('stop-all');
    expect(stop[0]!.kind === 'poly' && stop[0]!.points.length).toBe(16);
    expect(controllerShapes('priority', 'e')[0]!.kind).toBe('poly');
    expect(controllerShapes('uncontrolled')).toEqual([]);
  });

  it.each(['signal', 'roundabout', 'stop-all', 'priority'] as ControllerKind[])(
    '%s fits its box',
    (k) => {
      const b = bounds(controllerShapes(k));
      expect(Math.max(-b.x0, b.x1, -b.y0, b.y1)).toBeLessThanOrEqual(0.5);
    },
  );

  it('points the priority chevron at its direction', () => {
    const tip = (pts: number[], ax: 0 | 1, sign: 1 | -1): number =>
      Math.max(...pts.filter((_, i) => i % 2 === ax).map((v) => v * sign));
    for (const [dir, ax, sign] of [
      ['e', 0, 1],
      ['w', 0, -1],
      ['s', 1, 1],
      ['n', 1, -1],
    ] as const) {
      const pts = chevronPoints(dir, 1);
      // The tip is the extreme point in the pointing direction, shared by both arms, at the
      // centre of the cross axis.
      const t = tip(pts, ax, sign);
      expect(t).toBeCloseTo(0.3);
      const at = pts.flatMap((v, i) =>
        i % 2 === ax && Math.abs(v * sign - t) < 1e-9 ? [pts[i + (ax === 0 ? 1 : -1)]!] : [],
      );
      expect(at.map((v) => Math.abs(v))).toEqual([0]);
    }
  });

  it('draws every polygon glyph as a simple polygon with area', () => {
    const polys = [
      octagonPoints(0.4),
      ...(['n', 'e', 's', 'w'] as const).map((d) => chevronPoints(d, 0.8)),
    ];
    for (const pts of polys) {
      const n = pts.length / 2;
      const P = (i: number): [number, number] => [pts[(i % n) * 2]!, pts[(i % n) * 2 + 1]!];
      let area = 0;
      for (let i = 0; i < n; i++) area += P(i)[0] * P(i + 1)[1] - P(i + 1)[0] * P(i)[1];
      expect(Math.abs(area) / 2).toBeGreaterThan(0.05);
      // No two non-adjacent edges cross.
      const cross = (a: [number, number], b: [number, number], c: [number, number]): number =>
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      for (let i = 0; i < n; i++)
        for (let j = i + 2; j < n; j++) {
          if (i === 0 && j === n - 1) continue;
          const [a, b, c, d] = [P(i), P(i + 1), P(j), P(j + 1)];
          const hit =
            cross(a, b, c) * cross(a, b, d) < -1e-12 && cross(c, d, a) * cross(c, d, b) < -1e-12;
          expect(hit).toBe(false);
        }
    }
  });

  it('builds a regular octagon', () => {
    const pts = octagonPoints(1);
    for (let i = 0; i < 16; i += 2) expect(Math.hypot(pts[i]!, pts[i + 1]!)).toBeCloseTo(1);
  });
});

describe('queue pulse outline', () => {
  it.each(TYPES)('surrounds the body of type %i without leaving its lane', (t) => {
    const body = bounds(vehicleShapes(t));
    const ring = bounds(vehicleOutline(t));
    expect(ring.x0).toBeLessThan(body.x0);
    expect(ring.x1).toBeGreaterThan(body.x1);
    expect(ring.y1 - ring.y0).toBeLessThan(lane);
    expect(vehicleOutline(t)[0]!.fill).toBeUndefined();
  });
});
