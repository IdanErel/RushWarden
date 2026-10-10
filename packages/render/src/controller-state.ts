/**
 * Live intersection state from the sim worker's `controllers` frames (ADR-020 point 10): per
 * intersection, in `World.intersections` order, `[kind, greenMask, boxCount]`. Pure: decodes a
 * frame and turns it into the shapes the scene draws (signal stop bars and box occupancy).
 *
 * - `kind` is a `ControllerCode`. Until P1-SIM-05 wires the cards it is 0 (uncontrolled) for
 *   every intersection, so the scene keeps showing the glyphs the UI set.
 * - `greenMask` has bit `SIDES.indexOf(side)` set for each approach that may enter now. A signal
 *   with mask 0 is in its all-red clearance.
 * - `boxCount` is the number of vehicles inside the box (4 quarters, so 4 fills it).
 */
import {
  ControllerCode,
  SIDES,
  type ControllerKind,
  type GridMap,
  type Side,
  type World,
} from '@rushwarden/sim';
import { LANE_WIDTH, SIDE_VEC, connections, lanesAt, roadWidth } from './geometry.js';

/** Bytes per intersection in a controllers frame. */
export const CONTROLLER_STRIDE = 3;
/** Box quarters: a box with this many vehicles is full. */
export const BOX_CAPACITY = 4;

const KIND_BY_CODE: ReadonlyMap<number, ControllerKind> = new Map(
  (Object.entries(ControllerCode) as [string, number][]).map(([name, code]) => [
    code,
    name === 'StopAll' ? 'stop-all' : (name.toLowerCase() as ControllerKind),
  ]),
);

export interface LiveIntersection {
  readonly x: number;
  readonly y: number;
  readonly kind: ControllerKind;
  /** Approach sides that may enter now (signals only; empty during all-red and for other kinds). */
  readonly green: readonly Side[];
  /** Vehicles inside the box. */
  readonly box: number;
}

/** Decodes one controllers frame against the world it was produced for. Extra bytes are ignored. */
export function readControllers(
  frame: Uint8Array,
  world: Pick<World, 'intersections'>,
): LiveIntersection[] {
  const out: LiveIntersection[] = [];
  const n = Math.min(world.intersections.length, Math.floor(frame.length / CONTROLLER_STRIDE));
  for (let i = 0; i < n; i++) {
    const ix = world.intersections[i];
    if (!ix) continue;
    const o = i * CONTROLLER_STRIDE;
    const mask = frame[o + 1] ?? 0;
    out.push({
      x: ix.x,
      y: ix.y,
      kind: KIND_BY_CODE.get(frame[o] ?? 0) ?? 'uncontrolled',
      green: SIDES.filter((_s, k) => (mask >> k) & 1),
      box: frame[o + 2] ?? 0,
    });
  }
  return out;
}

/** A rectangle in tile units (map coordinates). */
export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface StopBar extends TileRect {
  readonly side: Side;
  readonly green: boolean;
}

/** Stop-bar thickness, in tiles. */
export const STOP_BAR = 0.07;

/**
 * Signal stop bars: one per approach of a signalled intersection, just outside the box across the
 * inbound lanes (right-hand traffic), green when that approach may enter and red otherwise.
 * Other controller kinds have no bars.
 */
export function stopBars(map: GridMap, live: LiveIntersection): StopBar[] {
  if (live.kind !== 'signal') return [];
  const lanes = lanesAt(map, live.x, live.y);
  const hw = roadWidth(lanes) / 2;
  const span = lanes * LANE_WIDTH;
  const cx = live.x + 0.5;
  const cy = live.y + 0.5;
  return connections(map, live.x, live.y).map((side) => {
    const [sx, sy] = SIDE_VEC[side];
    // Vehicles from `side` travel (-sx, -sy); their right is (sy, -sx).
    const [rx, ry] = [sy, -sx];
    const xs = [cx + sx * hw, cx + sx * (hw + STOP_BAR), cx + sx * hw + rx * span];
    const ys = [cy + sy * hw, cy + sy * (hw + STOP_BAR), cy + sy * hw + ry * span];
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    return {
      side,
      green: live.green.includes(side),
      x: x0,
      y: y0,
      w: Math.max(...xs) - x0,
      h: Math.max(...ys) - y0,
    };
  });
}

/** Opacity of the box-occupancy tint: 0 when empty, rising per quarter, capped when full. */
export function boxAlpha(count: number): number {
  if (!(count > 0)) return 0;
  return (0.5 * Math.min(count, BOX_CAPACITY)) / BOX_CAPACITY;
}
