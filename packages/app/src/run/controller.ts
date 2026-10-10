import {
  Sim,
  clonePrng,
  createPrng,
  nextInt,
  nextU32,
  placementError,
  type Effect,
  type Placement,
  type RoundInput,
  type RoundResult,
  type Target,
} from '@rushwarden/sim';
import { draw, shuffle } from './deck.js';
import { buildOffer } from './offers.js';
import { fundsFor, quotaFor } from './quota.js';
import type {
  CostRule,
  DeckCard,
  Play,
  RunAction,
  RunCard,
  RunConfig,
  RunEnv,
  RunEvent,
  RunState,
  StepResult,
  CardTag,
} from './types.js';

/**
 * The deterministic run controller (P1-BAL-01): GDD §2 core loop steps 1–4 and §4 draft rules,
 * with the Phase 1 scope of ADR-007 and the rule readings of ADR-018. Pure: every function takes
 * a state and returns a new one; randomness comes only from the run PRNG in the state.
 */

const fail = (error: string): StepResult => ({ ok: false, error });

/** Card lookup per config, built once (the balance runner plays thousands of runs per config). */
const indexes = new WeakMap<RunConfig, ReadonlyMap<string, RunCard>>();

function cardIndex(config: RunConfig): ReadonlyMap<string, RunCard> {
  let index = indexes.get(config);
  if (!index) {
    index = new Map(config.cards.map((c) => [c.id, c]));
    indexes.set(config, index);
  }
  return index;
}

function cardOf(config: RunConfig, id: string): RunCard {
  const card = cardIndex(config).get(id);
  if (!card) throw new Error(`unknown card ${id}`);
  return card;
}

/** Cost and effects of a card at a tier (GDD §4: tier 2 is the `upgrade` delta). */
export function resolveTier(
  card: RunCard,
  tier: 1 | 2,
): { cost: number; effects: readonly Effect[] } {
  const up = tier === 2 ? card.upgrade : {};
  return { cost: up.cost ?? card.cost, effects: up.effects ?? card.effects };
}

/** All cards the player owns, wherever they are. */
export function deckOf(state: RunState): DeckCard[] {
  return [...state.drawPile, ...state.hand, ...state.plays.map((p) => p.card), ...state.spent];
}

/**
 * Structural target equality (GDD §4 stacking and controller conflicts). Key order never matters,
 * and a segment counts as the same target in either direction, since it covers the same tiles
 * (ADR-018 point 4).
 */
export function sameTarget(a: Target, b: Target): boolean {
  const at = (p: { x: number; y: number }, q: { x: number; y: number }): boolean =>
    p.x === q.x && p.y === q.y;
  switch (a.kind) {
    case 'district':
      return b.kind === 'district';
    case 'edge':
      return b.kind === 'edge' && a.edge === b.edge;
    case 'intersection':
      return b.kind === 'intersection' && at(a.tile, b.tile);
    case 'segment':
      return (
        b.kind === 'segment' &&
        ((at(a.from, b.from) && at(a.to, b.to)) || (at(a.from, b.to) && at(a.to, b.from)))
      );
  }
}

/**
 * ADR-014 says the ranges of run-level effects are bounded by the content schema and enforced by
 * the run controller. These are content's schema bounds (packages/content/src/card-schema.ts).
 * Returns the first violation, or null.
 */
