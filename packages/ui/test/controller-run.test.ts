import { describe, expect, it } from 'vitest';
import { emptyMap } from '@rushwarden/sim';
import { targetKey } from '@rushwarden/render/core';
import { candidateTargets, markOf, segmentAt, toSimTarget } from '../src/run/controller-run.js';
import { devRun, result } from './helpers.js';

const kinds = (run: ReturnType<typeof devRun>, i: number): string =>
  run.state().hand[i]?.target ?? '';

/** First hand index whose card targets `kind` and has a valid target. */
function find(run: ReturnType<typeof devRun>, kind?: string): number {
  const s = run.state();
  return s.hand.findIndex(
    (_c, i) => (kind === undefined || kinds(run, i) === kind) && run.targets(i).length > 0,
  );
}

describe('ControllerRun (RunPort over the P1-BAL-01 run controller)', () => {
  it('starts round 1 of the 5-round toy with 5 cards, 3 energy and 3 approval', () => {
    const s = devRun(1).state();
    expect(s).toMatchObject({
      phase: 'place',
      round: 1,
      rounds: 5,
      energy: 3,
      maxEnergy: 3,
      approval: 3,
      maxApproval: 3,
      playsLeft: 2,
      district: 'Old Town',
      won: null,
      last: null,
    });
    expect(s.hand).toHaveLength(5);
    expect(s.quota).toBeGreaterThan(0);
    for (const c of s.hand) {
      expect(c.name).not.toBe(c.id);
      expect(c.text.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic from the seed', () => {
    const ids = (seed: number): string[] =>
      devRun(seed)
        .state()
        .hand.map((c) => c.id);
    expect(ids(7)).toEqual(ids(7));
  });

  it('caches the UI state until the controller state changes', () => {
    const run = devRun(1);
    expect(run.state()).toBe(run.state());
  });

  it('offers only targets the controller accepts, places, and undoes', () => {
    const run = devRun(2);
    const i = find(run);
    expect(i).toBeGreaterThanOrEqual(0);
    const card = run.state().hand[i]!;
    const target = run.targets(i)[0]!;
    run.place(i, target);
    expect(run.canUndo(0)).toBe(true);
    let s = run.state();
    expect(s.placed.map((p) => p.card.id)).toEqual([card.id]);
    expect(targetKey(s.placed[0]!.target)).toBe(targetKey(target));
    expect(s.hand).toHaveLength(4);
    expect(s.playsLeft).toBe(1);
    run.undo(0);
    s = run.state();
    expect(s.placed).toEqual([]);
    expect(s.hand).toHaveLength(5);
    expect(s.energy).toBe(3);
  });

  it('undoing the first of two plays keeps the second on its target', () => {
    const run = devRun(3);
    const a = find(run);
    run.place(a, run.targets(a)[0]!);
    // Not Recount: a redraw cannot be undone past (covered below).
    const b = run.state().hand.findIndex((c, i) => c.id !== 'recount' && run.targets(i).length > 0);
    if (b < 0) return; // no second play affordable on this seed
    const second = run.state().hand[b]!.id;
    const t2 = run.targets(b)[0]!;
    run.place(b, t2);
    run.undo(0);
    const s = run.state();
    expect(s.placed.map((p) => p.card.id)).toEqual([second]);
    expect(targetKey(s.placed[0]!.target)).toBe(targetKey(t2));
  });

  it('cannot undo past a Recount (ADR-018 point 8), and says so before the UI tries', () => {
    let run = devRun(1);
    let seed = 1;
    // A seed whose opening hand has Recount and another card with a target.
    for (; seed < 300; seed++) {
      run = devRun(seed);
      const ids = run.state().hand.map((c) => c.id);
      const other = run
        .state()
        .hand.findIndex((c, i) => c.id !== 'recount' && run.targets(i).length > 0);
      if (ids.includes('recount') && other >= 0) break;
    }
    expect(seed).toBeLessThan(300);
    const other = run
      .state()
      .hand.findIndex((c, i) => c.id !== 'recount' && run.targets(i).length > 0);
    run.place(other, run.targets(other)[0]!);
    expect(run.canUndo(0)).toBe(true);
    const r = run.state().hand.findIndex((c) => c.id === 'recount');
    run.place(r, { kind: 'district' });
    const before = run.state();
    expect(before.placed.map((p) => p.card.id).at(-1)).toBe('recount');
    expect(run.canUndo(0)).toBe(false);
    expect(run.canUndo(1)).toBe(false);
    run.undo(0);
    run.undo(1);
    expect(run.state()).toBe(before);
    expect(run.canUndo(5)).toBe(false);
  });

  it('refuses a placement the controller rejects', () => {
    const run = devRun(1);
    expect(() => run.place(0, { kind: 'edge', edge: 999 })).toThrow();
    expect(() => run.place(99, { kind: 'district' })).toThrow();
  });

  it('runs Go through the worker path: roundInput() out, resolve(result) in', () => {
    const tracked: string[] = [];
    const run = devRun(1, { track: (e) => tracked.push(e) });
    const input = run.roundInput();
    expect(input.map.id).toBe(emptyMap().id);
    expect(input.demandProfile.length).toBeGreaterThan(0);
    run.go();
    expect(run.state().phase).toBe('go');
    expect(run.targets(0)).toEqual([]);
    const quota = run.state().quota;
    run.finishRound(result(quota * 2));
    const s = run.state();
    expect(s.phase).toBe('result');
    expect(s.last).toMatchObject({ round: 1, pass: true, hash: '0123456789abcdef' });
    expect(s.offer).toHaveLength(3);
    expect(s.history).toEqual(['pass']);
    expect(tracked).toEqual(['run_start', 'round_end']);
    run.pickOffer(1);
    expect(run.state()).toMatchObject({ phase: 'place', round: 2 });
  });

  it('ignores a result outside Go, and skips an offer for funds', () => {
    const run = devRun(1);
    run.finishRound(result(1));
    expect(run.state().phase).toBe('place');
    run.go();
    run.finishRound(result(run.state().quota));
    const funds = run.state().funds;
    run.pickOffer(null);
    expect(run.state().funds).toBe(funds + 2);
  });

  it('loses approval on a miss, ends the run at zero, and retries with a new seed', () => {
    const tracked: string[] = [];
    const run = devRun(5, { track: (e) => tracked.push(e) });
    for (let r = 0; r < 3; r++) {
      run.go();
      run.finishRound(result(0, r === 2));
      if (run.state().phase === 'result') {
        expect(run.state().offer).toBeNull();
        run.next();
      }
    }
    const s = run.state();
    expect(s).toMatchObject({ phase: 'end', won: false, approval: 0 });
    expect(s.history).toEqual(['fail', 'fail', 'gridlock']);
    expect(tracked.at(-1)).toBe('run_end');
    run.retry();
    expect(run.runSeed).toBe(6);
    expect(run.state()).toMatchObject({ phase: 'place', round: 1, approval: 3 });
  });

  it('wins after the last round', () => {
    const run = devRun(1);
    for (let r = 1; r <= 5; r++) {
      run.go();
      run.finishRound(result(run.state().quota * 2));
      if (run.state().phase === 'result') run.pickOffer(null);
    }
    expect(run.state()).toMatchObject({ phase: 'end', won: true });
    expect(run.state().totalThroughput).toBeGreaterThan(0);
    expect(run.controller.actions.length).toBeGreaterThan(0);
  });
});

describe('targets and marks', () => {
  const map = emptyMap();

  it('lists candidates per target kind', () => {
    expect(candidateTargets('district', map)).toEqual([{ kind: 'district' }]);
    expect(candidateTargets('intersection', map)).toEqual([{ kind: 'intersection', x: 3, y: 4 }]);
    expect(candidateTargets('edge', map)).toHaveLength(map.edges.length);
    expect(candidateTargets('segment', map).length).toBeGreaterThan(4);
  });

  it('turns a tapped road tile into its straight segment between nodes', () => {
    expect(segmentAt(map, 3, 1)).toEqual({
      kind: 'segment',
      from: { x: 3, y: 0 },
      to: { x: 3, y: 3 },
    });
    expect(segmentAt(map, 5, 4)).toEqual({
      kind: 'segment',
      from: { x: 4, y: 4 },
      to: { x: 6, y: 4 },
    });
    expect(toSimTarget({ kind: 'edge', edge: 2 }, map)).toEqual({ kind: 'edge', edge: 2 });
    expect(toSimTarget({ kind: 'district' }, map)).toEqual({ kind: 'district' });
    expect(toSimTarget({ kind: 'intersection', x: 3, y: 4 }, map)).toEqual({
      kind: 'intersection',
      tile: { x: 3, y: 4 },
    });
  });

  it('marks rounds with the §5 share glyphs', () => {
    const o = { pass: true, gridlocked: false, throughput: 30, quota: 26 };
    expect(markOf(o)).toBe('pass');
    expect(markOf({ ...o, throughput: 28 })).toBe('near');
    expect(markOf({ ...o, pass: false })).toBe('fail');
    expect(markOf({ ...o, gridlocked: true })).toBe('gridlock');
  });
});
