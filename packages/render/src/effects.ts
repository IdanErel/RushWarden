/**
 * Readability effects (GDD §7 motion feedback, §8 reduced motion) as pure functions of time and
 * state, so they are testable without Pixi:
 *
 * - "speed is shown by a 1–3-cell trail with alpha fade"
 * - "queuing vehicles pulse their outline once per second"
 * - "gridlock turns the whole queue a desaturated red and shakes the camera 4 px for 300 ms"
 * - demand heat-strips: each edge's 15-second spawn profile, shown before Go (§2, §8)
 * - reduced motion: "no camera shake, no trails, instant transitions" (§8)
 *
 * Constraint 9 applies to all of it: nothing here may make the traffic state harder to read.
 */
import { ROUND_TICKS, TICKS_PER_SECOND, type DemandProfile, type MapEdge } from '@rushwarden/sim';

export interface MotionPrefs {
  /** §8 reduced-motion mode. */
  readonly reducedMotion: boolean;
}

/** Trail length in cells for a vehicle moving `speed` cells per tick: 0 when stopped, max 3. */
export function trailCells(speed: number, prefs: MotionPrefs): number {
  if (prefs.reducedMotion || !(speed > 0)) return 0;
  return Math.min(3, Math.floor(speed));
}

/** Alpha of trail segment `i` (0 = nearest the vehicle) out of `n`: fades out away from it. */
export function trailAlpha(i: number, n: number): number {
  if (n <= 0 || i < 0 || i >= n) return 0;
  return 0.45 * (1 - i / n);
}

export const PULSE_PERIOD_MS = 1000;
/** The visible part of each pulse; the rest of the second the outline is off. */
const PULSE_ON_MS = 350;

/**
 * Outline alpha for a queued (stopped) vehicle at time `now`. One pulse per second, phase-locked
 * to the clock so a whole queue pulses together (reads as one queue, not noise). Reduced motion:
 * a steady outline instead of a pulse, so queues stay marked without animation.
 */
export function pulseAlpha(now: number, prefs: MotionPrefs): number {
  if (prefs.reducedMotion) return 0.6;
  const t = ((now % PULSE_PERIOD_MS) + PULSE_PERIOD_MS) % PULSE_PERIOD_MS;
  return t < PULSE_ON_MS ? 1 - t / PULSE_ON_MS : 0;
}

export const SHAKE_MS = 300;
export const SHAKE_PX = 4;

/**
 * Camera offset in px `elapsed` ms after gridlock: up to 4 px, decaying to 0 at 300 ms. A fixed
 * pattern (not random) so captures are reproducible. Zero under reduced motion.
 */
export function shakeOffset(elapsed: number, prefs: MotionPrefs): [number, number] {
  if (prefs.reducedMotion || !(elapsed >= 0) || elapsed >= SHAKE_MS) return [0, 0];
  const amp = SHAKE_PX * (1 - elapsed / SHAKE_MS);
  const a = (elapsed / 1000) * 2 * Math.PI * 23; // ~23 Hz
  return [amp * Math.sin(a), amp * Math.cos(a * 1.3)];
}

/** Desaturated red applied as a tint to stopped vehicles during gridlock. */
export const GRIDLOCK_TINT = 0xd27b6e;

/**
 * Heat-strip thickness floor in CSS px (Lead's decision, ADR-015): at least 6 px at the 390 px
 * design width, so the strip reads as a profile rather than a hairline.
 */
export const HEAT_STRIP_MIN_PX = 6;
/**
 * Space kept around the grid for the demand heat-strips, in px. The strip fills it edge to edge:
 * any wider gutter drops a 390 px phone from 54 px to 53 px tiles, and the car under 12 px.
 */
export const HEAT_GUTTER_PX = HEAT_STRIP_MIN_PX;

/** Seconds in a round, one heat-strip bin each (15). */
export const HEAT_BINS = ROUND_TICKS / TICKS_PER_SECOND;

/** Spawns per edge per second of the round: edge id → counts (length `HEAT_BINS`). */
export function demandBins(
  profile: DemandProfile,
  edges: readonly MapEdge[],
): Map<number, Uint16Array> {
  const out = new Map<number, Uint16Array>();
  for (const e of edges) out.set(e.id, new Uint16Array(HEAT_BINS));
  for (const ev of profile) {
    const bins = out.get(ev.edge);
    const b = Math.floor(ev.tick / TICKS_PER_SECOND);
    if (!bins || b < 0 || b >= HEAT_BINS) continue;
    bins[b] = (bins[b] ?? 0) + 1;
  }
  return out;
}

/** Number of heat levels above "none". */
export const HEAT_LEVELS = 4;

/**
 * Quantises a count to a level 0..4 against the busiest bin on the whole map, so strips on
 * different edges compare directly. Any spawn is at least level 1.
 */
export function heatLevel(count: number, max: number): number {
  if (!(count > 0) || !(max > 0)) return 0;
  return Math.max(1, Math.min(HEAT_LEVELS, Math.ceil((count / max) * HEAT_LEVELS)));
}

export function maxBin(bins: ReadonlyMap<number, Uint16Array>): number {
  let m = 0;
  for (const b of bins.values()) for (const v of b) m = Math.max(m, v);
  return m;
}

/**
 * Where an edge's strip goes, in tile units: a bar in the gutter outside the grid, centred on the
 * edge tile and running along the boundary. Time flows left→right on n/s edges and top→bottom on
 * e/w edges. `gutter` is in tiles.
 */
export function stripRect(
  edge: MapEdge,
  gridW: number,
  gridH: number,
  gutter: number,
): { x: number; y: number; w: number; h: number; horizontal: boolean } {
  const { x, y } = edge.tile;
  const len = 0.9;
  // The strip fills the gutter (see HEAT_GUTTER_PX); it starts where the grid ends.
  switch (edge.side) {
    case 'n':
      return { x: x + 0.05, y: -gutter, w: len, h: gutter, horizontal: true };
    case 's':
      return { x: x + 0.05, y: gridH, w: len, h: gutter, horizontal: true };
    case 'w':
      return { x: -gutter, y: y + 0.05, w: gutter, h: len, horizontal: false };
    case 'e':
    default:
      return { x: gridW, y: y + 0.05, w: gutter, h: len, horizontal: false };
  }
}
