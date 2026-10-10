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
  private readonly pa: LanePoint = { x: 0, y: 0, heading: 0 };
  private readonly pb: LanePoint = { x: 0, y: 0, heading: 0 };
  private readonly mid: LanePoint = { x: 0, y: 0, heading: 0 };
  private readonly hp: LanePoint = { x: 0, y: 0, heading: 0 };
  private readonly tp: LanePoint = { x: 0, y: 0, heading: 0 };
  /** Lane id → cell count, probed through `cellPoint` (the layout does not expose it). */
  private readonly laneCells = new Map<number, number>();
  /** The move being sampled: from (`fl`, `fc`) forward `fm` cells to the newest head cell. */
  private fl = 0;
  /** The lane the sampled vehicle was in before `fl`, or -1 when unknown. */
  private fe = -1;
  /** id → the lane the vehicle drove in before its current one (the last lane change seen). */
  private entered = new Map<number, number>();
  private enteredNext = new Map<number, number>();
  private fc = 0;
  private fm = 0;
  private fRest = 0;
  private tl = 0;

  constructor(
    private layout: LaneLayout,
    /** Milliseconds per tick at the current speed (25 at 2×). */
    public tickMs = TICK_MS,
  ) {}

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    this.laneCells.clear();
  }

  private cellsOf(lane: number): number {
    let n = this.laneCells.get(lane);
    if (n === undefined) {
      n = 0;
      while (n < 256 && this.layout.cellPoint(lane, n, this.pa)) n++;
      this.laneCells.set(lane, n);
    }
    return n;
  }

  /**
   * Sets up the cells a vehicle's head crossed this tick, from (`pl`, `pc`) to (`cl`, `cc`): along
   * one lane, or to the end of one lane and on into the next. Returns false for any other move
   * (a skipped lane, a re-route, an id reuse), which the caller blends the old way.
   */
  private setMove(pl: number, pc: number, cl: number, cc: number, entered: number): boolean {
    this.fl = pl;
    this.fe = pl === cl ? entered : -1;
    this.fc = pc;
    this.tl = cl;
    if (pl === cl) {
      if (cc < pc) return false;
      this.fRest = cc - pc + 1;
      this.fm = cc - pc;
      return true;
    }
    const n = this.cellsOf(pl);
    // The next lane must start where the previous one ends (one cell apart at most).
    if (pc >= n || !this.adjacent(pl, n, cl)) return false;
    this.fRest = n - pc;
    this.fm = this.fRest + cc;
    return true;
  }

  /**
   * `backPoint`, except that past the start of the lane it continues into the lane the vehicle
   * came from (`fe`) when that lane ends where this one starts.
   */
  private backFrom(lane: number, cell: number, k: number, out: LanePoint): boolean {
    const e = this.fe;
    if (cell - k >= 0 || e < 0) return this.layout.backPoint(lane, cell, k, out);
    const n = this.cellsOf(e);
    if (n === 0 || !this.adjacent(e, n, lane)) return this.layout.backPoint(lane, cell, k, out);
    return this.layout.backPoint(e, n - 1, k - cell - 1, out);
  }

  /** True when lane `to` starts within a cell of where lane `from` (`n` cells) ends. */
  private adjacent(from: number, n: number, to: number): boolean {
    if (!this.layout.cellPoint(from, n - 1, this.pa) || !this.layout.cellPoint(to, 0, this.pb))
      return false;
    const gap = Math.hypot(this.pb.x - this.pa.x, this.pb.y - this.pa.y) * this.layout.cellsPerLane;
    return gap <= 1.75;
  }

  /** The centre of the cell `k` whole cells behind the newest head along the move's path. */
  private behind(k: number, out: LanePoint): boolean {
    if (k > this.fm) return this.backFrom(this.fl, this.fc, k - this.fm, out);
    const i = this.fm - k;
    return i < this.fRest
      ? this.layout.cellPoint(this.fl, this.fc + i, out)
      : this.layout.cellPoint(this.tl, i - this.fRest, out);
  }

  /**
   * Pose of a bus or truck whose head is `d` cells behind the newest head along the path, in
   * `mid`: the heading points from its tail to its head, and the anchor is placed so the drawn
   * body (head cell back `back` cells, see shapes.ts) is centred on the path's midpoint. Through
   * a turn the straight body then overhangs both ends of the bend equally instead of swinging
   * its tail across the box corner.
   */
  private bodyPose(d: number, back: number): boolean {
    if (!this.along(d, this.hp) || !this.along(d + back, this.tp)) return false;
    if (!this.along(d + back / 2, this.mid)) return false;
    const hx = this.hp.x - this.tp.x;
    const hy = this.hp.y - this.tp.y;
    const len = Math.hypot(hx, hy);
    if (len === 0) return false;
    const half = back / 2 / this.layout.cellsPerLane;
    this.mid.x += (hx / len) * half;
    this.mid.y += (hy / len) * half;
    this.mid.heading = Math.atan2(hy, hx);
    return true;
  }

  /** The point `d` cells (fractional) behind the newest head along the path. */
  private along(d: number, out: LanePoint): boolean {
    const k = Math.floor(d);
    const f = d - k;
    if (!this.behind(k, out)) return false;
    if (f === 0) return true;
    if (!this.behind(k + 1, this.pb)) return false;
    out.x += (this.pb.x - out.x) * f;
    out.y += (this.pb.y - out.y) * f;
    return true;
  }

  /** Clears both snapshots, e.g. when a new round starts. */
  reset(): void {
    this.prev = null;
    this.curr = null;
    this.prevIndex.clear();
    this.entered.clear();
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
    // Remember each vehicle's previous lane, so a long body can follow it back past the start
    // of its current lane (out of the box it turned through, or the lane it actually came from).
    const next = this.enteredNext;
    next.clear();
    const n = snapshotCount(snapshot);
    for (let i = 0; i < n; i++) {
      const o = SNAPSHOT_HEADER + i * SNAPSHOT_STRIDE;
      const id = word(snapshot, o);
      const lane = word(snapshot, o + 1);
      const po = this.prevIndex.get(id);
      const pl = po !== undefined && this.prev ? word(this.prev, po + 1) : -1;
      if (pl >= 0 && pl !== lane) next.set(id, pl);
      else {
        const e = this.entered.get(id);
        if (e !== undefined && pl === lane) next.set(id, e);
      }
    }
    this.enteredNext = this.entered;
    this.entered = next;
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
          if (
            bodyB &&
            dx * dx + dy * dy <= MAX_BLEND_TILES * MAX_BLEND_TILES &&
            this.setMove(pl, pc, lane, cell, this.entered.get(id) ?? -1) &&
            this.bodyPose((1 - t) * this.fm, back)
          ) {
            x = this.mid.x;
            y = this.mid.y;
            heading = this.mid.heading;
            tx = x;
            ty = y;
          } else if (dx * dx + dy * dy <= MAX_BLEND_TILES * MAX_BLEND_TILES) {
            x = this.a.x + dx * t;
            y = this.a.y + dy * t;
            heading = lerpAngle(this.a.heading, this.b.heading, t);
            if (bodyB && this.layout.backPoint(pl, pc, back, this.ta)) {
              tx = this.ta.x + (this.tb.x - this.ta.x) * t;
              ty = this.ta.y + (this.tb.y - this.ta.y) * t;
            }
          }
        }
      } else if (
        bodyB &&
        this.setMove(lane, cell, lane, cell, this.entered.get(id) ?? -1) &&
        this.bodyPose(0, back)
      ) {
        // No blend (first snapshot, or a full tick has passed): the same pose as t = 0 next tick.
        x = this.mid.x;
        y = this.mid.y;
        heading = this.mid.heading;
        tx = x;
        ty = y;
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
