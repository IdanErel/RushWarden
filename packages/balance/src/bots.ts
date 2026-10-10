import {
  Sim,
  createPrng,
  nextInt,
  placementError,
  type Placement,
  type PrngState,
  type RoundInput,
  type RoundResult,
  type Target,
} from '@rushwarden/sim';
import {
  costOf,
  resolveTier,
  roundInput,
  step,
  type CardTag,
  type RunAction,
  type RunCard,
  type RunEnv,
  type RunState,
} from '@rushwarden/app';
import { candidateTargets, directedSegments, spread } from './targets.js';

/**
 * The candidate targets for a card's effects: `setOneWay` without a direction needs a two-tile
 * directed segment, so it gets `directedSegments` instead of the single-tile segments.
 */
function targetsFor(
  map: RoundInput['map'],
  kind: RunCard['target'],
  effects: readonly Placement['effects'][number][],
): Target[] {
  if (
    kind === 'segment' &&
    effects.some((e) => e.kind === 'setOneWay' && e.direction === undefined)
  )
    return directedSegments(map);
  return candidateTargets(map)[kind];
}

/** GDD §11 drafter bots. A bot only chooses actions; the run controller enforces the rules. */
export interface Bot {
  readonly name: string;
  /** The plays for this round's place phase, applied in order (each must be legal). */
  plays(state: RunState, ctx: BotContext): RunAction[];
  /** Index into the offer, or 'skip'. */
  pick(state: RunState, ctx: BotContext): number | 'skip';
}

export interface BotContext {
  /** The bot's own stream, seeded per run; never the run's PRNG (so bots cannot steer the run). */
  readonly prng: PrngState;
  readonly env: RunEnv;
  readonly cards: ReadonlyMap<string, RunCard>;
  /** Targets per card kind considered by lookahead bots. */
  readonly targetsPerKind: number;
}

