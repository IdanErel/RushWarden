/**
 * Snapshot interpolation (GDD §6): "The renderer interpolates between the last two snapshots at
 * the display refresh rate; it never predicts."
 *
 * Snapshots are the sim's compact format: `[tick, count, ...count × (id, lane, cell, speed, type)]`.
 * The buffer keeps exactly two. `sample(now)` blends from the older to the newer by how much of
 * one tick has elapsed since the newer one arrived, clamped to [0, 1]: when the worker pauses or
 * falls behind, vehicles stop at the newest snapshot instead of extrapolating past it.
 */
import { SNAPSHOT_HEADER, SNAPSHOT_STRIDE, TICKS_PER_SECOND } from '@rushwarden/sim';
import type { LaneLayout, LanePoint } from './lanes.js';
import { VEHICLE_LENGTH } from './shapes.js';

/** One vehicle ready to draw, in tile units. */
export interface VehiclePose {
  id: number;
  type: number;
  x: number;
  y: number;
  heading: number;
  speed: number;
}

/** Milliseconds per sim tick at 1× (50 ms). */
export const TICK_MS = 1000 / TICKS_PER_SECOND;

/** Reads one word; out-of-range reads are 0 (bounds are checked by `snapshotCount`). */
export function word(s: Uint16Array, i: number): number {
  return s[i] ?? 0;
}

export function snapshotTick(s: Uint16Array): number {
  return s[0] ?? 0;
}

export function snapshotCount(s: Uint16Array): number {
  const n = s[1] ?? 0;
  // Never trust the header past the buffer's length.
  return Math.min(n, Math.floor((s.length - SNAPSHOT_HEADER) / SNAPSHOT_STRIDE));
}

/** Shortest-arc blend between two angles. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

/**
 * A vehicle that moved further than this between two ticks (in tiles) is drawn at its new
 * position rather than sliding across blocks. Vmax is 4 cells = 1 tile per tick (emergency), so
 * anything beyond 2 tiles is a re-route or an id reuse, not motion.
 */
const MAX_BLEND_TILES = 2;

export class SnapshotBuffer {
  private prev: Uint16Array | null = null;
  private curr: Uint16Array | null = null;
  private currAt = 0;
  /** id → word offset of that vehicle in `prev`. */
  private readonly prevIndex = new Map<number, number>();
  private readonly a: LanePoint = { x: 0, y: 0, heading: 0 };
  private readonly b: LanePoint = { x: 0, y: 0, heading: 0 };
  private readonly ta: LanePoint = { x: 0, y: 0, heading: 0 };
  private readonly tb: LanePoint = { x: 0, y: 0, heading: 0 };

  constructor(
    private layout: LaneLayout,
    /** Milliseconds per tick at the current speed (25 at 2×). */
    public tickMs = TICK_MS,
  ) {}

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
  }

  /** Clears both snapshots, e.g. when a new round starts. */
  reset(): void {
    this.prev = null;
    this.curr = null;
    this.prevIndex.clear();
  }

  /** Accepts a snapshot received at `now` (ms). Older or repeated ticks are ignored. */
  push(snapshot: Uint16Array, now: number): void {
    if (this.curr && snapshotTick(snapshot) <= snapshotTick(this.curr)) {
      // A new round restarts at a lower tick; anything else out of order is stale.
      if (snapshotTick(snapshot) !== 0) return;
      this.reset();
    }
    this.prev = this.curr;
    this.curr = snapshot;
    this.currAt = now;
    this.prevIndex.clear();
    if (this.prev) {
      const n = snapshotCount(this.prev);
      for (let i = 0; i < n; i++) {
        const o = SNAPSHOT_HEADER + i * SNAPSHOT_STRIDE;
        this.prevIndex.set(word(this.prev, o), o);
      }
    }
  }

  /** The newest tick received, or -1 before the first snapshot. */
  get tick(): number {
    return this.curr ? snapshotTick(this.curr) : -1;
  }

  /** Blend factor at `now`: 0 = previous snapshot, 1 = newest. */
  alpha(now: number): number {
    if (!this.prev || this.tickMs <= 0) return 1;
    const t = (now - this.currAt) / this.tickMs;
    return t <= 0 ? 0 : t >= 1 ? 1 : t;
  }

  /**
   * Fills `out` with one pose per drawable vehicle in the newest snapshot and returns how many
   * were written. `out` grows as needed and its objects are reused across frames.
   */
  sample(now: number, out: VehiclePose[]): number {
    const curr = this.curr;
    if (!curr) return 0;
    const prev = this.prev;
    const t = this.alpha(now);
    const n = snapshotCount(curr);
    let w = 0;
    for (let i = 0; i < n; i++) {
      const o = SNAPSHOT_HEADER + i * SNAPSHOT_STRIDE;
      const id = word(curr, o);
      const type = word(curr, o + 4);
      const lane = word(curr, o + 1);
      const cell = word(curr, o + 2);
      if (!this.layout.cellPoint(lane, cell, this.b)) continue;
      // Multi-cell vehicles (bus, truck) point from their tail cell to their head cell, so the
      // body follows the path through a turn instead of swinging out on the head's heading.
      const back = (VEHICLE_LENGTH[type as keyof typeof VEHICLE_LENGTH] ?? 1) - 1;
      const bodyB = back > 0 && this.layout.backPoint(lane, cell, back, this.tb);
      let x = this.b.x;
      let y = this.b.y;
      let tx = bodyB ? this.tb.x : 0;
      let ty = bodyB ? this.tb.y : 0;
      let heading = this.b.heading;
      const po = prev ? this.prevIndex.get(id) : undefined;
      if (prev && po !== undefined && t < 1) {
        const pl = word(prev, po + 1);
        const pc = word(prev, po + 2);
        if (this.layout.cellPoint(pl, pc, this.a)) {
          const dx = this.b.x - this.a.x;
          const dy = this.b.y - this.a.y;
          if (dx * dx + dy * dy <= MAX_BLEND_TILES * MAX_BLEND_TILES) {
            x = this.a.x + dx * t;
            y = this.a.y + dy * t;
            heading = lerpAngle(this.a.heading, this.b.heading, t);
            if (bodyB && this.layout.backPoint(pl, pc, back, this.ta)) {
              tx = this.ta.x + (this.tb.x - this.ta.x) * t;
              ty = this.ta.y + (this.tb.y - this.ta.y) * t;
            }
          }
        }
      }
      if (bodyB && (x !== tx || y !== ty)) heading = Math.atan2(y - ty, x - tx);
      let pose = out[w];
      if (!pose) {
        pose = { id: 0, type: 0, x: 0, y: 0, heading: 0, speed: 0 };
        out[w] = pose;
      }
      pose.id = id;
      pose.type = word(curr, o + 4);
      pose.speed = word(curr, o + 3);
      pose.x = x;
      pose.y = y;
      pose.heading = heading;
      w++;
    }
    return w;
  }
}
