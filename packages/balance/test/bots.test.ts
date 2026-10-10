import { describe, expect, it } from 'vitest';
import { emptyMap } from '@rushwarden/sim';
import {
  ARCHETYPE_TAGS,
  archetypeBot,
  botByName,
  greedyBot,
  phase1Bots,
  randomBot,
} from '../src/bots.js';
import { runOne } from '../src/runner.js';
import { candidateTargets, spread } from '../src/targets.js';
import { STANDIN_CARDS } from '../src/standin-cards.js';
import { scoredSpec } from './fixtures.js';

const tagsOf = new Map(STANDIN_CARDS.map((c) => [c.id, c.tags as readonly string[]]));

describe('bots', () => {
  it('has the §11 Phase 1 bots in report order and finds them by name', () => {
    expect(phase1Bots().map((b) => b.name)).toEqual([
      'random',
      'greedy-throughput',
      'archetype(FLOW)',
      'archetype(MASS)',
      'archetype(TOLL)',
      'archetype(CHAOS)',
      'archetype(TEMPO)',
    ]);
    expect(botByName('greedy-throughput')).toBe(greedyBot);
    expect(() => botByName('mcts-lite')).toThrow(/unknown bot/);
  });

  it('every bot plays full runs with only legal actions (the runner throws otherwise)', () => {
    for (const bot of phase1Bots())
      for (const seed of [1, 2, 3, 10]) {
        const r = runOne(scoredSpec(bot), seed);
        expect(r.rounds).toBeGreaterThan(0);
        expect(r.rounds).toBeLessThanOrEqual(12);
        expect(r.throughputs).toHaveLength(r.rounds);
        expect(r.deck.length).toBeGreaterThanOrEqual(12 - 1);
      }
  });

  it('archetype(tag) drafts only cards carrying its tag', () => {
    for (const tag of ARCHETYPE_TAGS) {
      const drafted = [1, 2, 3, 4, 5, 6].flatMap(
        (s) => runOne(scoredSpec(archetypeBot(tag)), s).drafted,
      );
      for (const id of drafted) expect(tagsOf.get(id)).toContain(tag);
    }
  });

  it('greedy drafts and wins more than random on a sim that rewards playing cards', () => {
    const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
    const wins = (b: typeof randomBot): number =>
      seeds.filter((s) => runOne(scoredSpec(b), s).win).length;
    expect(wins(greedyBot)).toBeGreaterThan(wins(randomBot));
    expect(seeds.some((s) => runOne(scoredSpec(greedyBot), s).drafted.length > 0)).toBe(true);
  });
});

describe('targets', () => {
  it('lists intersections, segments, edges and the district of a map in a fixed order', () => {
    const t = candidateTargets(emptyMap());
    expect(t.intersection.length).toBeGreaterThan(0);
    expect(t.segment.length).toBeGreaterThan(0);
    expect(t.edge.length).toBe(emptyMap().edges.length);
    expect(t.district).toEqual([{ kind: 'district' }]);
    expect(candidateTargets(emptyMap())).toEqual(t);
  });

  it('spreads evenly and keeps short lists whole', () => {
    expect(spread([1, 2], 3)).toEqual([1, 2]);
    expect(spread([0, 1, 2, 3, 4, 5, 6, 7, 8], 3)).toEqual([0, 3, 6]);
  });
});
