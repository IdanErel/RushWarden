import { describe, expect, it } from 'vitest';
import { OLD_TOWN } from '@rushwarden/render';
import {
  FRAME_H,
  FRAME_W,
  TAG_COLOR,
  barScale,
  clock,
  hudOps,
  title,
  type HudState,
} from '../src/hud.ts';

const map = { top: 108, bottom: 660 };
const state = (o: Partial<HudState> = {}): HudState => ({
  district: 'Old Town',
  round: 5,
  rush: true,
  boss: 'market-day',
  cards: [
    { name: 'Delivery Window', tag: 'TOLL' },
    { name: 'Fare Holiday', tag: 'MASS' },
  ],
  quota: 60,
  throughput: 30,
  finalThroughput: 155,
  tick: 140,
  outcome: null,
  ...o,
});

describe('clip HUD', () => {
  it('names the round and its boss', () => {
    expect(title({ round: 5, rush: true, boss: 'market-day' })).toBe('Round 5 · Market Day');
    expect(title({ round: 4, rush: true, boss: null })).toBe('Round 4 · Rush');
    expect(title({ round: 2, rush: false, boss: null })).toBe('Round 2');
  });

  it('counts the clock in sim seconds', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(139)).toBe('0:06');
    expect(clock(300)).toBe('0:15');
  });

  it('scales the bar so it never overflows and the quota mark stays on it', () => {
    const b = barScale(155, 60, 155);
    expect(b.fill).toBeLessThan(1);
    expect(b.mark).toBeCloseTo(60 / (155 * 1.1));
    expect(barScale(0, 60, 29).fill).toBe(0);
    expect(barScale(29, 60, 29).mark).toBeLessThan(1);
  });

  it('keeps every caption inside the frame and off the map', () => {
    for (const s of [
      state(),
      state({ outcome: 'gridlock', cards: [] }),
      state({ outcome: 'pass' }),
    ])
      for (const op of hudOps(s, map)) {
        expect(op.x).toBeGreaterThanOrEqual(0);
        expect(op.y).toBeGreaterThanOrEqual(0);
        expect(op.x + op.w).toBeLessThanOrEqual(FRAME_W);
        expect(op.y + op.h).toBeLessThanOrEqual(FRAME_H);
        const overlapsMap = op.y < map.bottom && op.y + op.h > map.top;
        expect(overlapsMap, JSON.stringify(op)).toBe(false);
      }
  });

  it('colours card chips by tag and says when no card was played', () => {
    const fills = hudOps(state(), map).map((o) => o.color);
    expect(fills).toContain(TAG_COLOR['TOLL']);
    expect(fills).toContain(TAG_COLOR['MASS']);
    const none = hudOps(state({ cards: [] }), map).map((o) => o.color);
    expect(none).toContain(OLD_TOWN.road);
  });

  it('turns the bar green once the quota is met and shows the outcome only at the end', () => {
    const before = hudOps(state({ throughput: 30 }), map).map((o) => o.color);
    expect(before).toContain(OLD_TOWN.accent);
    const after = hudOps(state({ throughput: 61 }), map).map((o) => o.color);
    expect(after).toContain(OLD_TOWN.signalGreen);
    const n = hudOps(state(), map).length;
    expect(hudOps(state({ outcome: 'fail' }), map).length).toBeGreaterThan(n);
    expect(hudOps(state({ outcome: 'fail' }), map).map((o) => o.color)).toContain(OLD_TOWN.stop);
  });

  it('drops chips that do not fit the row', () => {
    const many = Array.from({ length: 6 }, () => ({ name: 'Delivery Window', tag: 'TOLL' }));
    for (const op of hudOps(state({ cards: many }), map))
      expect(op.x + op.w).toBeLessThanOrEqual(FRAME_W);
  });
});