export function runEffectError(e: Effect): string | null {
  const within = (n: number | undefined, lo: number, hi: number): boolean =>
    n !== undefined && Number.isInteger(n) && n >= lo && n <= hi;
  const nonZero = (n: number, lo: number, hi: number): boolean => within(n, lo, hi) && n !== 0;
  switch (e.kind) {
    case 'drawModifier':
      return nonZero(e.delta, -5, 5) ? null : `drawModifier.delta ${e.delta} not in ±1..5`;
    case 'energyModifier':
      return nonZero(e.delta, -5, 5) ? null : `energyModifier.delta ${e.delta} not in ±1..5`;
    case 'costModifier': {
      const relative = e.delta !== undefined;
      const fixed = e.next !== undefined || e.cost !== undefined;
      if (relative === fixed) return 'costModifier needs either delta, or next + cost';
      if (relative)
        return nonZero(e.delta ?? 0, -3, 3) ? null : `costModifier.delta ${e.delta} not in ±1..3`;
      return within(e.next, 1, 2) && within(e.cost, 0, 3)
        ? null
        : `costModifier next ${e.next} / cost ${e.cost} not in 1..2 / 0..3`;
    }
    case 'redraw':
      return within(e.keep, 0, 1) ? null : `redraw.keep ${e.keep} not in 0..1`;
    case 'fundsModifier':
      if (!nonZero(e.delta, -20, 20)) return `fundsModifier.delta ${e.delta} not in ±1..20`;
      return e.per === undefined || within(e.per, 1, 100)
        ? null
        : `fundsModifier.per ${e.per} not in 1..100`;
    default:
      return null;
  }
}

/** Flat `fundsModifier` (no `per`): applied by the controller at round end (ADR-018 point 7). */
function flatFunds(placements: readonly Placement[]): number {
  let funds = 0;
  for (const p of placements)
    for (const e of p.effects)
      if (e.kind === 'fundsModifier' && e.per === undefined) funds += e.delta;
  return funds;
}

/**
 * The controller an intersection had before this round's cards: run effects over the map default
 * (maps author none yet). Same reading as the sim's `resolvePlacements().replacedController`
 * (#32), so Remove Signal over a signal played this same round gets only the conflict refund.
 */
function controllerBeforeRound(state: RunState, target: Target): string | null {
  if (target.kind !== 'intersection') return null;
  let controller: string | null = null;
  for (const p of state.runEffects) {
    if (!sameTarget(p.target, target)) continue;
    for (const e of p.effects) if (e.kind === 'setController') controller = e.controller;
  }
  return controller;
}

/** Energy cost of a hand card now, after cost rules (GDD §4 costs 1–3; never below 0). */
export function costOf(state: RunState, card: DeckCard): number {
  if (state.pendingCost && state.pendingCost.remaining > 0) return state.pendingCost.cost;
  let cost = resolveTier(cardOf(state.config, card.id), card.tier).cost;
  for (const r of [...state.runCostRules, ...state.roundCostRules]) {
    if (r.cards === 'all' || r.cards.includes(card.id)) cost += r.delta;
  }
  return Math.max(0, cost);
}

function rushOf(config: RunConfig, round: number) {
  return config.rushRounds.find((r) => r.round === round) ?? null;
}

/** Sets up round `round`: seed, map and demand, quota, energy and the opening hand. */
function startRound(state: RunState, round: number, env: RunEnv): RunState {
  const prng = clonePrng(state.prng);
  const roundSeed = nextU32(prng);
  const rush = rushOf(state.config, round);
  const setup = env.setupRound({
    district: state.config.district,
    round,
    rush: rush !== null,
    boss: rush?.boss ?? null,
    seed: roundSeed,
  });
  const handCount = Math.max(0, state.config.handSize + state.nextDrawBonus);
  const dealt = draw(state.drawPile, state.spent, handCount, prng);
  return {
    ...state,
    phase: 'place',
    prng,
    round,
    roundSeed,
    map: setup.map,
    demandProfile: setup.demandProfile,
    closedSegments: setup.closedSegments ?? [],
    pSlowPermille: setup.districtRules?.pSlowPermille ?? 0,
    rush: rush !== null,
    boss: rush?.boss ?? null,
    quota: quotaFor(state.config.district, round, rush !== null, state.config.quotaPermille),
    hand: dealt.drawn,
    drawPile: dealt.drawPile,
    spent: dealt.spent,
    energy: Math.max(0, state.config.energy + state.nextEnergyBonus + state.energyPerRound),
    plays: [],
    roundCostRules: [],
    pendingCost: null,
    nextDrawBonus: 0,
    nextEnergyBonus: 0,
    undoStack: [],
    offer: null,
  };
}

