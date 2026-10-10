/**
 * The shape grammar (GDD §7) as plain data: every vehicle and controller glyph is a short list of
 * rectangles, circles and polygons coloured by palette token. The Pixi layer turns these into
 * shared GraphicsContexts; the card-glyph generator (P1-UI-02) and `/dev/style` reuse them.
 * Pure: no Pixi, no DOM.
 */
import { CELLS_PER_TILE, VehicleType, type ControllerKind, type Side } from '@rushwarden/sim';
import type { Palette } from './palette.js';
import { LANE_WIDTH } from './geometry.js';

export type Token = keyof Palette;

interface Paint {
  readonly fill?: Token;
  readonly stroke?: Token;
  /** Stroke width in the shape's own units. */
  readonly strokeWidth?: number;
}

export type Shape =
  | (Paint & {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly r: number;
    })
  | (Paint & {
      readonly kind: 'circle';
      readonly x: number;
      readonly y: number;
      readonly r: number;
    })
  | (Paint & { readonly kind: 'poly'; readonly points: readonly number[] });

// ---------------------------------------------------------------------------------------------
// Vehicles. Units: 1 = one cell length. +x is the direction of travel; the head cell's centre is
// the origin and longer vehicles extend backwards (towards −x).
// ---------------------------------------------------------------------------------------------

/** Length in cells per GDD §3. */
export const VEHICLE_LENGTH: Readonly<Record<VehicleType, number>> = {
  [VehicleType.Car]: 1,
  [VehicleType.Taxi]: 1,
  [VehicleType.Bus]: 2,
  [VehicleType.Truck]: 3,
  [VehicleType.Emergency]: 1,
  [VehicleType.Bike]: 1,
};

/** Lane width in cell units. */
const LANE = LANE_WIDTH * CELLS_PER_TILE;
/** Body width: 75% of the lane so neighbouring lanes never touch. */
export const BODY_WIDTH = LANE * 0.75;
/** Gap between bumpers of queued vehicles, split front and back. */
const GAP = 0.1;
const OUTLINE = 0.07;

function body(length: number, fill: Token): Shape {
  const x0 = -(length - 1) - 0.5 + GAP / 2;
  const x1 = 0.5 - GAP / 2;
  return {
    kind: 'rect',
    x: x0,
    y: -BODY_WIDTH / 2,
    w: x1 - x0,
    h: BODY_WIDTH,
    r: BODY_WIDTH * 0.3,
    fill,
    stroke: 'outline',
    strokeWidth: OUTLINE,
  };
}

/** Lengthwise accent stripe through the middle of a body. */
function stripe(length: number, fill: Token): Shape {
  const x0 = -(length - 1) - 0.5 + GAP / 2 + 0.12;
  const x1 = 0.5 - GAP / 2 - 0.12;
  const h = BODY_WIDTH * 0.34;
  return { kind: 'rect', x: x0, y: -h / 2, w: x1 - x0, h, r: h / 2, fill };
}

/**
 * Shapes for one vehicle. `frame` (0 or 1) only matters for the emergency beacon, which blinks
 * between two frames (GDD §7).
 */
export function vehicleShapes(type: number, frame: 0 | 1 = 0): Shape[] {
  switch (type) {
    case VehicleType.Taxi: {
      // Shape cue, not just colour (§7): a crosswise roof-sign block that sticks out past the
      // stripe on both sides, so a taxi reads as a "+" where a car reads as a "−".
      const w = 0.2;
      const h = BODY_WIDTH * 0.72;
      return [
        body(1, 'vehicleBody'),
        stripe(1, 'taxi'),
        {
          kind: 'rect',
          x: -0.06 - w / 2,
          y: -h / 2,
          w,
          h,
          r: 0.03,
          fill: 'taxi',
          stroke: 'outline',
          strokeWidth: OUTLINE * 0.8,
        },
      ];
    }
    case VehicleType.Bus: {
      const w = 0.62;
      const h = BODY_WIDTH * 0.5;
      return [
        body(2, 'busBody'),
        // Two windows as lighter rectangles.
        { kind: 'rect', x: -1.28, y: -h / 2, w, h, r: 0.06, fill: 'busWindow' },
        { kind: 'rect', x: -0.42, y: -h / 2, w, h, r: 0.06, fill: 'busWindow' },
      ];
    }
    case VehicleType.Truck: {
      // Box at the back, a gap, then a lighter cab at the front.
      const x0 = -2.5 + GAP / 2;
      const cabX = 0.05;
      const x1 = 0.5 - GAP / 2;
      return [
        {
          kind: 'rect',
          x: x0,
          y: -BODY_WIDTH / 2,
          w: cabX - 0.1 - x0,
          h: BODY_WIDTH,
          r: 0.08,
          fill: 'truckBox',
          stroke: 'outline',
          strokeWidth: OUTLINE,
        },
        {
          kind: 'rect',
          x: cabX,
          y: -BODY_WIDTH * 0.42,
          w: x1 - cabX,
          h: BODY_WIDTH * 0.84,
          r: 0.1,
          fill: 'truckCab',
          stroke: 'outline',
          strokeWidth: OUTLINE,
        },
      ];
    }
    case VehicleType.Emergency: {
      const s = BODY_WIDTH * 0.5;
      return [
        body(1, 'emergencyBody'),
        {
          kind: 'rect',
          x: -s / 2,
          y: -s / 2,
          w: s,
          h: s,
          r: 0.04,
          fill: frame === 0 ? 'beaconA' : 'beaconB',
        },
      ];
    }
    case VehicleType.Bike: {
      // A circle (rider) at the front with a short tail behind, inside one cell.
      const r = BODY_WIDTH * 0.36;
      const cx = 0.5 - GAP / 2 - r;
      const x0 = -0.5 + GAP / 2 + 0.06;
      const th = BODY_WIDTH * 0.22;
      return [
        {
          kind: 'rect',
          x: x0,
          y: -th / 2,
          w: cx - x0,
          h: th,
          r: th / 2,
          fill: 'bike',
          stroke: 'outline',
          strokeWidth: OUTLINE * 0.8,
        },
        { kind: 'circle', x: cx, y: 0, r, fill: 'bike', stroke: 'outline', strokeWidth: OUTLINE },
      ];
    }
    case VehicleType.Car:
    default:
      return [body(1, 'vehicleBody'), stripe(1, 'accent')];
  }
}

