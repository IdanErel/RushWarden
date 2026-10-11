/**
 * Where a gridlock started (P1-UI readability, from the #81 feel report: "jams can't be traced to
 * a card"). The sim's result only says `gridlocked`; this works it out from the snapshots the
 * renderer already gets, so it needs nothing new from the sim or the worker.
 *
 * A junction is *stuck* on a tick when at least one vehicle waits at it (stopped in its box, or
 * stopped on a neighbouring tile heading into it) and no vehicle there moves. At gridlock every
 * vehicle has been stopped for `GRIDLOCK_TICKS`, so every junction with a queue is stuck; the
 * origin is the one whose current stuck stretch began first (ties: the longer queue, then the
 * lower intersection index). Pure: no Pixi, no DOM. Works with any `LaneLayout`, so the dev
 * page's fake traffic gets it too.
 */
import {
  GRID_HEIGHT,
  GRID_WIDTH,
  SNAPSHOT_HEADER,
  SNAPSHOT_STRIDE,
  type GridMap,
} from '@rushwarden/sim';
import { intersections } from './geometry.js';
import type { LaneLayout, LanePoint } from './lanes.js';

export interface JamOrigin {
  /** The junction's tile. */
  readonly x: number;
  readonly y: number;
  /** Tick its stuck stretch began. */
  readonly since: number;
  /** Vehicles waiting at it on the last snapshot. */
  readonly waiting: number;
}

/** cos 45°: a heading within 45° of "towards the junction" counts as approaching it. */
const TOWARDS = Math.SQRT1_2;

export class JamTracer {
  private junctions: readonly { x: number; y: number }[] = [];
  /** Junction index per tile (row-major), or -1. */
  private at = new Int16Array(0);
  private since = new Int32Array(0);
  private waiting = new Int32Array(0);
  private moving = new Uint8Array(0);
  private lastTick = -1;
  private readonly p: LanePoint = { x: 0, y: 0, heading: 0 };

  constructor(
    map: GridMap,
    private layout: LaneLayout,
  ) {
    this.setMap(map, layout);
  }

  /** A new map or lane layout (each round); clears what was traced. */
  setMap(map: GridMap, layout: LaneLayout = this.layout): void {
    this.layout = layout;
    this.junctions = intersections(map);
    this.at = new Int16Array(GRID_WIDTH * GRID_HEIGHT).fill(-1);
    this.junctions.forEach((j, i) => (this.at[j.y * GRID_WIDTH + j.x] = i));
    const n = this.junctions.length;
    this.since = new Int32Array(n);
    this.waiting = new Int32Array(n);
    this.moving = new Uint8Array(n);
    this.reset();
  }

  /** Forgets the traced round (a new round starts). */
  reset(): void {
    this.since.fill(-1);
    this.waiting.fill(0);
    this.lastTick = -1;
  }

  /** Feeds one released snapshot. A snapshot of an earlier tick than the last starts over. */
  push(s: Uint16Array): void {
    const tick = s[0] ?? 0;
    if (tick === this.lastTick) return;
    if (tick < this.lastTick) this.reset();
    this.lastTick = tick;
    this.waiting.fill(0);
    this.moving.fill(0);
    const count = Math.min(s[1] ?? 0, Math.floor((s.length - SNAPSHOT_HEADER) / SNAPSHOT_STRIDE));
    for (let i = 0; i < count; i++) {
      const o = SNAPSHOT_HEADER + i * SNAPSHOT_STRIDE;
      const j = this.junctionOf(s[o + 1] ?? 0, s[o + 2] ?? 0);
      if (j < 0) continue;
      if ((s[o + 3] ?? 0) === 0) this.waiting[j] = (this.waiting[j] ?? 0) + 1;
      else this.moving[j] = 1;
    }
    for (let j = 0; j < this.junctions.length; j++) {
      const stuck = (this.waiting[j] ?? 0) > 0 && this.moving[j] === 0;
      if (!stuck) this.since[j] = -1;
      else if ((this.since[j] ?? -1) < 0) this.since[j] = tick;
    }
  }

  /** The junction a vehicle at (`lane`, `cell`) waits at or drives into, or -1. */
  private junctionOf(lane: number, cell: number): number {
    const p = this.p;
    if (!this.layout.cellPoint(lane, cell, p)) return -1;
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    const here = this.tileJunction(tx, ty);
    if (here >= 0) return here;
    const dx = Math.cos(p.heading);
    const dy = Math.sin(p.heading);
    // The neighbouring tile it is heading for, if that is a junction.
    if (dx > TOWARDS) return this.tileJunction(tx + 1, ty);
    if (dx < -TOWARDS) return this.tileJunction(tx - 1, ty);
    if (dy > TOWARDS) return this.tileJunction(tx, ty + 1);
    if (dy < -TOWARDS) return this.tileJunction(tx, ty - 1);
    return -1;
  }

  private tileJunction(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= GRID_WIDTH || y >= GRID_HEIGHT) return -1;
    return this.at[y * GRID_WIDTH + x] ?? -1;
  }

  /** The junction stuck longest, or null when none is stuck now. */
  origin(): JamOrigin | null {
    let best: JamOrigin | null = null;
    this.junctions.forEach((j, i) => {
      const since = this.since[i] ?? -1;
      const waiting = this.waiting[i] ?? 0;
      if (since < 0) return;
      if (!best || since < best.since || (since === best.since && waiting > best.waiting))
        best = { x: j.x, y: j.y, since, waiting };
    });
    return best;
  }
}
