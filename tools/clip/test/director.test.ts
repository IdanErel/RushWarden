import { describe, expect, it } from 'vitest';
import { Sim } from '@rushwarden/sim';
import { candidateTargets, planRun, replayTo, rushRound, toyConfig } from '../src/director.ts';
import { startRun } from '@rushwarden/app';
import { setupRound } from '@rushwarden/content';

describe('clip director', () => {
  it('shows the toy rush round by default: round 5, Market Day (ADR-007)', () => {
    expect(rushRound(toyConfig(1))).toBe(5);
    const p = planRun({ seed: 4 });
    expect(p).toMatchObject({ round: 5, rush: true, boss: 'market-day' });
    expect(p.input.districtRules).toMatchObject({ round: 5, rush: true, boss: 'market-day' });
  });

  it('is deterministic: the same seed gives the same actions and round', () => {
    const a = planRun({ seed: 4 });
    const b = planRun({ seed: 4 });
    expect(b.actions).toEqual(a.actions);
    expect(Sim.simulate(b.input).finalHash).toBe(Sim.simulate(a.input).finalHash);
  });

  it('plays only cards that raise the round, and none with plays: none', () => {
    const played = planRun({ seed: 4 });
    const none = planRun({ seed: 4, plays: 'none' });
    expect(none.cardsPlayed).toEqual([]);
    expect(played.cardsPlayed.length).toBeGreaterThan(0);
    expect(played.cardsPlayed.length).toBeLessThanOrEqual(2);
    expect(Sim.simulate(played.input).throughput).toBeGreaterThan(
      Sim.simulate(none.input).throughput,
    );
  });

  it('replays a recorded action list to the same round (the sidecar path)', () => {
    const a = planRun({ seed: 4 });
    // Actions belong to their seed: another seed deals other hands, and the replay refuses.
    expect(() => planRun({ seed: 999, actions: a.actions })).toThrow(/replay refused/);
    const c = planRun({ seed: 4, actions: a.actions });
    expect(c.cardsPlayed).toEqual(a.cardsPlayed);
    expect(Sim.simulate(c.input).finalHash).toBe(Sim.simulate(a.input).finalHash);
    expect(replayTo(toyConfig(4), a.actions).round).toBe(5);
  });

  it('can show an earlier round', () => {
    const p = planRun({ seed: 4, round: 1 });
    expect(p).toMatchObject({ round: 1, rush: false, boss: null });
    expect(p.actions.every((a) => a.type === 'play')).toBe(true);
  });

  it('rejects rounds outside the run and actions that stop elsewhere', () => {
    expect(() => planRun({ seed: 4, round: 6 })).toThrow(/round must be 1..5/);
    expect(() => planRun({ seed: 4, round: 0 })).toThrow(/round must be/);
    expect(() => planRun({ seed: 4, round: 2, actions: [] })).toThrow(/end in round 1/);
  });

  it('offers every target kind in a fixed order', () => {
    const s = startRun(toyConfig(4), { setupRound }).state;
    expect(candidateTargets('district', s)).toEqual([{ kind: 'district' }]);
    expect(candidateTargets('edge', s)).toHaveLength(s.map.edges.length);
    const ix = candidateTargets('intersection', s);
    expect(ix.length).toBeGreaterThanOrEqual(4);
    expect(ix.length).toBeLessThanOrEqual(6);
    const seg = candidateTargets('segment', s);
    expect(seg.length % 2).toBe(0);
    expect(candidateTargets('segment', s)).toEqual(seg);
  });
});
