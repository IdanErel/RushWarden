import { describe, expect, it } from 'vitest';
import { buildReport, dataWarnings, formatReport, BOT_NAMES, roundsOf } from '../src/balance.js';
import { greedyBot, phase1Bots } from '../src/bots.js';
import { gateCriterion2, renderReport, summarizeDeck } from '../src/report.js';
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

  it('warns when every round scored zero (the stub sim) and always names the stand-ins', () => {
    const zero = [record({ bot: 'random', seed: 1, throughputs: [0, 0, 0] })];
    expect(dataWarnings(zero)).toHaveLength(1);
    expect(dataWarnings(scored)).toEqual([]);
    const md = buildReport(zero, { preset: 'toy', seeds: 1, commit: 'x' });
    expect(md).toContain('> [!WARNING]');
    expect(md).toContain('Every round scored 0 throughput');
    expect(md).toContain('Pre-tuning content');
    expect(md).toContain('5-round runs');
    expect(roundsOf('full')).toBe(12);
  });

  it('summarizes decks as counts in id order', () => {
    expect(summarizeDeck(['one-way', 'detour', 'one-way'])).toBe('1× detour, 2× one-way');
    expect(BOT_NAMES).toContain(greedyBot.name);
  });
});