export function botContext(
  seed: number,
  salt: number,
  env: RunEnv,
  cards: readonly RunCard[],
  targetsPerKind = 3,
): BotContext {
  return {
    prng: createPrng((seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0),
    env,
    cards: new Map(cards.map((c) => [c.id, c])),
    targetsPerKind,
  };
}

const simulate = (env: RunEnv, input: RoundInput): RoundResult =>
  (env.simulate ?? Sim.simulate)(input);

/** Legal (card, target) plays from the hand, validated against the map like `Sim.init` does. */
function legalPlays(
  state: RunState,
  ctx: BotContext,
  allTargets: boolean,
): { handIndex: number; target: Target }[] {
  const out: { handIndex: number; target: Target }[] = [];
  state.hand.forEach((card, handIndex) => {
    const def = ctx.cards.get(card.id);
    if (!def || costOf(state, card) > state.energy) return;
    const effects = resolveTier(def, card.tier).effects;
    const targets = targetsFor(state.map, def.target, effects);
    const list = allTargets ? targets : spread(targets, ctx.targetsPerKind);
    for (const target of list) {
      const placement: Placement = {
        cardId: def.id,
        tier: card.tier,
        target,
        effects,
        order: state.plays.length,
      };
      if (placementError(state.map, placement) === null) out.push({ handIndex, target });
    }
  });
  return out;
}

function tryPlay(
  state: RunState,
  ctx: BotContext,
  p: { handIndex: number; target: Target },
): RunState | null {
  const r = step(state, { type: 'play', ...p }, ctx.env);
  return r.ok ? r.state : null;
}

/** Plays up to the play limit, each time taking the legal play whose round scores highest. */
function greedyPlays(state: RunState, ctx: BotContext, prefer?: CardTag): RunAction[] {
  const actions: RunAction[] = [];
  let s = state;
  while (s.plays.length < s.config.maxPlays) {
    let options = legalPlays(s, ctx, false);
    if (prefer) {
      const tagged = options.filter((o) =>
        ctx.cards.get(s.hand[o.handIndex]?.id ?? '')?.tags.includes(prefer),
      );
      if (tagged.length > 0) options = tagged;
    }
    let best: { action: RunAction; state: RunState; score: number } | null = null;
    for (const o of options) {
      const next = tryPlay(s, ctx, o);
      if (!next) continue;
      const score = simulate(ctx.env, roundInput(next)).throughput;
      if (!best || score > best.score)
        best = { action: { type: 'play', ...o }, state: next, score };
    }
    // One-round lookahead: play when it does not lower this round's score (unspent energy is lost).
    const baseline = simulate(ctx.env, roundInput(s)).throughput;
    if (!best || best.score < baseline) break;
    actions.push(best.action);
    s = best.state;
  }
  return actions;
}

/** Score of an offered card played alone on its best target, on the round just played. */
function offerScore(state: RunState, ctx: BotContext, id: string): number {
  const def = ctx.cards.get(id);
  if (!def) return -1;
  const effects = resolveTier(def, 1).effects;
  const base = roundInput({ ...state, plays: [] });
  let best = -1;
  for (const target of spread(targetsFor(state.map, def.target, effects), ctx.targetsPerKind)) {
    const placement: Placement = { cardId: id, tier: 1, target, effects, order: 0 };
    if (placementError(state.map, placement) !== null) continue;
    best = Math.max(best, simulate(ctx.env, { ...base, placements: [placement] }).throughput);
  }
  return best;
}

function bestOffer(
  state: RunState,
  ctx: BotContext,
  allowed: (id: string) => boolean,
): number | 'skip' {
  let best: { i: number; score: number } | null = null;
  (state.offer ?? []).forEach((c, i) => {
    if (!allowed(c.id)) return;
    const score = offerScore(state, ctx, c.id);
    if (score >= 0 && (!best || score > best.score)) best = { i, score };
  });
  return best === null ? 'skip' : (best as { i: number }).i;
}

/** `random`: random legal plays (0 to the limit) and a random offer pick or skip. */
export const randomBot: Bot = {
  name: 'random',
  plays(state, ctx) {
    const actions: RunAction[] = [];
    let s = state;
    const want = nextInt(ctx.prng, s.config.maxPlays + 1);
    while (actions.length < want) {
      const options = legalPlays(s, ctx, true);
      if (options.length === 0) break;
      const o = options[nextInt(ctx.prng, options.length)];
      if (!o) break;
      const next = tryPlay(s, ctx, o);
      if (!next) break;
      actions.push({ type: 'play', ...o });
      s = next;
    }
    return actions;
  },
  pick(state, ctx) {
    const n = state.offer?.length ?? 0;
    const i = nextInt(ctx.prng, n + 1);
    return i === n ? 'skip' : i;
  },
};

/** `greedy-throughput`: the play and the pick with the best one-round lookahead (§11). */
export const greedyBot: Bot = {
  name: 'greedy-throughput',
  plays: (state, ctx) => greedyPlays(state, ctx),
  pick: (state, ctx) => bestOffer(state, ctx, () => true),
};

/** `archetype(tag)`: greedy, but plays its tag's cards first and only drafts its tag (§11). */
export function archetypeBot(tag: CardTag): Bot {
  return {
    name: `archetype(${tag})`,
    plays: (state, ctx) => greedyPlays(state, ctx, tag),
    pick: (state, ctx) =>
      bestOffer(state, ctx, (id) => ctx.cards.get(id)?.tags.includes(tag) ?? false),
  };
}

export const ARCHETYPE_TAGS: readonly CardTag[] = ['FLOW', 'MASS', 'TOLL', 'CHAOS', 'TEMPO'];

/** All Phase 1 bots, in report order. */
export function phase1Bots(): Bot[] {
  return [randomBot, greedyBot, ...ARCHETYPE_TAGS.map(archetypeBot)];
}

export function botByName(name: string): Bot {
  const bot = phase1Bots().find((b) => b.name === name);
  if (!bot) throw new Error(`unknown bot ${name}`);
  return bot;
}