/** Starts a run: shuffles the starting deck, deals round 1. Emits `run_start`. */
export function startRun(config: RunConfig, env: RunEnv): { state: RunState; events: RunEvent[] } {
  const index = cardIndex(config);
  for (const id of config.startingDeck) if (!index.has(id)) throw new Error(`unknown card ${id}`);
  for (const card of config.cards)
    for (const tier of [1, 2] as const)
      for (const e of resolveTier(card, tier).effects) {
        const err = runEffectError(e);
        if (err) throw new RangeError(`card ${card.id} tier ${tier}: ${err}`);
      }
  const prng = createPrng(config.seed >>> 0);
  const deck: DeckCard[] = config.startingDeck.map((id, uid) => ({ uid, id, tier: 1 }));
  const blank: RunState = {
    config,
    phase: 'place',
    prng,
    nextUid: deck.length,
    round: 0,
    approval: config.approval,
    funds: 0,
    drawPile: shuffle(deck, prng),
    spent: [],
    hand: [],
    energy: 0,
    plays: [],
    roundSeed: 0,
    map: { id: '', tiles: [], edges: [] },
    demandProfile: [],
    closedSegments: [],
    pSlowPermille: 0,
    rush: false,
    boss: null,
    quota: 0,
    runEffects: [],
    runCostRules: [],
    roundCostRules: [],
    pendingCost: null,
    nextDrawBonus: 0,
    nextEnergyBonus: 0,
    energyPerRound: 0,
    undoStack: [],
    history: [],
    offer: null,
    outcome: null,
  };
  return {
    state: startRound(blank, 1, env),
    events: [
      {
        event: 'run_start',
        props: { mayor: config.mayor, district: config.district, daily: config.daily },
      },
    ],
  };
}

function play(state: RunState, action: Extract<RunAction, { type: 'play' }>): StepResult {
  if (state.phase !== 'place') return fail('not in the place phase');
  if (state.plays.length >= state.config.maxPlays) return fail('no plays left this round');
  const card = state.hand[action.handIndex];
  if (!card) return fail('no card at that hand index');
  const def = cardOf(state.config, card.id);
  if (action.target.kind !== def.target) return fail(`${def.id} targets ${def.target}`);
  const { effects } = resolveTier(def, card.tier);
  const placement: Placement = {
    cardId: def.id,
    tier: card.tier,
    target: action.target,
    ...(action.secondaryTarget ? { secondaryTarget: action.secondaryTarget } : {}),
    effects,
    order: state.plays.length,
  };
  // ADR-014: refuse a placement Sim.init would reject, so Go can never throw on it.
  const invalid = placementError(state.map, placement);
  if (invalid) return fail(invalid);

  // GDD §4: the same card on the same target does not stack (now or from an earlier round).
  const placed = [...state.runEffects, ...state.plays.map((p) => p.placement)];
  if (placed.some((p) => p.cardId === def.id && sameTarget(p.target, action.target))) {
    return fail('the same card on the same target does not stack');
  }

  const cost = costOf(state, card);
  if (cost > state.energy) return fail('not enough energy');

  const prng = clonePrng(state.prng);
  let energy = state.energy - cost;
  let hand = state.hand.filter((_, i) => i !== action.handIndex);
  let drawPile = state.drawPile.slice();
  let spent = state.spent.slice();
  let { nextDrawBonus, nextEnergyBonus, energyPerRound } = state;
  let pendingCost =
    state.pendingCost && state.pendingCost.remaining > 0
      ? { ...state.pendingCost, remaining: state.pendingCost.remaining - 1 }
      : state.pendingCost;
  const roundCostRules: CostRule[] = state.roundCostRules.slice();
  const runCostRules: CostRule[] = state.runCostRules.slice();
  const replacedSignal = controllerBeforeRound(state, action.target) === 'signal';

  // GDD §4: conflicting controllers: the last played wins and the earlier card is refunded.
  let plays: Play[] = state.plays.slice();
  let conflictRefund = 0;
  let replacedRefund = 0;
  if (effects.some((e) => e.kind === 'setController')) {
    plays = plays.map((p) => {
      const conflict =
        !p.refunded &&
        sameTarget(p.placement.target, action.target) &&
        p.placement.effects.some((e) => e.kind === 'setController');
      if (!conflict) return p;
      conflictRefund += p.paid;
      return { ...p, refunded: true };
    });
  }
  let redrew = false;

  for (const e of effects) {
    switch (e.kind) {
      case 'drawModifier':
        nextDrawBonus += e.delta;
        break;
      case 'energyModifier':
        if (e.condition === 'replaced-signal') {
          if (replacedSignal) replacedRefund += e.delta;
          break;
        }
        if (e.perRound) energyPerRound += e.delta;
        else if (e.when === 'now') energy += e.delta;
        else nextEnergyBonus += e.delta;
        break;
      case 'costModifier':
        if (e.next !== undefined && e.cost !== undefined) {
          pendingCost = { remaining: e.next, cost: e.cost };
        } else if (e.delta !== undefined) {
          (def.duration === 'run' ? runCostRules : roundCostRules).push({
            cards: e.cards,
            delta: e.delta,
          });
        }
        break;
      case 'redraw': {
        // GDD §4 Recount: redraw your hand; tier 2 keeps one card first.
        const keep =
          e.keep === 1 && action.keepHandIndex !== undefined
            ? hand[action.keepHandIndex]
            : undefined;
        const back = hand.filter((c) => c !== keep);
        const dealt = draw([...drawPile, ...back], spent, back.length, prng);
        hand = keep ? [keep, ...dealt.drawn] : dealt.drawn;
        drawPile = dealt.drawPile;
        spent = dealt.spent;
        redrew = true;
        break;
      }
      default:
        break; // Sim-level effects are applied by the sim from the placement.
    }
  }

  // ADR-018 point 4: refunds don't stack; when both trigger, only the larger applies.
  energy += Math.max(conflictRefund, replacedRefund);
  // Energy never goes below 0 within a round (ADR-014 bounds, ADR-018 point 7).
  energy = Math.max(0, energy);
  plays.push({ card, placement, paid: cost, refunded: false });

  return {
    ok: true,
    events: [],
    state: {
      ...state,
      prng,
      energy,
      hand,
      drawPile,
      spent,
      plays,
      nextDrawBonus,
      nextEnergyBonus,
      energyPerRound,
      pendingCost,
      roundCostRules,
      runCostRules,
      // ADR-018 point 8: no undo past a redraw, so the draw pile is never revealed for free.
      undoStack: redrew ? [] : [...state.undoStack, state],
    },
  };
}

