import { describe, expect, it } from 'vitest';
import { emptyMap, type Effect, type SegmentId, type Target } from '@rushwarden/sim';
import {
  RUSH_ROUNDS,
  TOY_EXCLUDED_CARDS,
  TOY_ROUNDS,
  roundQuota,
  setupRound,
  toyRushRounds,
} from '@rushwarden/content';
import {
  PHASE1_STARTING_DECK,
  RunController,
  buildOffer,
  costOf,
  deckOf,
  fullRunConfig,
  isNextRoundOnly,
  replay,
  roundInput,
  runEffectError,
  sameTarget,
  startRun,
  step,
  toyRunConfig,
  type RunAction,
  type RunCard,
  type RunConfig,
  type RunEnv,
  type RunState,
} from '../src/index.js';
import { CARDS, CENTER, DISTRICT, EDGE, SEGMENT, fakeEnv } from './run-fixtures.js';

/**
 * The mechanics fixture: a 5-round District 1 run on the plain curve (round r plays curve round
 * r; Market Day on round 5; no template factor; the full Phase 1 deck and card pool), so these tests
 * do not move when content retunes the toy's curve or its cards. The toy preset itself (ADR-030:
 * content's TOY_ROUNDS; ADR-032: its card exclusions) is tested in "the itch toy preset".
 */
const toy = (seed = 1, over: Partial<RunConfig> = {}): RunConfig => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { curveRounds, templateDemand, ...preset } = toyRunConfig({ seed, cards: CARDS });
  return {
    ...preset,
    startingDeck: PHASE1_STARTING_DECK,
    cards: CARDS,
    rushRounds: [{ round: 5, boss: 'market-day' }],
    ...over,
  };
};

