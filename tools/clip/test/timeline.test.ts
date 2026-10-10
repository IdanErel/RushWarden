import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMELINE,
  TICK_MS,
  frameAt,
  frameCount,
  playMs,
  resolveTimeline,
  type TimelineOptions,
} from '../src/timeline.ts';

const opts = (o: Partial<TimelineOptions> = {}): TimelineOptions =>
  resolveTimeline({ ...DEFAULT_TIMELINE, ticks: 300, ...o });

describe('timeline', () => {
  it('lasts lead + 15 s of round + hold at 1x', () => {
    const t = opts();
    expect(playMs(t)).toBe(15_000);
    expect(frameCount(t)).toBe(Math.round((0.5 + 15 + 1.5) * 30));
  });

  it('halves the moving part at 2x, as hold-for-2x does in the game', () => {
    expect(playMs(opts({ speed: 2 }))).toBe(7_500);
  });

  it('releases tick k after k ticks of sim time, like SimClient (one per 50 ms at 1x)', () => {
    const t = opts({ fps: 20, leadMs: 0 }); // one frame per tick
    expect(TICK_MS).toBe(50);
    for (let i = 0; i < 300; i++) expect(frameAt(i, t).tick).toBe(i);
    const t2 = opts({ fps: 20, leadMs: 0, speed: 2 });
    expect(frameAt(10, t2).tick).toBe(20);
  });

  it('holds the first tick during the lead and the last during the hold', () => {
    const t = opts({ fromTick: 100, toTick: 140 });
    expect(frameAt(0, t)).toMatchObject({ tick: 100, phase: 'lead' });
    expect(frameAt(15, t).phase).toBe('play');
    const last = frameAt(frameCount(t) - 1, t);
    expect(last).toMatchObject({ tick: 140, phase: 'hold' });
  });

  it('never passes the ticks the round ran (gridlock ends it early)', () => {
    const t = opts({ ticks: 241 });
    expect(t.toTick).toBe(241);
    expect(frameAt(frameCount(t) - 1, t).tick).toBe(241);
  });

  it('rejects bad options', () => {
    expect(() => opts({ fps: 0 })).toThrow(/fps/);
    expect(() => opts({ speed: 0 })).toThrow(/speed/);
    expect(() => opts({ fromTick: 200, toTick: 100 })).toThrow(/from/);
    expect(() => opts({ holdMs: -1 })).toThrow(/hold/);
  });
});