/** The sim input for this round's Go phase (GDD §6 `RoundInput`). */
export function roundInput(state: RunState): RoundInput {
  return {
    seed: state.roundSeed,
    mapId: state.map.id,
    map: state.map,
    demandProfile: state.demandProfile,
    placements: state.plays.map((p) => p.placement),
    cardState: { runEffects: state.runEffects },
    districtRules: {
      district: state.config.district,
      round: state.round,
      rush: state.rush,
      boss: state.boss,
      quota: state.quota,
      pSlowPermille: state.pSlowPermille,
    },
    // Only when something is closed, so other rounds keep their input digests.
    ...(state.closedSegments.length > 0 ? { closedSegments: state.closedSegments } : {}),
  };
}

function deckTags(state: RunState): CardTag[] {
  const index = cardIndex(state.config);
  return deckOf(state).flatMap((c) => [...(index.get(c.id)?.tags ?? [])]);
}

/**
 * Scores the round from the sim's result (GDD §2 step 4). Pass: funds and a 3-card offer. Fail:
 * lose one approval; zero approval ends the run. The last round ends the run as a win.
 */
export function resolveRound(state: RunState, result: RoundResult): StepResult {
  if (state.phase !== 'place') return fail('not in the place phase');
  const pass = result.throughput >= state.quota;
  // Per-vehicle funds come from the sim (`fundsDelta`); flat ones from this round's plays and the
  // run's effects are applied here (ADR-018 point 7).
  const flat = flatFunds([...state.runEffects, ...state.plays.map((p) => p.placement)]);
  const fundsEarned = fundsFor(result.throughput, state.quota, pass, result.fundsDelta + flat);
  const approval = pass ? state.approval : state.approval - 1;
  const cardsPlayed = state.plays.map((p) => p.card.id);
  const runEffects = [
    ...state.runEffects,
    ...state.plays
      .filter((p) => cardOf(state.config, p.card.id).duration === 'run')
      .map((p) => p.placement),
  ];
  const outcome = {
    round: state.round,
    throughput: result.throughput,
    quota: state.quota,
    pass,
    gridlocked: result.gridlocked,
    ticks: result.ticks,
    fundsEarned,
    finalHash: result.finalHash,
    cardsPlayed,
  };
  // Unplayed cards return to the deck (bottom of the draw pile); played cards wait in `spent`.
  const next: RunState = {
    ...state,
    phase: 'result',
    approval,
    funds: Math.max(0, state.funds + fundsEarned),
    drawPile: [...state.drawPile, ...state.hand],
    spent: [...state.spent, ...state.plays.map((p) => p.card)],
    hand: [],
    plays: [],
    runEffects,
    roundCostRules: [],
    pendingCost: null,
    undoStack: [],
    history: [...state.history, outcome],
  };
  const events: RunEvent[] = [
    {
      event: 'round_end',
      props: {
        round: state.round,
        pass,
        throughput: result.throughput,
        quota: state.quota,
        cardsPlayed,
      },
    },
  ];

  const lost = approval <= 0;
  if (lost || state.round >= state.config.rounds) {
    const result = lost ? 'loss' : 'win';
    events.push({
      event: 'run_end',
      props: { rounds: state.round, result, deckTags: deckTags(next) },
    });
    return { ok: true, events, state: { ...next, phase: 'end', outcome: result } };
  }

  if (!pass) return { ok: true, events, state: next };
  const prng = clonePrng(next.prng);
  let nextUid = next.nextUid;
  const offer = buildOffer(state.config.cards, deckOf(next), state.round, prng).map(
    (id): DeckCard => ({ uid: nextUid++, id, tier: 1 }),
  );
  return { ok: true, events, state: { ...next, prng, nextUid, offer } };
}

