import { describe, expect, it } from 'vitest';
import { buildReport, dataWarnings, formatReport, BOT_NAMES, roundsOf } from '../src/balance.js';
import { greedyBot, phase1Bots } from '../src/bots.js';
import { draftedDelta, gateCriterion2, renderReport, summarizeDeck } from '../src/report.js';
import { runSeeds, seedSet } from '../src/runner.js';
import { record, scoredSpec } from './fixtures.js';

const scored = phase1Bots().flatMap((b) => runSeeds(scoredSpec(b), seedSet(12)));

describe('report', () => {
  it('has a stable format: the same records give byte-identical Markdown', async () => {
    const md = buildReport(scored, { preset: 'full', seeds: 12, commit: 'abc1234' });
    expect(buildReport(scored, { preset: 'full', seeds: 12, commit: 'abc1234' })).toBe(md);
    await expect(await formatReport(md)).toMatchFileSnapshot('./__snapshots__/report.scored.md');
  });

  it('has every §11 section', () => {
    const md = buildReport(scored, { preset: 'full', seeds: 12, commit: 'abc1234' });
    for (const h of [
      '## Gate criterion 2: archetype win rates (35–65%)',
      '## Win rate per bot',
      '## Cards: drafted win-rate delta and pick rate',
      '## Archetype purity vs win rate',
      '## Round-of-death histogram (lost runs)',
      '## Gridlock frequency',
      '## Top 20 decks (by wins)',
    ])
      expect(md).toContain(h);
  });

  it('gate criterion 2 is inclusive at 35% and 65%', () => {
    const recs = [
      ...['FLOW', 'MASS', 'TOLL', 'CHAOS'].flatMap((tag, i) => {
        const wins = [349, 350, 650, 651][i] ?? 0;
        return Array.from({ length: 1000 }, (_, s) =>
          record({ bot: `archetype(${tag})`, seed: s + 1, win: s < wins }),
        );
      }),
    ];
    const g = gateCriterion2(recs, [
      'random',
      'archetype(FLOW)',
      'archetype(MASS)',
      'archetype(TOLL)',
      'archetype(CHAOS)',
    ]);
    expect(g.map((x) => [x.tag, x.winPermille, x.pass])).toEqual([
      ['FLOW', 349, false],
      ['MASS', 350, true],
      ['TOLL', 650, true],
      ['CHAOS', 651, false],
    ]);
  });

  it('computes drafted deltas, round of death and gridlock rate from the records', () => {
    const recs = [
      record({
        bot: 'random',
        seed: 1,
        win: true,
        drafted: ['one-way'],
        offered: ['one-way', 'detour'],
        deck: ['one-way'],
      }),
      record({
        bot: 'random',
        seed: 2,
        win: false,
        rounds: 3,
        gridlockRounds: 1,
        offered: ['detour'],
      }),
    ];
    const md = renderReport(
      recs,
      { district: 1, rounds: 12, seeds: 2, bots: ['random'], commit: 'x', warnings: [] },
      new Map([
        ['detour', ['TOLL']],
        ['one-way', ['FLOW']],
      ]),
    );
    expect(md).toContain('| one-way | FLOW | 1 | 1 | 100.0% | 1 | 100.0% | +50.0 | no |');
    expect(md).toContain('| detour | TOLL | 2 | 0 | 0.0% | 0 | n/a | n/a | n/a |');
    expect(md).toContain('| 3 | 1 |');
    expect(md).toContain('| random | 15 | 1 | 6.7% |');
    expect(md).not.toContain('[!WARNING]');
  });

  it('computes the drafted delta within each bot, not against a pooled baseline', () => {
    // A weak bot that always drafts X and a strong bot that never does: pooling would call X a
    // −50 point card although no bot did better or worse with it. Against each bot's own
    // baseline it is 0.
    const pooledOnly = new Map([
      ['weak', [record({ bot: 'weak', seed: 1, win: false, drafted: ['x'] })]],
      ['strong', [record({ bot: 'strong', seed: 1, win: true })]],
    ]);
    expect(draftedDelta(pooledOnly, 'x')).toBe(0);
    expect(draftedDelta(pooledOnly, 'y')).toBeNull();
    // Bot a: drafted 1/2 wins vs baseline 1/4 (+250, weight 2); b: 0/1 vs 1/2 (−500, weight 1).
    const a = [
      record({ bot: 'a', seed: 1, win: true, drafted: ['x'] }),
      record({ bot: 'a', seed: 2, win: false, drafted: ['x'] }),
      record({ bot: 'a', seed: 3, win: false }),
      record({ bot: 'a', seed: 4, win: false }),
    ];
    const b = [
      record({ bot: 'b', seed: 1, win: false, drafted: ['x'] }),
      record({ bot: 'b', seed: 2, win: true }),
    ];
    expect(
      draftedDelta(
        new Map([
          ['a', a],
          ['b', b],
        ]),
        'x',
      ),
    ).toBe(0);
    expect(draftedDelta(new Map([['a', a]]), 'x')).toBe(250);
  });

  it('warns when every round scored zero (the stub sim) and always names the stand-ins', () => {
    const zero = [record({ bot: 'random', seed: 1, throughputs: [0, 0, 0] })];
    expect(dataWarnings(zero)).toHaveLength(1);
    expect(dataWarnings(scored)).toEqual([]);
    const md = buildReport(zero, { preset: 'toy', seeds: 1, commit: 'x' });
    expect(md).toContain('> [!WARNING]');
    expect(md).toContain('Every round scored 0 throughput');
    expect(md).toContain('known to be too easy');
    expect(md).toContain('#45 (3e2e67d)');
    expect(md).toContain('5-round runs');
    expect(roundsOf('full')).toBe(12);
  });

  it('reports throughput against quota per round over the runs that reached it', () => {
    const rs = [
      record({ bot: 'random', seed: 1, rounds: 2, throughputs: [30, 20], quotas: [20, 40] }),
      record({ bot: 'random', seed: 2, rounds: 1, throughputs: [10], quotas: [20] }),
    ];
    const md = renderReport(
      rs,
      { district: 1, rounds: 12, seeds: 2, bots: ['random'], commit: 'x', warnings: [] },
      new Map(),
    );
    expect(md).toContain('## Throughput vs quota per round');
    expect(md).toContain('| 1 | 2 | 20 | 10 | 50.0% | 50.0% | 50.0% | 50.0% |');
    expect(md).toContain('| 2 | 1 | 40 | 20 | 50.0% | 50.0% | 50.0% | 0.0% |');
  });

  it('summarizes decks as counts in id order', () => {
    expect(summarizeDeck(['one-way', 'detour', 'one-way'])).toBe('1× detour, 2× one-way');
    expect(BOT_NAMES).toContain(greedyBot.name);
  });
});