function must(state: RunState, action: RunAction, env: RunEnv = fakeEnv()): RunState {
  const r = step(state, action, env);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

/** A state whose hand is exactly `ids` (tier 1), for effect tests. */
function withHand(state: RunState, ids: string[], tier: 1 | 2 = 1): RunState {
  return { ...state, hand: ids.map((id, i) => ({ uid: 1000 + i, id, tier })) };
}

function targetFor(id: string): Target {
  const kind = CARDS.find((c) => c.id === id)?.target;
  return kind === 'intersection'
    ? CENTER
    : kind === 'segment'
      ? SEGMENT
      : kind === 'edge'
        ? EDGE
        : DISTRICT;
}

const playId = (
  s: RunState,
  id: string,
  extra: Partial<Extract<RunAction, { type: 'play' }>> = {},
) =>
  step(
    s,
    {
      type: 'play',
      handIndex: s.hand.findIndex((c) => c.id === id),
      target: targetFor(id),
      ...extra,
    },
    fakeEnv(),
  );

describe('start of a run (GDD §2, §4; ADR-007)', () => {
  it('deals hand 5, energy 3, approval 3, round 1 of 5, and emits run_start', () => {
    const { state, events } = startRun(toy(), fakeEnv());
    expect(state.hand).toHaveLength(5);
    expect(state.energy).toBe(3);
    expect(state.approval).toBe(3);
    expect(state.round).toBe(1);
    expect(state.quota).toBe(roundQuota(1, 1, false));
    expect(deckOf(state)).toHaveLength(12);
    expect(events).toEqual([
      { event: 'run_start', props: { mayor: 'ada', district: 1, daily: false } },
    ]);
  });

  it('uses the Phase 1 starting deck (Grant replaced by Pilot Program)', () => {
    expect(PHASE1_STARTING_DECK).toHaveLength(12);
    expect(PHASE1_STARTING_DECK).toContain('pilot-program');
    expect(PHASE1_STARTING_DECK).not.toContain('grant');
  });

  it('rejects an unknown card in the starting deck', () => {
    expect(() => startRun(toy(1, { startingDeck: ['nope'] }), fakeEnv())).toThrow(/unknown card/);
  });
});

describe('determinism', () => {
  const actions: RunAction[] = [
    { type: 'go' },
    { type: 'choose', pick: 0 },
    { type: 'go' },
    { type: 'choose', pick: 'skip' },
    { type: 'go' },
  ];

  it('the same seed and actions give the same run; another seed differs', () => {
    const a = replay(toy(7), actions, fakeEnv());
    const b = replay(toy(7), actions, fakeEnv());
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
    const c = replay(toy(8), actions, fakeEnv());
    expect(c.state.drawPile.map((x) => x.uid)).not.toEqual(a.state.drawPile.map((x) => x.uid));
  });

  it('never mutates a state it returned (undo and replay rely on it)', () => {
    const { state } = startRun(toy(3), fakeEnv());
    const before = JSON.stringify({ ...state, prng: [...state.prng.s] });
    must(state, { type: 'go' });
    expect(JSON.stringify({ ...state, prng: [...state.prng.s] })).toBe(before);
  });

  it('builds each round input from the run state and a per-round seed', () => {
    const env = fakeEnv();
    const s = must(
      startRun(toy(5), env).state,
      { type: 'play', handIndex: 0, target: targetFor(startRun(toy(5), env).state.hand[0]!.id) },
      env,
    );
    must(s, { type: 'go' }, env);
    const input = env.inputs[0]!;
    expect(input.seed).toBe(s.roundSeed);
    expect(input.placements).toHaveLength(1);
    expect(input.districtRules).toMatchObject({
      district: 1,
      round: 1,
      rush: false,
      boss: null,
      quota: roundQuota(1, 1, false),
    });
    expect(Number.isInteger(input.seed) && input.seed >= 0 && input.seed < 2 ** 32).toBe(true);
  });
});

describe('round setup reaches the sim (p_slow, Parade closures)', () => {
  it('passes districtRules.pSlowPermille and closedSegments from setupRound into roundInput', () => {
    const closed = { from: SEGMENT.from, to: SEGMENT.to };
    const base = fakeEnv();
    const env = {
      ...base,
      setupRound: (a: Parameters<typeof base.setupRound>[0]) => ({
        ...base.setupRound(a),
        districtRules: { pSlowPermille: a.round === 2 ? 150 : 0 },
        closedSegments: a.round === 2 ? [closed] : [],
      }),
    };
    let s = startRun(toy(3), env).state;
    expect(roundInput(s).districtRules.pSlowPermille).toBe(0);
    expect('closedSegments' in roundInput(s)).toBe(false);
    s = must(must(s, { type: 'go' }, env), { type: 'choose', pick: 'skip' }, env);
    expect(s.round).toBe(2);
    expect(roundInput(s).districtRules.pSlowPermille).toBe(150);
    expect(roundInput(s).closedSegments).toEqual([closed]);
    // The real Sim accepts the round with the closure and p_slow.
    const real = { setupRound: env.setupRound };
    expect(step({ ...s, plays: [] }, { type: 'go' }, real).ok).toBe(true);
  });

  it('defaults to p_slow 0 and no closures when setupRound gives neither', () => {
    const s = startRun(toy(3), fakeEnv()).state;
    expect(s.pSlowPermille).toBe(0);
    expect(s.closedSegments).toEqual([]);
  });
});

describe('quota (content roundQuota, ADR-018)', () => {
  it("uses content's roundQuota with the mayor's modifier", () => {
    const plain = startRun(toy(3), fakeEnv()).state;
    expect(plain.quota).toBe(roundQuota(1, 1, false));
    const mayor = startRun({ ...toy(3), quotaPermille: 1150 }, fakeEnv()).state;
    expect(mayor.quota).toBe(roundQuota(1, 1, false, 1150));
    // 83 * 1.15 = 95.45 (P1-CON-05's District 1 base).
    expect(mayor.quota).toBe(95);
  });
});

describe('placement rules', () => {
  it('allows at most 2 plays and spends energy', () => {
    let s = withHand(startRun(toy(), fakeEnv()).state, [
      'fare-holiday',
      'detour',
      'turn-lane',
      'smart-signal',
    ]);
    s = (playId(s, 'fare-holiday') as { state: RunState }).state;
    s = (playId(s, 'detour') as { state: RunState }).state;
    expect(s.energy).toBe(1);
    expect(playId(s, 'turn-lane')).toEqual({ ok: false, error: 'no plays left this round' });
    expect(s.hand.map((c) => c.id)).toEqual(['turn-lane', 'smart-signal']);
  });

  it('refuses a play without enough energy, a wrong target kind, or a bad index', () => {
    const s = withHand({ ...startRun(toy(), fakeEnv()).state, energy: 1 }, ['bus-lane', 'detour']);
    expect(playId(s, 'bus-lane')).toEqual({ ok: false, error: 'not enough energy' });
    expect(step(s, { type: 'play', handIndex: 1, target: DISTRICT }, fakeEnv())).toEqual({
      ok: false,
      error: 'detour targets edge',
    });
    expect(step(s, { type: 'play', handIndex: 9, target: DISTRICT }, fakeEnv()).ok).toBe(false);
  });

  it('undo restores the state before the last play, including the PRNG', () => {
    const s0 = withHand(startRun(toy(), fakeEnv()).state, ['detour', 'turn-lane']);
    const s1 = (playId(s0, 'detour') as { state: RunState }).state;
    const back = must(s1, { type: 'undo' });
    expect(back).toBe(s0);
    expect(step(s0, { type: 'undo' }, fakeEnv()).ok).toBe(false);
  });

  it('no undo past a redraw, so the draw pile is never revealed for free (ADR-018 point 8)', () => {
    let s = withHand(startRun(toy(), fakeEnv()).state, ['detour', 'recount', 'turn-lane']);
    s = (playId(s, 'detour') as { state: RunState }).state;
    s = (playId(s, 'recount') as { state: RunState }).state;
    expect(step(s, { type: 'undo' }, fakeEnv())).toEqual({ ok: false, error: 'nothing to undo' });
  });

  it('refuses a placement the sim would reject, so Go never throws (ADR-014)', () => {
    const expressStop: RunCard = {
      id: 'express-stop',
      cost: 1,
      target: 'segment',
      duration: 'round',
      rarity: 'common',
      tags: ['MASS'],
      effects: [{ kind: 'setBusStopDwell', dwellTicks: 2 }],
      upgrade: {},
    };
    const rerouteTo: RunCard = {
      ...expressStop,
      id: 'detour-pick',
      target: 'edge',
      tags: ['TOLL'],
      effects: [{ kind: 'reroute', percent: 50, to: 'secondary' }],
    };
    const env = { setupRound: fakeEnv().setupRound };
    const s0 = startRun(toy(1, { cards: [...CARDS, expressStop, rerouteTo] }), env).state;
    const s = withHand(s0, ['detour', 'one-way', 'express-stop', 'detour-pick']);
    const bad: [number, Target][] = [
      [0, { kind: 'edge', edge: 99 }],
      [1, { kind: 'segment', from: { x: 0, y: 0 }, to: { x: 2, y: 3 } }],
      [2, SEGMENT],
      [3, EDGE],
    ];
    for (const [handIndex, target] of bad) {
      const r = step(s, { type: 'play', handIndex, target }, env);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }
    // The refused plays left the state unchanged, and the real Sim accepts the round.
    expect(s.plays).toEqual([]);
    expect(step(s, { type: 'go' }, env).ok).toBe(true);
  });

  it('compares targets structurally: key order and segment direction do not matter', () => {
    expect(
      sameTarget({ kind: 'intersection', tile: { x: 3, y: 4 } }, {
        tile: { y: 4, x: 3 },
        kind: 'intersection',
      } as Target),
    ).toBe(true);
    expect(sameTarget(SEGMENT, { kind: 'segment', from: SEGMENT.to, to: SEGMENT.from })).toBe(true);
    expect(sameTarget(SEGMENT, { kind: 'segment', from: SEGMENT.from, to: { x: 3, y: 2 } })).toBe(
      false,
    );
    expect(sameTarget(EDGE, { kind: 'edge', edge: 1 })).toBe(false);
    expect(sameTarget(DISTRICT, { kind: 'district' })).toBe(true);
    expect(sameTarget(CENTER, DISTRICT)).toBe(false);
    let s = withHand(startRun(toy(), fakeEnv()).state, ['smart-signal', 'smart-signal']);
    s = (playId(s, 'smart-signal') as { state: RunState }).state;
    const reordered = { tile: { y: 4, x: 3 }, kind: 'intersection' } as Target;
    expect(step(s, { type: 'play', handIndex: 0, target: reordered }, fakeEnv())).toEqual({
      ok: false,
      error: 'the same card on the same target does not stack',
    });
  });

  it('the same card on the same target does not stack', () => {
    let s = withHand(startRun(toy(), fakeEnv()).state, ['smart-signal', 'smart-signal']);
    s = (playId(s, 'smart-signal') as { state: RunState }).state;
    expect(playId(s, 'smart-signal')).toEqual({
      ok: false,
      error: 'the same card on the same target does not stack',
    });
  });

  it('a later controller on the same intersection refunds the earlier card (GDD §4)', () => {
    let s = withHand(startRun(toy(), fakeEnv()).state, ['smart-signal', 'roundabout']);
    s = (playId(s, 'smart-signal') as { state: RunState }).state;
    expect(s.energy).toBe(2);
    s = (playId(s, 'roundabout') as { state: RunState }).state;
    expect(s.energy).toBe(2); // paid 1, refunded 1
    expect(s.plays.map((p) => p.refunded)).toEqual([true, false]);
  });
});

describe('run-level effects', () => {
  it('energyModifier next-round (Overtime) adds energy next round only', () => {
    let s = withHand(startRun(toy(), fakeEnv()).state, ['overtime']);
    s = (playId(s, 'overtime') as { state: RunState }).state;
    s = must(must(s, { type: 'go' }), { type: 'choose', pick: 'skip' });
    expect(s.energy).toBe(4);
    s = must(must(s, { type: 'go' }), { type: 'choose', pick: 'skip' });
    expect(s.energy).toBe(3);
  });

  it('energyModifier now + replaced-signal (Remove Signal) refunds only over a signal', () => {
    let s = withHand(startRun(toy(), fakeEnv()).state, ['remove-signal', 'smart-signal']);
    const plain = (playId(s, 'remove-signal') as { state: RunState }).state;
    expect(plain.energy).toBe(2);
    s = (playId(s, 'smart-signal') as { state: RunState }).state; // energy 2
    // -1; the signal's refund (1) and the replaced-signal refund (1) don't stack: the larger applies.
    s = (playId(s, 'remove-signal') as { state: RunState }).state;
    expect(s.energy).toBe(2);
  });

  it('Remove Signal: replaced-signal reads the controller before this round (#32); refunds do not stack', () => {
    const s0 = startRun(toy(), fakeEnv()).state;
    const hand = (ids: [string, 1 | 2][]) =>
      ids.map(([id, tier], i) => ({ uid: 900 + i, id, tier }));
    // A same-round signal is not "replaced": tier 2 gets only the conflict refund (1). 3-1-1+1 = 2.
    let s: RunState = {
      ...s0,
      hand: hand([
        ['smart-signal', 1],
        ['remove-signal', 2],
      ]),
    };
    s = (playId(s, 'smart-signal') as { state: RunState }).state;
    s = (playId(s, 'remove-signal') as { state: RunState }).state;
    expect(s.energy).toBe(2);
    // A signal from a run effect is replaced: +1 at tier 1. 3-1+1 = 3.
    const runSignal = {
      cardId: 'smart-signal',
      tier: 1 as const,
      target: CENTER,
      effects: [{ kind: 'setController' as const, controller: 'signal' as const }],
      order: 0,
    };
    let t: RunState = { ...s0, runEffects: [runSignal], hand: hand([['remove-signal', 1]]) };
    t = (playId(t, 'remove-signal') as { state: RunState }).state;
    expect(t.energy).toBe(3);
    // Both trigger (a run-effect signal, then a same-round Roundabout, then tier-2 Remove Signal):
    // only the larger refund applies. 3 - 1 - 1 + max(conflict 1, replaced 2) = 3.
    let u: RunState = {
      ...s0,
      runEffects: [runSignal],
      hand: hand([
        ['roundabout', 1],
        ['remove-signal', 2],
      ]),
    };
    u = (playId(u, 'roundabout') as { state: RunState }).state;
    u = (playId(u, 'remove-signal') as { state: RunState }).state;
    expect(u.energy).toBe(3);
  });

  it('drawModifier (Second Shift) draws 2 extra cards next round', () => {
    let s = withHand(startRun(toy(), fakeEnv()).state, ['second-shift']);
    s = (playId(s, 'second-shift') as { state: RunState }).state;
    s = must(must(s, { type: 'go' }), { type: 'choose', pick: 'skip' });
    expect(s.hand).toHaveLength(7);
    s = must(must(s, { type: 'go' }), { type: 'choose', pick: 'skip' });
    expect(s.hand).toHaveLength(5);
  });

  it('costModifier next/cost (Pilot Program) makes the next card cost exactly 0', () => {
    let s = withHand(startRun(toy(), fakeEnv()).state, [
      'pilot-program',
      'bus-lane',
      'staggered-hours',
    ]);
    s = (playId(s, 'pilot-program') as { state: RunState }).state;
    expect(costOf(s, s.hand[0]!)).toBe(0);
    s = (playId(s, 'bus-lane') as { state: RunState }).state;
    expect(s.energy).toBe(2);
    expect(costOf(s, s.hand[0]!)).toBe(2);
  });

  it('costModifier next 2 (Pilot Program tier 2) covers two plays', () => {
    let s = withHand(
      { ...startRun(toy(1, { maxPlays: 3 }), fakeEnv()).state },
      ['pilot-program', 'bus-lane', 'staggered-hours'],
      2,
    );
    s = (playId(s, 'pilot-program') as { state: RunState }).state;
    s = (playId(s, 'bus-lane') as { state: RunState }).state;
    s = (playId(s, 'staggered-hours') as { state: RunState }).state;
    expect(s.energy).toBe(2);
  });

  it('costModifier delta applies to later plays this round, never below 0', () => {
    let s = withHand({ ...startRun(toy(), fakeEnv()).state, energy: 3 }, [
      'discount',
      'detour',
      'bus-lane',
    ]);
    s = (playId(s, 'discount') as { state: RunState }).state;
    expect(s.hand.map((c) => costOf(s, c))).toEqual([0, 1]);
    s = must(must(s, { type: 'go' }), { type: 'choose', pick: 'skip' });
    expect(s.roundCostRules).toEqual([]);
  });

  it('redraw (Recount) replaces the rest of the hand; tier 2 keeps one card', () => {
    const base = startRun(toy(11), fakeEnv()).state;
    let s = withHand(base, ['recount', 'detour', 'turn-lane', 'overtime', 'bus-priority']);
    const before = s.hand.slice(1).map((c) => c.uid);
    s = (playId(s, 'recount') as { state: RunState }).state;
    expect(s.hand).toHaveLength(4);
    expect(s.hand.map((c) => c.uid)).not.toEqual(before);
    expect(deckOf(s).length).toBe(deckOf(base).length);

    let t = withHand(base, ['recount', 'detour', 'turn-lane', 'overtime', 'bus-priority'], 2);
    const keep = t.hand[2]!;
    t = (playId(t, 'recount', { keepHandIndex: 1 }) as { state: RunState }).state;
    expect(t.hand[0]).toEqual(keep);
    expect(t.hand).toHaveLength(4);
  });

  it('Recount discards the returned cards, so it no longer hands back the same cards (playtest E3)', () => {
    // The identical hand happened when the draw pile was empty: the returned cards went to the
    // bottom and were drawn straight back in the same order. Seed 11, pile run out.
    const ids = ['recount', 'detour', 'turn-lane', 'overtime', 'bus-priority'];
    const emptyPile = (seed: number): RunState => {
      const base = startRun(toy(seed), fakeEnv()).state;
      return { ...withHand(base, ids), drawPile: [], spent: [...base.spent, ...base.drawPile] };
    };
    const set = (cards: readonly { uid: number }[]) =>
      cards
        .map((c) => c.uid)
        .sort((a, b) => a - b)
        .join();
    const s = emptyPile(11);
    const back = s.hand.slice(1);
    const after = (playId(s, 'recount') as { state: RunState }).state;
    expect(after.hand).toHaveLength(4);
    expect(set(after.hand)).not.toEqual(set(back));
    expect(deckOf(after).length).toBe(deckOf(s).length);
    // Deterministic from the run seed.
    const again = (playId(emptyPile(11), 'recount') as { state: RunState }).state;
    expect(again.hand).toEqual(after.hand);
    // Across seeds, the same set of cards comes back at most by rare chance (4 of 11: 1 in 330).
    let same = 0;
    for (let seed = 1; seed <= 240; seed++) {
      const t = emptyPile(seed);
      const r = (playId(t, 'recount') as { state: RunState }).state;
      if (set(r.hand) === set(t.hand.slice(1))) same++;
    }
    expect(same).toBeLessThanOrEqual(2);
  });

  it('Recount draws new cards from the pile before any returned card', () => {
    const base = startRun(toy(11), fakeEnv()).state;
    const s = withHand(base, ['recount', 'detour', 'turn-lane', 'overtime', 'bus-priority']);
    const back = new Set(s.hand.slice(1).map((c) => c.uid));
    expect(s.drawPile.length).toBeGreaterThanOrEqual(4);
    const after = (playId(s, 'recount') as { state: RunState }).state;
    expect(after.hand.some((c) => back.has(c.uid))).toBe(false);
    expect(after.hand.map((c) => c.uid)).toEqual(s.drawPile.slice(0, 4).map((c) => c.uid));
  });

  it('run-duration cards persist as run effects and per-round energy', () => {
    let s = withHand({ ...startRun(toy(), fakeEnv()).state, energy: 3 }, ['ring-bond']);
    s = (playId(s, 'ring-bond') as { state: RunState }).state;
    s = must(must(s, { type: 'go' }), { type: 'choose', pick: 'skip' });
    expect(s.runEffects.map((p) => p.cardId)).toEqual(['ring-bond']);
    expect(s.energy).toBe(4);
    s = must(must(s, { type: 'go' }), { type: 'choose', pick: 'skip' });
    expect(s.energy).toBe(4);
  });
});

describe('ADR-014 bounds on run-level effects', () => {
  const withCard = (effects: Effect[], upgrade: RunCard['upgrade'] = {}): RunConfig =>
    toy(1, {
      cards: [
        ...CARDS,
        {
          id: 'odd',
          cost: 1,
          target: 'district',
          duration: 'round',
          rarity: 'rare',
          tags: ['TEMPO'],
          effects,
          upgrade,
        },
      ],
    });

  it('startRun throws on a card outside content schema bounds, at tier 1 or tier 2', () => {
    const bad: Effect[] = [
      { kind: 'energyModifier', delta: -9, when: 'now' },
      { kind: 'drawModifier', delta: 50 },
      { kind: 'drawModifier', delta: 0 },
      { kind: 'costModifier', cards: 'all', delta: 0 },
      { kind: 'costModifier', cards: 'all', delta: 4 },
      { kind: 'costModifier', cards: 'all', delta: -1, next: 1, cost: 0 },
      { kind: 'costModifier', cards: 'all', next: 3 as 2, cost: 0 },
      { kind: 'costModifier', cards: 'all', next: 1, cost: 4 },
      { kind: 'costModifier', cards: 'all' },
      { kind: 'redraw', keep: 2 as 0 },
      { kind: 'fundsModifier', delta: 21 },
      { kind: 'fundsModifier', delta: 1, per: 0 },
    ];
    for (const e of bad) {
      expect(runEffectError(e)).not.toBeNull();
      expect(() => startRun(withCard([e]), fakeEnv())).toThrow(RangeError);
    }
    expect(() =>
      startRun(withCard([{ kind: 'drawModifier', delta: 1 }], { effects: [bad[1]!] }), fakeEnv()),
    ).toThrow(/odd tier 2: drawModifier/);
    for (const c of CARDS)
      for (const e of [...c.effects, ...(c.upgrade.effects ?? [])])
        expect(runEffectError(e)).toBeNull();
    expect(runEffectError({ kind: 'fundsModifier', delta: 1, per: 4 })).toBeNull();
  });

  it('in-round energy never goes below 0', () => {
    const cfg = withCard([{ kind: 'energyModifier', delta: -5, when: 'now' }]);
    let s = withHand(startRun(cfg, fakeEnv()).state, ['odd']);
    s = (playId(s, 'odd') as { state: RunState }).state;
    expect(s.energy).toBe(0);
  });

  it('flat fundsModifier is applied by the controller at round end; per-vehicle is the sim’s', () => {
    const flat = withCard([{ kind: 'fundsModifier', delta: 3 }]);
    let s = withHand(startRun(flat, fakeEnv()).state, ['odd']);
    s = (playId(s, 'odd') as { state: RunState }).state;
    s = must(s, { type: 'go' });
    expect(s.funds).toBe(4 + 3);
    const perVehicle = withCard([{ kind: 'fundsModifier', delta: 1, per: 4 }]);
    let t = withHand(startRun(perVehicle, fakeEnv()).state, ['odd']);
    t = (playId(t, 'odd') as { state: RunState }).state;
    t = must(t, { type: 'go' });
    expect(t.funds).toBe(4);
    const cost = withCard([{ kind: 'fundsModifier', delta: -20 }]);
    let u = withHand(startRun(cost, fakeEnv()).state, ['odd']);
    u = (playId(u, 'odd') as { state: RunState }).state;
    expect(must(u, { type: 'go' }).funds).toBe(0);
  });
});

describe('round end, offers and run end', () => {
  it('unplayed cards return to the deck; the deck size is conserved', () => {
    let s = startRun(toy(2), fakeEnv()).state;
    const hand = s.hand.map((c) => c.uid);
    s = must(s, { type: 'go' });
    expect(s.drawPile.slice(-5).map((c) => c.uid)).toEqual(hand);
    expect(deckOf(s)).toHaveLength(12);
  });

  it('a pass earns funds and a 3-card offer; picking adds the card, skipping gives +2', () => {
    const env = fakeEnv((i) => i.districtRules.quota * 2);
    const s = must(startRun(toy(4), env).state, { type: 'go' }, env);
    expect(s.phase).toBe('result');
    expect(s.funds).toBe(10); // +4 pass, +6 cap for 100% over quota
    expect(s.offer).toHaveLength(3);
    expect(new Set(s.offer!.map((c) => c.id)).size).toBe(3);
    const picked = s.offer![1]!;
    const after = must(s, { type: 'choose', pick: 1 });
    expect(deckOf(after).some((c) => c.uid === picked.uid)).toBe(true);
    expect(deckOf(after)).toHaveLength(13);
    expect(must(s, { type: 'choose', pick: 'skip' }).funds).toBe(12);
    expect(step(s, { type: 'choose', pick: 7 }, fakeEnv()).ok).toBe(false);
  });

  it('a fail costs one approval and no offer; zero approval ends the run as a loss', () => {
    const env = fakeEnv(() => 0);
    const r = replay(
      toy(1),
      [
        { type: 'go' },
        { type: 'choose', pick: 'skip' },
        { type: 'go' },
        { type: 'choose', pick: 'skip' },
        { type: 'go' },
      ],
      env,
    );
    expect(r.state.phase).toBe('end');
    expect(r.state.outcome).toBe('loss');
    expect(r.state.approval).toBe(0);
    expect(r.state.history.map((h) => h.pass)).toEqual([false, false, false]);
    const end = r.events.at(-1)!;
    expect(end).toMatchObject({ event: 'run_end', props: { rounds: 3, result: 'loss' } });
    expect(step(r.state, { type: 'go' }, env).ok).toBe(false);
  });

  it('a plain 5-round run has Market Day on round 5 and ends in a win', () => {
    const env = fakeEnv();
    const actions: RunAction[] = [];
    for (let i = 0; i < 4; i++) actions.push({ type: 'go' }, { type: 'choose', pick: 'skip' });
    actions.push({ type: 'go' });
    const r = replay(toy(9), actions, env);
    expect(r.state.outcome).toBe('win');
    expect(env.setups.map((x) => [x.round, x.rush, x.boss])).toEqual([
      [1, false, null],
      [2, false, null],
      [3, false, null],
      [4, false, null],
      [5, true, 'market-day'],
    ]);
    expect(r.state.history.map((h) => h.quota)).toEqual(
      [1, 2, 3, 4, 5].map((round) => roundQuota(1, round, round === 5)),
    );
    expect(r.events.map((e) => e.event)).toEqual([
      'run_start',
      ...Array(5).fill('round_end'),
      'run_end',
    ]);
    expect(r.events.at(-1)).toMatchObject({ props: { rounds: 5, result: 'win' } });
  });

  it('the itch toy preset samples D1 rounds TOY_ROUNDS (ADR-030): quota, demand, rush and boss', () => {
    expect(TOY_ROUNDS).toEqual([4, 8, 11, 10, 12]);
    const config = toyRunConfig({ seed: 9, cards: CARDS });
    expect(config.rounds).toBe(5);
    expect(config.curveRounds).toEqual(TOY_ROUNDS);
    expect(config.rushRounds).toEqual(toyRushRounds());
    const env = fakeEnv();
    const actions: RunAction[] = [];
    for (let i = 0; i < 4; i++) actions.push({ type: 'go' }, { type: 'choose', pick: 'skip' });
    actions.push({ type: 'go' });
    const r = replay(config, actions, env);
    // setupRound gets the sampled D1 round; the run still counts rounds 1–5.
    expect(env.setups.map((x) => [x.round, x.rush, x.boss])).toEqual([
      [4, true, 'market-day'],
      [8, true, 'parade'],
      [11, false, null],
      [10, false, null],
      [12, true, 'festival'],
    ]);
    expect(r.state.history.map((h) => h.round)).toEqual([1, 2, 3, 4, 5]);
    expect(r.state.history.map((h) => h.quota)).toEqual(
      TOY_ROUNDS.map((d1) => roundQuota(1, d1, RUSH_ROUNDS.includes(d1), 1000, emptyMap().id)),
    );
  });

  it('the toy drops Overtime and Pilot Program from its deck and offers; the full run keeps them (ADR-032)', () => {
    expect([...TOY_EXCLUDED_CARDS].sort()).toEqual(['overtime', 'pilot-program']);
    const config = toyRunConfig({ seed: 9, cards: CARDS });
    expect(config.startingDeck).toEqual(
      PHASE1_STARTING_DECK.filter((id) => id !== 'overtime' && id !== 'pilot-program'),
    );
    expect(config.startingDeck).toHaveLength(10);
    expect(config.cards.map((c) => c.id)).toEqual(
      CARDS.map((c) => c.id).filter((id) => id !== 'overtime' && id !== 'pilot-program'),
    );
    const full = fullRunConfig({ seed: 9, cards: CARDS });
    expect(full.startingDeck).toEqual(PHASE1_STARTING_DECK);
    expect(full.cards).toEqual(CARDS);
  });

  it("the sim's district rules carry the sampled curve round; the run keeps its own count", () => {
    const env = fakeEnv();
    let s = startRun(toyRunConfig({ seed: 9, cards: CARDS }), env).state;
    const seen: [number, number, number][] = [];
    for (let i = 0; i < 5; i++) {
      const rules = roundInput(s).districtRules;
      seen.push([s.round, rules.round, rules.quota]);
      s = must(s, { type: 'go' }, env);
      if (s.phase === 'result') s = must(s, { type: 'choose', pick: 'skip' }, env);
    }
    expect(seen.map(([run]) => run)).toEqual([1, 2, 3, 4, 5]);
    expect(seen.map(([, curve]) => curve)).toEqual([...TOY_ROUNDS]);
    expect(seen.map(([, , quota]) => quota)).toEqual(
      TOY_ROUNDS.map((d1) => roundQuota(1, d1, RUSH_ROUNDS.includes(d1), 1000, emptyMap().id)),
    );
    // Without curveRounds (full runs, the mechanics fixture) the two are the same.
    expect(roundInput(startRun(toy(9), env).state).districtRules.round).toBe(1);
  });

  it("the controller's quota is content's round-setup quota, toy and full (ADR-032)", () => {
    // Content's real setupRound: the toy scales demand and quota by the map's template factor,
    // a full run does not. Either way the quota the player must beat is the one setupRound gives.
    for (const config of [
      toyRunConfig({ seed: 9, cards: CARDS }),
      fullRunConfig({ seed: 9, cards: CARDS }),
    ]) {
      const quotas: number[] = [];
      const env: RunEnv = {
        setupRound: (args) => {
          const s = setupRound(args);
          quotas.push(s.quota);
          return s;
        },
        simulate: (input) => ({
          throughput: input.districtRules.quota,
          spawned: 0,
          exited: 0,
          ticks: 300,
          gridlocked: false,
          fundsDelta: 0,
          finalHash: '0000000000000000',
        }),
      };
      let s = startRun(config, env).state;
      const seen: number[] = [];
      // The toy's 5 rounds, and a full run up to its first rush round.
      for (let i = 0; i < 5; i++) {
        seen.push(s.quota);
        s = must(s, { type: 'go' }, env);
        if (s.phase === 'result') s = must(s, { type: 'choose', pick: 'skip' }, env);
      }
      expect(seen).toEqual(quotas.slice(0, 5));
      expect(new Set(seen).size).toBeGreaterThan(1);
    }
    // The toy's quota differs from the unscaled one on a scaled map.
    const toy = startRun(toyRunConfig({ seed: 9, cards: CARDS }), { setupRound }).state;
    expect(toy.quota).toBe(roundQuota(1, TOY_ROUNDS[0]!, true, 1000, toy.map.id));
    expect(toy.quota).not.toBe(roundQuota(1, TOY_ROUNDS[0]!, true));
  });

  it('rejects curveRounds that do not cover every round', () => {
    const env = fakeEnv();
    expect(() => startRun(toy(1, { curveRounds: [4, 8] }), env)).toThrow(RangeError);
    expect(() => startRun(toy(1, { curveRounds: [4, 8, 12, 0, 12] }), env)).toThrow(RangeError);
  });

  it('a full run has no curveRounds and plays curve rounds 1–12', () => {
    expect(fullRunConfig({ seed: 1, cards: CARDS }).curveRounds).toBeUndefined();
  });

  it('a full run is 12 rounds with rush rounds 4, 8 and 12', () => {
    const env = fakeEnv();
    const actions: RunAction[] = [];
    for (let i = 0; i < 11; i++) actions.push({ type: 'go' }, { type: 'choose', pick: 0 });
    actions.push({ type: 'go' });
    const r = replay(fullRunConfig({ seed: 3, cards: CARDS }), actions, env);
    expect(r.state.outcome).toBe('win');
    expect(env.setups.filter((x) => x.rush).map((x) => [x.round, x.boss])).toEqual([
      [4, 'market-day'],
      [8, 'parade'],
      [12, 'festival'],
    ]);
    expect(deckOf(r.state)).toHaveLength(23);
  });

  it('reshuffles spent cards when the draw pile runs out', () => {
    const env = fakeEnv();
    let s = startRun(toy(6, { rounds: 12 }), env).state;
    for (let i = 0; i < 6; i++) {
      const idx = s.hand.findIndex(
        (c) => targetFor(c.id).kind === 'district' && costOf(s, c) <= s.energy,
      );
      if (idx >= 0) s = must(s, { type: 'play', handIndex: idx, target: DISTRICT }, env);
      s = must(must(s, { type: 'go' }, env), { type: 'choose', pick: 'skip' }, env);
      expect(s.hand.length).toBeGreaterThanOrEqual(5);
      expect(deckOf(s)).toHaveLength(12);
    }
  });
});

describe('next-round cards in the last round (playtest E2)', () => {
  const card = (id: string) => CARDS.find((c) => c.id === id)!;

  it('knows which cards only pay off next round', () => {
    expect(isNextRoundOnly(card('overtime'), 1)).toBe(true);
    expect(isNextRoundOnly(card('second-shift'), 1)).toBe(true);
    expect(isNextRoundOnly(card('second-shift'), 2)).toBe(true);
    for (const id of ['recount', 'detour', 'bus-priority', 'remove-signal'])
      expect(isNextRoundOnly(card(id), 1), id).toBe(false);
  });

  it('never deals them in the last round, also when the draw pile is all next-round cards', () => {
    const env = fakeEnv();
    let s = startRun(toy(3), env).state;
    for (let i = 0; i < 3; i++)
      s = must(must(s, { type: 'go' }, env), { type: 'choose', pick: 'skip' }, env);
    s = must(s, { type: 'go' }, env);
    // Before round 5: stack the top of the pile with next-round cards.
    const nextRound = (id: string, uid: number) => ({ uid, id, tier: 1 as const });
    s = {
      ...s,
      drawPile: [nextRound('overtime', 900), nextRound('second-shift', 901), ...s.drawPile],
    };
    s = must(s, { type: 'choose', pick: 'skip' }, env);
    expect(s.round).toBe(5);
    expect(s.hand).toHaveLength(5);
    expect(s.hand.some((c) => isNextRoundOnly(card(c.id), c.tier))).toBe(false);
    // They stay in the deck, on top of the pile.
    expect(s.drawPile.slice(0, 2).map((c) => c.uid)).toEqual([900, 901]);
    expect(deckOf(s)).toHaveLength(14);
  });

  it('still deals them before the last round', () => {
    const s = startRun(toy(3), fakeEnv()).state;
    const stacked = {
      ...s,
      hand: [],
      drawPile: [{ uid: 900, id: 'overtime', tier: 1 as const }, ...s.drawPile],
    };
    const r = must(must(stacked, { type: 'go' }), { type: 'choose', pick: 'skip' });
    expect(r.round).toBe(2);
    expect(r.hand.map((c) => c.uid)).toContain(900);
  });

  it('a Recount in the last round does not draw them either', () => {
    const env = fakeEnv();
    let s = startRun(toy(5), env).state;
    for (let i = 0; i < 4; i++)
      s = must(must(s, { type: 'go' }, env), { type: 'choose', pick: 'skip' }, env);
    expect(s.round).toBe(5);
    s = {
      ...withHand(s, ['recount', 'detour', 'turn-lane']),
      drawPile: [
        { uid: 900, id: 'overtime', tier: 1 },
        { uid: 901, id: 'second-shift', tier: 1 },
        ...s.drawPile,
      ],
    };
    const r = (playId(s, 'recount') as { state: RunState }).state;
    expect(r.hand).toHaveLength(2);
    expect(r.hand.some((c) => c.uid === 900 || c.uid === 901)).toBe(false);
  });

  it('are not offered after the second-to-last round, and are before it', () => {
    const env = fakeEnv((i) => i.districtRules.quota * 2);
    const offered = (rounds: number): Set<string> => {
      const ids = new Set<string>();
      for (let seed = 1; seed <= 150; seed++) {
        let s = startRun(toy(seed), env).state;
        for (let r = 1; r < rounds; r++)
          s = must(must(s, { type: 'go' }, env), { type: 'choose', pick: 'skip' }, env);
        s = must(s, { type: 'go' }, env);
        for (const c of s.offer ?? []) ids.add(c.id);
      }
      return ids;
    };
    const last = offered(4); // the offer after round 4 feeds only round 5
    expect(last.size).toBeGreaterThan(5);
    for (const id of last) expect(isNextRoundOnly(card(id), 1), id).toBe(false);
    const earlier = offered(3);
    expect([...earlier].some((id) => isNextRoundOnly(card(id), 1))).toBe(true);
  });
});

describe('offers (GDD §4 draft rules)', () => {
  it('follow the 60/30/10 rarity weights', () => {
    const counts = { common: 0, uncommon: 0, rare: 0 };
    const pool = CARDS.filter((c) => c.duration === 'round');
    const byId = new Map(pool.map((c) => [c.id, c]));
    for (let seed = 0; seed < 3000; seed++) {
      const { state } = startRun(toy(seed), fakeEnv());
      const [id] = buildOffer(pool, [], 1, state.prng);
      counts[byId.get(id!)!.rarity]++;
    }
    expect(counts.common / 3000).toBeGreaterThan(0.56);
    expect(counts.common / 3000).toBeLessThan(0.64);
    expect(counts.uncommon / 3000).toBeGreaterThan(0.26);
    expect(counts.uncommon / 3000).toBeLessThan(0.34);
    expect(counts.rare / 3000).toBeGreaterThan(0.08);
    expect(counts.rare / 3000).toBeLessThan(0.12);
  });

  it('never offer a run-duration card the deck already holds', () => {
    const deck = [{ uid: 1, id: 'ring-bond', tier: 1 as const }];
    for (let seed = 0; seed < 300; seed++) {
      const { state } = startRun(toy(seed), fakeEnv());
      expect(buildOffer(CARDS, deck, 1, state.prng)).not.toContain('ring-bond');
    }
  });

  it('from the offer after round 3 always include the dominant tag (pity rule, round >= 3)', () => {
    const deck = ['bus-priority', 'bus-lane', 'fare-holiday', 'detour'].map((id, uid) => ({
      uid,
      id,
      tier: 1 as const,
    }));
    const mass = new Set(CARDS.filter((c) => c.tags.includes('MASS')).map((c) => c.id));
    let missedBefore = 0;
    for (let seed = 0; seed < 300; seed++) {
      const { state } = startRun(toy(seed), fakeEnv());
      expect(buildOffer(CARDS, deck, 3, state.prng).some((id) => mass.has(id))).toBe(true);
      if (
        !buildOffer(CARDS, deck, 2, startRun(toy(seed), fakeEnv()).state.prng).some((id) =>
          mass.has(id),
        )
      )
        missedBefore++;
    }
    expect(missedBefore).toBeGreaterThan(0);
  });
});

describe('RunController (analytics wiring)', () => {
  it('sends run_start, round_end and run_end through track() and logs actions', () => {
    const calls: [string, unknown][] = [];
    const rc = new RunController(
      toy(1),
      fakeEnv(() => 0),
      { track: (e, p) => calls.push([e, p]) },
    );
    for (let i = 0; i < 3; i++) {
      rc.dispatch({ type: 'go' });
      rc.dispatch({ type: 'choose', pick: 'skip' });
    }
    expect(calls.map(([e]) => e)).toEqual([
      'run_start',
      'round_end',
      'round_end',
      'round_end',
      'run_end',
    ]);
    expect(calls[1]![1]).toEqual({
      round: 1,
      pass: false,
      throughput: 0,
      quota: roundQuota(1, 1, false),
      cardsPlayed: [],
    });
    const end = calls[4]![1] as { deckTags: string[] };
    expect(end.deckTags.length).toBeGreaterThanOrEqual(12);
    expect(rc.actions).toEqual([
      { type: 'go' },
      { type: 'choose', pick: 'skip' },
      { type: 'go' },
      { type: 'choose', pick: 'skip' },
      { type: 'go' },
    ]);
    expect(
      replay(
        toy(1),
        rc.actions,
        fakeEnv(() => 0),
      ).state.outcome,
    ).toBe('loss');
  });

  it('supports the worker path and survives a throwing track()', () => {
    const rc = new RunController(toy(1), fakeEnv(), {
      track: () => {
        throw new Error('offline');
      },
    });
    const input = rc.roundInput();
    const r = rc.resolve({
      throughput: input.districtRules.quota,
      spawned: 0,
      exited: 0,
      ticks: 300,
      gridlocked: false,
      fundsDelta: 0,
      finalHash: 'x',
    });
    expect(r.ok).toBe(true);
    expect(rc.state.phase).toBe('result');
    expect(new RunController(toy(1), fakeEnv()).state.round).toBe(1);
  });
});

describe('real sim', () => {
  it('runs Go through Sim.simulate when env.simulate is not given', () => {
    const env = { setupRound: fakeEnv().setupRound };
    const r = step(startRun(toy(2), env).state, { type: 'go' }, env);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.history[0]!.finalHash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('integers only', () => {
  it('every number in a run state is an integer', () => {
    const r = replay(
      toy(12),
      [{ type: 'go' }, { type: 'choose', pick: 0 }, { type: 'go' }],
      fakeEnv((i) => i.districtRules.quota + 3),
    );
    const walk = (v: unknown): void => {
      if (typeof v === 'number') expect(Number.isInteger(v)).toBe(true);
      else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
    };
    walk({ ...r.state, config: null, map: null });
  });
});

describe('round input: Parade closures and p_slow reach the sim', () => {
  // The plus map's north arm, between the north edge and the centre: closing it cuts every
  // north-south trip (there is no other road between edges 0 and 2).
  const PARADE: SegmentId = { from: { x: 3, y: 1 }, to: { x: 3, y: 2 } };
  const demand = Array.from({ length: 20 }, (_, i) => ({
    tick: i * 10,
    edge: 0,
    vehicleType: 0 as const,
    destinationEdge: 2,
  }));
  /** A real-sim env: a Parade round closes PARADE, as content's setupRound does (ADR-021). */
  const realEnv = (pSlowPermille = 0): RunEnv => ({
    setupRound: ({ boss }) => ({
      map: emptyMap(),
      demandProfile: demand,
      closedSegments: boss === 'parade' ? [PARADE] : [],
      districtRules: { pSlowPermille },
    }),
  });
  const config = (boss: 'parade' | null): RunConfig =>
    toy(11, { rushRounds: boss ? [{ round: 1, boss }] : [] });

  it('a Parade round closes its segment, so trips across it never start', () => {
    const open = must(startRun(config(null), realEnv()).state, { type: 'go' }, realEnv());
    const parade = startRun(config('parade'), realEnv()).state;
    expect(parade.closedSegments).toEqual([PARADE]);
    const input = roundInput(parade);
    expect(input.districtRules.boss).toBe('parade');
    expect(input.closedSegments).toEqual([PARADE]);
    const closed = must(parade, { type: 'go' }, realEnv());
    expect(open.history[0]!.throughput).toBeGreaterThan(0);
    expect(closed.history[0]!.throughput).toBe(0);
    // Rounds without a closure keep their input digest (no closedSegments key at all).
    expect('closedSegments' in roundInput(startRun(config(null), realEnv()).state)).toBe(false);
  });

  it("passes the district's p_slow to the sim", () => {
    const calm = startRun(config(null), realEnv(0)).state;
    const foggy = startRun(config(null), realEnv(300)).state;
    expect(roundInput(foggy).districtRules.pSlowPermille).toBe(300);
    const a = must(calm, { type: 'go' }, realEnv(0)).history[0]!;
    const b = must(foggy, { type: 'go' }, realEnv(300)).history[0]!;
    expect(b.finalHash).not.toBe(a.finalHash);
  });

  it('defaults to no closure and p_slow 0 when setupRound returns neither', () => {
    const s = startRun(toy(2), fakeEnv()).state;
    expect(s.closedSegments).toEqual([]);
    expect(roundInput(s).districtRules.pSlowPermille).toBe(0);
  });
});
