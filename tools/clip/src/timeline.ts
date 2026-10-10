/**
 * Video time to sim time. The game's `SimClient` releases one snapshot per 50 ms of sim time
 * (25 ms at 2×) and the scene interpolates between the last two (GDD §6, ADR-015). The clip does
 * the same against a virtual clock, one video frame at a time, so frame i always shows the same
 * picture: no wall clock, no worker, no dropped frames.
 *
 * A clip is three parts: a short lead on the pre-Go map (heat-strips full, nothing moving), the
 * played ticks, and a hold on the last tick so the result can be read and the loop has a seam.
 */
import { ROUND_TICKS, TICKS_PER_SECOND } from '@rushwarden/sim';

/** Milliseconds per tick at 1× (50). */
export const TICK_MS = 1000 / TICKS_PER_SECOND;

export interface TimelineOptions {
  /** Ticks the round actually ran (`RoundResult.ticks`; under 300 on gridlock). */
  readonly ticks: number;
  /** Video frames per second. */
  readonly fps: number;
  /** Sim speed: 1 = the game's 1×, 2 = "hold for 2×" (GDD §2). */
  readonly speed: number;
  /** First tick shown moving (0 = Go). */
  readonly fromTick: number;
  /** Last tick shown; clamped to `ticks`. */
  readonly toTick: number;
  /** Still frames on the first shown tick before it plays, in ms. */
  readonly leadMs: number;
  /** Still frames on the last tick after it plays, in ms. */
  readonly holdMs: number;
}

export const DEFAULT_TIMELINE: Omit<TimelineOptions, 'ticks'> = {
  fps: 30,
  speed: 1,
  fromTick: 0,
  toTick: ROUND_TICKS,
  leadMs: 500,
  holdMs: 1500,
};

export type FramePhase = 'lead' | 'play' | 'hold';

export interface FrameTime {
  /** Video time of this frame in ms from the first frame. */
  readonly ms: number;
  /** Newest tick released by this frame (the scene blends towards it). */
  readonly tick: number;
  readonly phase: FramePhase;
}

/** Checks and normalises options; throws a RangeError naming the bad option. */
export function resolveTimeline(o: TimelineOptions): TimelineOptions {
  const ticks = Math.min(Math.max(0, Math.trunc(o.ticks)), ROUND_TICKS);
  const fromTick = Math.trunc(o.fromTick);
  const toTick = Math.min(Math.trunc(o.toTick), ticks);
  if (!(o.fps >= 1 && o.fps <= 60)) throw new RangeError(`fps must be 1..60, got ${o.fps}`);
  if (!(o.speed > 0 && o.speed <= 8))
    throw new RangeError(`speed must be in (0, 8], got ${o.speed}`);
  if (!(fromTick >= 0 && fromTick < toTick))
    throw new RangeError(`need 0 <= from < to <= ${ticks} ticks, got ${fromTick}..${toTick}`);
  if (!(o.leadMs >= 0) || !(o.holdMs >= 0)) throw new RangeError('lead and hold must be >= 0');
  return { ...o, ticks, fromTick, toTick };
}

/** Milliseconds the moving part lasts. */
export function playMs(o: TimelineOptions): number {
  return ((o.toTick - o.fromTick) * TICK_MS) / o.speed;
}

/** Frames in the whole clip (lead + play + hold). */
export function frameCount(o: TimelineOptions): number {
  return Math.round(((o.leadMs + playMs(o) + o.holdMs) * o.fps) / 1000);
}

/**
 * Frame `i`'s time and the newest tick it releases. Tick `fromTick + k` is released once
 * `k` ticks of sim time have passed since the lead ended, as `SimClient.update` does.
 */
export function frameAt(i: number, o: TimelineOptions): FrameTime {
  const ms = (i * 1000) / o.fps;
  const played = ms - o.leadMs;
  if (played < 0) return { ms, tick: o.fromTick, phase: 'lead' };
  // Integer ticks of elapsed sim time; the epsilon absorbs float error at exact tick boundaries.
  const elapsed = Math.floor((played * o.speed) / TICK_MS + 1e-9);
  const tick = Math.min(o.fromTick + elapsed, o.toTick);
  return { ms, tick, phase: played < playMs(o) ? 'play' : 'hold' };
}
