import { describe, expect, it } from 'vitest';
import { randomBot, greedyBot, type Bot } from '@rushwarden/balance';
import { formatSoak, heapGrowth, salt, soak, soakRun, type SoakResult } from '../src/soak.js';

describe('soak', () => {
  it('plays full toy runs with every Phase 1 bot in turn, clean', () => {
    const samples: number[] = [];
    let gcs = 0;
    const r = soak({
      runs: 7,
      sampleEvery: 3,
      gc: () => gcs++,
      heapUsed: () => {
        samples.push(samples.length);
        return 1000 + samples.length;
      },
    });
    expect(r.failures).toEqual([]);
    expect(Object.keys(r.byBot)).toHaveLength(7);
    // Every run ends within the toy's 5 rounds.
    expect(r.rounds).toBeGreaterThanOrEqual(7);
    expect(r.rounds).toBeLessThanOrEqual(35);
    expect(r.ticks).toBeGreaterThan(0);
    expect(r.heap.map((h) => h.run)).toEqual([0, 3, 6, 7]);
    expect(gcs).toBe(4);
    expect(r.gcForced).toBe(true);
  });

  it('records a failing run with its seed, bot and round, and keeps going', () => {
    const broken: Bot = {
      ...randomBot,
      name: 'broken',
      plays: (state) => (state.round === 2 ? [{ type: 'go' }] : []),
    };
    const r = soak({ runs: 3, bots: [broken, greedyBot] });
    // Seeds 1 and 3 use the broken bot; "go" as a play leaves the round in a state where the
    // next "go" is refused (or the run ends first on approval).
    const seeds = r.failures.map((f) => f.seed);
    expect(seeds.every((s) => s === 1 || s === 3)).toBe(true);
    for (const f of r.failures) expect(f).toMatchObject({ bot: 'broken', round: 2 });
    expect(r.byBot['greedy-throughput']).toBe(1);
  });

  it('is deterministic for a seed and bot', () => {
    const a = soakRun(5, randomBot, 3, { round: 0 });
    const b = soakRun(5, randomBot, 3, { round: 0 });
    expect(b).toEqual(a);
  });

  it('rejects an empty bot list and a bad run count', () => {
    expect(() => soak({ runs: 1, bots: [] })).toThrow(/at least one bot/);
    expect(() => soak({ runs: 0 })).toThrow(/runs must be/);
  });

  it('uses the balance runner salt rule', () => {
    expect(salt('')).toBe(0);
    expect(salt('ab')).toBe((97 * 31 + 98) >>> 0);
  });
});

describe('memory and summary', () => {
  const base: SoakResult = {
    runs: 100,
    rounds: 420,
    ticks: 120000,
    wins: 40,
    gridlocks: 12,
    byBot: { random: 50, 'greedy-throughput': 50 },
    failures: [],
    heap: [
      { run: 0, bytes: 10 * 1048576 },
      { run: 50, bytes: 40 * 1048576 },
      { run: 100, bytes: 45 * 1048576 },
    ],
    gcForced: true,
  };

  it('measures growth from the first sample after warm-up', () => {
    expect(heapGrowth(base.heap, 50)).toEqual({
      base: 40 * 1048576,
      max: 45 * 1048576,
      growth: 5 * 1048576,
    });
    expect(heapGrowth(base.heap, 500)).toBeNull();
  });

  it('passes a clean, flat soak and fails on growth or a failure', () => {
    const opts = { commit: 'abc1234', seconds: 12, limitBytes: 32 * 1048576, warmupRuns: 50 };
    const ok = formatSoak(base, opts);
    expect(ok.pass).toBe(true);
    expect(ok.markdown).toMatch(/^# Soak: clean/);
    expect(ok.markdown).toContain('| 100 of 100 |');

    expect(formatSoak(base, { ...opts, limitBytes: 1048576 }).pass).toBe(false);
    expect(formatSoak({ ...base, gcForced: false }, opts).markdown).toContain('no forced GC');

    const failed = formatSoak(
      {
        ...base,
        failures: Array.from({ length: 51 }, (_, i) => ({
          seed: i + 1,
          bot: 'random',
          round: 3,
          error: 'a | b',
        })),
      },
      opts,
    );
    expect(failed.pass).toBe(false);
    expect(failed.markdown).toContain('# Soak: FAILED');
    expect(failed.markdown).toContain('| 1 | random | 3 | a \\| b |');
    expect(failed.markdown).toContain('…and 1 more.');
  });
});
