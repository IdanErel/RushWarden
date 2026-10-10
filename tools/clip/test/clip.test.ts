import { describe, expect, it } from 'vitest';
import { Sim } from '@rushwarden/sim';
import { buildClip, clipMeta, frameTime, hudAt, outcomeOf, record } from '../src/clip.ts';
import { MARKET_DAY_SEED, planRun } from '../src/director.ts';

describe('clip model', () => {
  it('records the same round the headless sim plays (zero desync, GDD §1)', () => {
    const { input } = planRun({ seed: MARKET_DAY_SEED });
    const rec = record(input);
    const headless = Sim.simulate(input);
    expect(rec.result.finalHash).toBe(headless.finalHash);
    expect(rec.snapshots).toHaveLength(headless.ticks + 1);
    expect(rec.controllers).toHaveLength(headless.ticks + 1);
    expect(rec.throughput.at(-1)).toBe(headless.throughput);
    for (let k = 1; k < rec.throughput.length; k++)
      expect(rec.throughput[k]).toBeGreaterThanOrEqual(rec.throughput[k - 1] ?? 0);
  });

  it('ends the jam clip on the gridlock tick with the gridlock outcome', () => {
    const clip = buildClip({ seed: MARKET_DAY_SEED, plays: 'none' });
    expect(clip.recording.result.gridlocked).toBe(true);
    expect(clip.timeline.toTick).toBe(clip.recording.result.ticks);
    expect(outcomeOf(clip)).toBe('gridlock');
    expect(hudAt(clip, 0).outcome).toBeNull();
    expect(hudAt(clip, clip.frames - 1)).toMatchObject({
      outcome: 'gridlock',
      tick: clip.recording.result.ticks,
      throughput: clip.recording.result.throughput,
    });
  });

  it('passes the Market Day round with the director cards', () => {
    const clip = buildClip({ seed: MARKET_DAY_SEED });
    expect(outcomeOf(clip)).toBe('pass');
    expect(clip.cards.map((c) => c.tag).every((t) => t.length > 0)).toBe(true);
    expect(hudAt(clip, 0)).toMatchObject({ district: 'Old Town', round: 5, throughput: 0 });
  });

  it('honours timeline options and keeps frames out of the metadata', () => {
    const clip = buildClip(
      { seed: MARKET_DAY_SEED },
      { fromTick: 100, toTick: 140, fps: 10, leadMs: 0, holdMs: 0 },
    );
    expect(clip.frames).toBe(20);
    expect(frameTime(clip, 0).tick).toBe(100);
    const meta = clipMeta(clip);
    expect(meta.result).not.toHaveProperty('frames');
    expect(meta).toMatchObject({ tool: 'rushwarden-clip', round: 5, frames: 20 });
    expect(meta.actions).toEqual(clip.plan.actions);
  });

  it('marks a missed quota as a fail', () => {
    const clip = buildClip({ seed: MARKET_DAY_SEED, plays: 'none' });
    const notLocked = {
      ...clip,
      recording: {
        ...clip.recording,
        result: {
          ...clip.recording.result,
          gridlocked: false,
          throughput: clip.plan.quota - 1,
        },
      },
    };
    expect(outcomeOf(notLocked)).toBe('fail');
  });
});