/**
 * Outline drawn around a vehicle for the queue pulse (GDD §7): the body's bounding box grown by
 * a small margin, stroke only, so it never hides the vehicle's own shape.
 */
export function vehicleOutline(type: number): Shape[] {
  const len = VEHICLE_LENGTH[type as VehicleType] ?? 1;
  const m = 0.08;
  const x0 = -(len - 1) - 0.5 + GAP / 2 - m;
  const x1 = 0.5 - GAP / 2 + m;
  const h = BODY_WIDTH + 2 * m;
  return [
    {
      kind: 'rect',
      x: x0,
      y: -h / 2,
      w: x1 - x0,
      h,
      r: h * 0.35,
      stroke: 'pulse',
      strokeWidth: 0.09,
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Controller glyphs. Units: 1 = the glyph's box; centred on the origin, so it spans [−0.5, 0.5].
// ---------------------------------------------------------------------------------------------

/** Regular octagon with flat top, circumradius `r`. */
export function octagonPoints(r: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    pts.push(r * Math.cos(a), r * Math.sin(a));
  }
  return pts;
}

const ROT: Readonly<Record<Side, readonly [number, number, number, number]>> = {
  e: [1, 0, 0, 1],
  s: [0, -1, 1, 0],
  w: [-1, 0, 0, -1],
  n: [0, 1, -1, 0],
};

/** Rotates east-pointing points to point towards `dir`. */
function rotate(points: readonly number[], dir: Side): number[] {
  const [a, b, c, d] = ROT[dir];
  const out: number[] = [];
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i] ?? 0;
    const y = points[i + 1] ?? 0;
    out.push(a * x + b * y, c * x + d * y);
  }
  return out;
}

/**
 * A chevron (">", one closed simple polygon) pointing towards `dir`, fitting a box of size `size`.
 * The outer edge runs through the tip; the inner edge is offset by the arm thickness towards −x.
 */
export function chevronPoints(dir: Side, size: number): number[] {
  const h = size / 2;
  const k = h * 0.6;
  const t = size * 0.28; // horizontal thickness of the arms
  return rotate([-k + t, -h, k, 0, -k + t, h, -k, h, k - t, 0, -k, -h], dir);
}

/**
 * Controller glyph per GDD §7: signal = three dots, roundabout = ring, stop = octagon,
 * priority = chevron towards the priority direction. Uncontrolled intersections are plain.
 */
export function controllerShapes(kind: ControllerKind, direction: Side = 'n'): Shape[] {
  switch (kind) {
    case 'signal': {
      const r = 0.12;
      const plate: Shape = {
        kind: 'rect',
        x: -0.46,
        y: -0.19,
        w: 0.92,
        h: 0.38,
        r: 0.19,
        fill: 'outline',
      };
      return [
        plate,
        { kind: 'circle', x: -0.29, y: 0, r, fill: 'signalRed' },
        { kind: 'circle', x: 0, y: 0, r, fill: 'signalAmber' },
        { kind: 'circle', x: 0.29, y: 0, r, fill: 'signalGreen' },
      ];
    }
    case 'roundabout':
      return [{ kind: 'circle', x: 0, y: 0, r: 0.34, stroke: 'glyph', strokeWidth: 0.13 }];
    case 'stop-all':
      return [
        {
          kind: 'poly',
          points: octagonPoints(0.44),
          fill: 'stop',
          stroke: 'glyph',
          strokeWidth: 0.07,
        },
      ];
    case 'priority':
      return [{ kind: 'poly', points: chevronPoints(direction, 0.8), fill: 'glyph' }];
    case 'uncontrolled':
    default:
      return [];
  }
}
