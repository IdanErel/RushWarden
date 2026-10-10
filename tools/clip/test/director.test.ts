import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GRID_WIDTH, Sim } from '@rushwarden/sim';
import {
  MARKET_DAY_SEED,
  candidateTargets,
  planRun,
  replayTo,
  rushRound,
  toyConfig,
} from '../src/director.ts';
import { reverseSegment, segmentAt, segmentRuns, startRun } from '@rushwarden/app';
import { setupRound } from '@rushwarden/content';

describe('clip director', () => {
  it('shows the toy rush round by default: round 5, Market Day (ADR-007)', () => {
    expect(rushRound(toyConfig(1))).toBe(5);
    const p = planRun({ seed: MARKET_DAY_SEED });
    expect(p).toMatchObject({ round: 5, rush: true, boss: 'market-day' });
    expect(p.input.districtRules).toMatchObject({ round: 5, rush: true, boss: 'market-day' });
  });

  it('is deterministic: the same seed gives the same actions and round', () => {
    const a = planRun({ seed: MARKET_DAY_SEED });
    const b = planRun({ seed: MARKET_DAY_SEED });
    expect(b.actions).toEqual(a.actions);
    expect(Sim.simulate(b.input).finalHash).toBe(Sim.simulate(a.input).finalHash);
  });

  it('plays only cards that raise the round, and none with plays: none', () => {
    const played = planRun({ seed: MARKET_DAY_SEED });
    const none = planRun({ seed: MARKET_DAY_SEED, plays: 'none' });
    expect(none.cardsPlayed).toEqual([]);
    expect(played.cardsPlayed.length).toBeGreaterThan(0);
    expect(played.cardsPlayed.length).toBeLessThanOrEqual(2);
    expect(Sim.simulate(played.input).throughput).toBeGreaterThan(
      Sim.simulate(none.input).throughput,
    );
  });

  it('replays a recorded action list to the same round (the sidecar path)', () => {
    const a = planRun({ seed: MARKET_DAY_SEED });
    // Actions belong to their seed: another seed deals other hands and maps, and the replay
    // stops. It is refused by `step`, or, for an intersection target on a tile that is not one
    // on that map, thrown by the sim (placement validation checks only the bounds there).
    expect(() => planRun({ seed: 999, actions: a.actions })).toThrow(
      /replay refused|no intersection at/,
    );
    const c = planRun({ seed: MARKET_DAY_SEED, actions: a.actions });
    expect(c.cardsPlayed).toEqual(a.cardsPlayed);
    expect(Sim.simulate(c.input).finalHash).toBe(Sim.simulate(a.input).finalHash);
    expect(replayTo(toyConfig(MARKET_DAY_SEED), a.actions).round).toBe(5);
  });

  it('can show an earlier round', () => {
    const p = planRun({ seed: MARKET_DAY_SEED, round: 1 });
    expect(p).toMatchObject({ round: 1, rush: false, boss: null });
    expect(p.actions.every((a) => a.type === 'play')).toBe(true);
  });

  it('rejects rounds outside the run and actions that stop elsewhere', () => {
    expect(() => planRun({ seed: MARKET_DAY_SEED, round: 6 })).toThrow(/round must be 1..5/);
    expect(() => planRun({ seed: MARKET_DAY_SEED, round: 0 })).toThrow(/round must be/);
    expect(() => planRun({ seed: MARKET_DAY_SEED, round: 2, actions: [] })).toThrow(
      /end in round 1/,
    );
  });

  it('offers every target kind in a fixed order', () => {
    const s = startRun(toyConfig(MARKET_DAY_SEED), { setupRound }).state;
    expect(candidateTargets('district', s)).toEqual([{ kind: 'district' }]);
    expect(candidateTargets('edge', s)).toHaveLength(s.map.edges.length);
    const ix = candidateTargets('intersection', s);
    expect(ix.length).toBeGreaterThanOrEqual(4);
    expect(ix.length).toBeLessThanOrEqual(6);
    const seg = candidateTargets('segment', s);
    expect(candidateTargets('segment', s)).toEqual(seg);
  });

  it('offers what a tap places, both ways round (ADR-031), each target once', () => {
    const s = startRun(toyConfig(MARKET_DAY_SEED), { setupRound }).state;
    const seg = candidateTargets('segment', s).flatMap((t) => (t.kind === 'segment' ? [t] : []));
    const key = (t: (typeof seg)[number]): string => `${t.from.x},${t.from.y}>${t.to.x},${t.to.y}`;
    const keys = new Set(seg.map(key));
    expect(keys.size).toBe(seg.length);
    // Every run the run screen places on a tap is offered, and its reverse when it is longer than
    // one tile (One-Way needs from != to).
    const runs = segmentRuns(s.map).flatMap((t) => (t.kind === 'segment' ? [t] : []));
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) {
      expect(keys.has(key(r))).toBe(true);
      if (r.from.x !== r.to.x || r.from.y !== r.to.y)
        expect(keys.has(key({ ...r, from: r.to, to: r.from }))).toBe(true);
    }
    expect(seg.length).toBe(
      runs.reduce((n, r) => n + (r.from.x !== r.to.x || r.from.y !== r.to.y ? 2 : 1), 0),
    );
    // Nothing a player cannot place: every target is the run a tap on one of its tiles places,
    // or that run reversed.
    const placeable = new Set<string>();
    s.map.tiles.forEach((tile, i) => {
      if (tile.kind !== 'road') return;
      const tap = segmentAt(s.map, i % GRID_WIDTH, Math.floor(i / GRID_WIDTH));
      if (tap.kind !== 'segment') return;
      const back = reverseSegment(tap);
      placeable.add(key(tap));
      if (back.kind === 'segment') placeable.add(key(back));
    });
    for (const t of seg) expect(placeable.has(key(t)), key(t)).toBe(true);
  });

  it('plays One-Way when it helps (it needs a segment with from != to)', () => {
    const plays = [1, 2, 3].flatMap((seed) => planRun({ seed }).cardsPlayed);
    expect(plays).toContain('one-way');
  });

  it('keeps the clip specs on MARKET_DAY_SEED', () => {
    const dir = fileURLToPath(new URL('../clips/', import.meta.url));
    for (const f of ['market-day.json', 'market-day-none.json'])
      expect(JSON.parse(readFileSync(dir + f, 'utf8'))).toMatchObject({ seed: MARKET_DAY_SEED });
  });
});
