/**
 * A clip as data: the replayed round's per-tick snapshots and throughput, the timeline, and the
 * HUD state of every frame. The page only draws what this returns, so everything that decides
 * what a frame shows is pure and runs in Node too (the unit tests, and the CLI's sidecar hashes).
 */
import { getCard } from '@rushwarden/content';
import { Sim, controllerSnapshot, type RoundInput, type RoundResult } from '@rushwarden/sim';
import { planRun, type ClipPlan, type ClipSpec } from './director.js';
import { type HudCard, type HudState } from './hud.js';
import {
  DEFAULT_TIMELINE,
  frameAt,
  frameCount,
  resolveTimeline,
  type FrameTime,
  type TimelineOptions,
} from './timeline.js';

/** The round, stepped tick by tick: index k is the state after tick k (0 = before Go). */
export interface Recording {
  readonly snapshots: readonly Uint16Array[];
  /** `Sim.controllerSnapshot` per tick (signal phases and box occupancy, ADR-020). */
  readonly controllers: readonly Uint8Array[];
  readonly throughput: readonly number[];
  readonly result: RoundResult;
}

export function record(input: RoundInput): Recording {
  let s = Sim.init(input);
  const snapshots = [Sim.snapshot(s)];
  const controllers = [controllerSnapshot(s)];
  const throughput = [0];
  while (!s.done) {
    s = Sim.step(s);
    snapshots.push(Sim.snapshot(s));
    controllers.push(controllerSnapshot(s));
    throughput.push(Sim.result(s).throughput);
  }
  return { snapshots, controllers, throughput, result: Sim.result(s) };
}

export interface ClipOptions extends Partial<Omit<TimelineOptions, 'ticks'>> {
  /** GDD §8 reduced motion: no trails, no shake. Off by default (the clip is for watching). */
  readonly reducedMotion?: boolean;
}

export interface Clip {
  readonly spec: ClipSpec;
  readonly plan: ClipPlan;
  readonly recording: Recording;
  readonly timeline: TimelineOptions;
  readonly frames: number;
  readonly cards: readonly HudCard[];
  readonly reducedMotion: boolean;
}

/** GDD §5 district names (the run screen uses the same). */
export const DISTRICT_NAME: Readonly<Record<1 | 2 | 3, string>> = {
  1: 'Old Town',
  2: 'Midtown',
  3: 'Interchange',
};

export function buildClip(spec: ClipSpec, opts: ClipOptions = {}): Clip {
  const plan = planRun(spec);
  const recording = record(plan.input);
  const { reducedMotion, ...rest } = opts;
  const timeline = resolveTimeline({
    ...DEFAULT_TIMELINE,
    ...rest,
    toTick: rest.toTick ?? recording.result.ticks,
    ticks: recording.result.ticks,
  });
  const cards = plan.cardsPlayed.map((id) => {
    const c = getCard(id);
    return { name: c.name, tag: c.tags[0] ?? '' };
  });
  return {
    spec,
    plan,
    recording,
    timeline,
    frames: frameCount(timeline),
    cards,
    reducedMotion: reducedMotion ?? false,
  };
}

export function frameTime(clip: Clip, i: number): FrameTime {
  return frameAt(i, clip.timeline);
}

/** The round's outcome as the run controller scores it (GDD §2 step 4; gridlock ends it early). */
export function outcomeOf(clip: Clip): 'pass' | 'fail' | 'gridlock' {
  const r = clip.recording.result;
  if (r.gridlocked) return 'gridlock';
  return r.throughput >= clip.plan.quota ? 'pass' : 'fail';
}

export function hudAt(clip: Clip, i: number): HudState {
  const f = frameTime(clip, i);
  const { plan, recording } = clip;
  const atEnd = f.tick >= recording.result.ticks && f.phase === 'hold';
  return {
    district: DISTRICT_NAME[plan.input.districtRules.district as 1 | 2 | 3] ?? 'District',
    round: plan.round,
    rush: plan.rush,
    boss: plan.boss,
    cards: clip.cards,
    quota: plan.quota,
    throughput: recording.throughput[f.tick] ?? 0,
    finalThroughput: recording.result.throughput,
    tick: f.tick,
    outcome: atEnd ? outcomeOf(clip) : null,
  };
}

/** What the CLI saves next to the video so the clip can be re-rendered and checked. */
export interface ClipMeta {
  readonly tool: 'rushwarden-clip';
  readonly spec: ClipSpec;
  readonly actions: ClipPlan['actions'];
  readonly round: number;
  readonly boss: ClipPlan['boss'];
  readonly quota: number;
  readonly cardsPlayed: readonly string[];
  readonly result: Omit<RoundResult, 'frames'>;
  readonly timeline: TimelineOptions;
  readonly frames: number;
  readonly reducedMotion: boolean;
}

export function clipMeta(clip: Clip): ClipMeta {
  const { frames: _drop, ...result } = clip.recording.result;
  return {
    tool: 'rushwarden-clip',
    spec: clip.spec,
    actions: clip.plan.actions,
    round: clip.plan.round,
    boss: clip.plan.boss,
    quota: clip.plan.quota,
    cardsPlayed: clip.plan.cardsPlayed,
    result,
    timeline: clip.timeline,
    frames: clip.frames,
    reducedMotion: clip.reducedMotion,
  };
}