/** Picks an offered card (or skips for +2 funds, GDD §2) and starts the next round. */
function choose(state: RunState, pick: number | 'skip', env: RunEnv): StepResult {
  if (state.phase !== 'result') return fail('not in the result phase');
  let { drawPile, funds } = state;
  const prng = clonePrng(state.prng);
  if (state.offer) {
    if (pick === 'skip') funds += 2;
    else {
      const card = state.offer[pick];
      if (!card) return fail('no card at that offer index');
      // ADR-018: a picked card is shuffled into the draw pile at a random position.
      const at = nextInt(prng, drawPile.length + 1);
      drawPile = [...drawPile.slice(0, at), card, ...drawPile.slice(at)];
    }
  }
  const nextState = startRound(
    { ...state, prng, drawPile, funds, offer: null },
    state.round + 1,
    env,
  );
  return { ok: true, events: [], state: nextState };
}

/** Applies one player action. Pure; errors leave the state unchanged. */
export function step(state: RunState, action: RunAction, env: RunEnv): StepResult {
  if (state.phase === 'end') return fail('the run has ended');
  switch (action.type) {
    case 'play':
      return play(state, action);
    case 'undo': {
      const prev = state.undoStack[state.undoStack.length - 1];
      if (state.phase !== 'place' || !prev) return fail('nothing to undo');
      return { ok: true, events: [], state: prev };
    }
    case 'go': {
      if (state.phase !== 'place') return fail('not in the place phase');
      const simulate = env.simulate ?? Sim.simulate;
      return resolveRound(state, simulate(roundInput(state)));
    }
    case 'choose':
      return choose(state, action.pick, env);
  }
}

/** Replays a run from its config and actions (save files store inputs only, GDD §6). */
export function replay(
  config: RunConfig,
  actions: readonly RunAction[],
  env: RunEnv,
): { state: RunState; events: RunEvent[] } {
  const start = startRun(config, env);
  let state = start.state;
  const events = [...start.events];
  for (const a of actions) {
    const r = step(state, a, env);
    if (!r.ok) throw new Error(`replay: ${r.error}`);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}
