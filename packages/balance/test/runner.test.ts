import { describe, expect, it } from 'vitest';
import { greedyBot, phase1Bots, randomBot } from '../src/bots.js';
import { runJob, splitJobs, specFor } from '../src/jobs.js';
import { runJobs } from '../src/pool.js';
import { canonical, runOne, runSeeds, seedSet } from '../src/runner.js';
import { scoredSpec } from './fixtures.js';

const BOTS = phase1Bots().map((b) => b.name);

describe('runner', () => {
  it('is deterministic: the same (bot, seed) gives an identical record', () => {
    for (const bot of phase1Bots())
      for (const seed of [1, 7, 42])
        expect(runOne(scoredSpec(bot), seed)).toEqual(runOne(scoredSpec(bot), seed));
  });

  it('records rounds, gridlocks, watch ticks, offers and drafts consistently', () => {
    // The fake sim gridlocks (120 ticks instead of 300) on round seeds ending in 0.
    const runs = seedSet(10).map((seed) => runOne(scoredSpec(greedyBot), seed));
    for (const r of runs) expect(r.ticks).toBe(300 * r.rounds - 180 * r.gridlockRounds);
    expect(runs.some((r) => r.gridlockRounds > 0)).toBe(true);
    const s = runOne(scoredSpec(greedyBot), 3);
    expect(s.offered.length % 3).toBe(0);
    for (const id of s.drafted) expect(s.offered).toContain(id);
    expect(s.deck).toEqual([...s.deck].sort());
  });

  it('a bot run does not depend on which other bots or seeds ran before it', () => {
    const alone = runOne(scoredSpec(randomBot), 5);
    runSeeds(scoredSpec(greedyBot), [1, 2, 3]);
    expect(runSeeds(scoredSpec(randomBot), [4, 5]).at(1)).toEqual(alone);
  });

  it('uses the fixed seed set 1..n', () => {
    expect(seedSet(4)).toEqual([1, 2, 3, 4]);
  });

  it('canonical order is bot order, then seed', () => {
    const recs = [
      { bot: 'b', seed: 2 },
      { bot: 'a', seed: 3 },
      { bot: 'b', seed: 1 },
      { bot: 'a', seed: 1 },
    ] as never[];
    expect(
      canonical(recs, ['a', 'b']).map((r: { bot: string; seed: number }) => `${r.bot}${r.seed}`),
    ).toEqual(['a1', 'a3', 'b1', 'b2']);
  });
});

describe('jobs and parallel scheduling', () => {
  const seeds = seedSet(7);
  const serial = BOTS.flatMap((b) =>
    runSeeds(specFor({ bot: b, seeds, preset: 'toy', targetsPerKind: 3 }), seeds),
  );

  it('splits (bot × seeds) into chunks that cover every run once', () => {
    const jobs = splitJobs(BOTS, seeds, 'toy', 3, 3);
    expect(jobs).toHaveLength(BOTS.length * 3);
    expect(jobs.flatMap((j) => j.seeds.map((s) => `${j.bot}:${s}`))).toHaveLength(BOTS.length * 7);
    expect(() => splitJobs(BOTS, seeds, 'toy', 3, 0)).toThrow(RangeError);
  });

  it('gives the serial records for any chunk size and concurrency, in canonical order', async () => {
    for (const chunk of [1, 3, 7])
      for (const concurrency of [1, 4]) {
        // Out-of-order completion: later jobs resolve first.
        let n = 0;
        const exec = async (j: Parameters<typeof runJob>[0]) => {
          const delay = 5 - (n++ % 5);
          await new Promise((r) => setTimeout(r, delay));
          // Replays the serial records: this checks scheduling and ordering, not the runs
          // themselves (real content runs are too slow to replay 6 times under coverage).
          return serial.filter((r) => r.bot === j.bot && j.seeds.includes(r.seed));
        };
        const got = await runJobs(splitJobs(BOTS, seeds, 'toy', 3, chunk), concurrency, exec, BOTS);
        expect(got).toEqual(serial);
      }
    // And one real parallel pass: chunked jobs played for real give the serial records.
    const real = await runJobs(
      splitJobs(BOTS, seeds, 'toy', 3, 3),
      4,
      async (j) => runJob(j),
      BOTS,
    );
    expect(real).toEqual(serial);
  });

  it('reports progress per job', async () => {
    const seen: string[] = [];
    await runJobs(
      splitJobs(['random'], seeds, 'toy', 3, 4),
      2,
      async (j) => runJob(j),
      ['random'],
      (d, n) => seen.push(`${d}/${n}`),
    );
    expect(seen).toEqual(['1/2', '2/2']);
  });

  it('the toy preset plays 5-round runs and the full preset 12', () => {
    const toy = runJob({ bot: 'random', seeds: [1], preset: 'toy', targetsPerKind: 3 })[0];
    expect(toy?.rounds).toBeLessThanOrEqual(5);
    const full = specFor({ bot: 'random', seeds: [1], preset: 'full', targetsPerKind: 3 }).config(
      1,
    );
    expect(full.rounds).toBe(12);
  });
});
