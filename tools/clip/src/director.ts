/**
 * The clip's replay: a toy run (ADR-007: 5 rounds on District 1; since ADR-030 every one is a rush
 * round, from Market Day in round 1 to the Festival) built from its seed and an action list, exactly as a save stores it (GDD §6: "nothing
 * is recorded but inputs"). The clip shows one round of that run; by default the first rush round.
 *
 * When a spec carries no actions, `planRun` plays the run with a fixed one-round-lookahead
 * policy so a seed alone gives a clip: each round it plays the card and target that most raise
 * the round's throughput (up to the max plays), presses Go, and takes the first offered card.
 * It is not a balance bot (that is `packages/balance`); it only has to be deterministic and make
 * a round worth watching. Everything here is pure and runs the same in Node and in the browser.
 */
import {
  reverseSegment,
  roundInput,
  segmentRuns,
  startRun,
  step,
  toyRunConfig,
  type RunAction,
  type RunConfig,
  type RunEnv,
  type RunState,
} from '@rushwarden/app';
import { loadCards, setupRound, startingDeck } from '@rushwarden/content';
import { Sim, roundWorld, type BossCondition, type RoundInput, type Target } from '@rushwarden/sim';

/**
 * The seed of the Market Day clip (`clips/market-day*.json`), the store frames and the GIF. Its
 * rush round passes with the director's cards and gridlocks with none. Content tuning can change
 * that (ADR-028), so the tests pin both outcomes: when they fail after a content change, scan for
 * a new seed, change it here and in `clips/*.json`, and update docs/store.
 */
export const MARKET_DAY_SEED = 20;

/** How the target round is played when the spec has no actions for it. */
export type PlayPolicy = 'greedy' | 'none';

/** What a clip is made from. Saved next to every rendered clip so it can be reproduced. */
export interface ClipSpec {
  /** uint32 run seed. */
  readonly seed: number;
  /** The round to show; defaults to the run's first rush round (5 in the toy). */
  readonly round?: number;
  /** A recorded run: every action up to and including the target round's plays (no `go`). */
  readonly actions?: readonly RunAction[];
  /** Used only without `actions`: how the target round is played. Earlier rounds are greedy. */
  readonly plays?: PlayPolicy;
}

/** The round to render, and how the run got there. */
export interface ClipPlan {
  readonly seed: number;
  readonly round: number;
  readonly rush: boolean;
  readonly boss: BossCondition | null;
  readonly quota: number;
  /** Actions that reach the target round with its cards placed (replayable with `replayTo`). */
  readonly actions: readonly RunAction[];
  /** Card ids played in the target round, in order. */
  readonly cardsPlayed: readonly string[];
  readonly input: RoundInput;
}

const env: RunEnv = { setupRound };

/** The toy run's config for a seed: Phase 1 cards and the Phase 1 starting deck. */
export function toyConfig(seed: number): RunConfig {
  return toyRunConfig({ seed, cards: loadCards(), startingDeck: startingDeck() });
}

/** The first rush round of a config (round 1, Market Day, in the toy since ADR-030). */
export function rushRound(config: RunConfig): number {
  const first = [...config.rushRounds].sort((a, b) => a.round - b.round)[0];
  if (!first) throw new Error('the run has no rush round');
  return first.round;
}

/** Every target a card of this kind could take on the round's map, in a fixed order. */
export function candidateTargets(kind: Target['kind'], state: RunState): Target[] {
  const map = state.map;
  switch (kind) {
    case 'district':
      return [{ kind: 'district' }];
    case 'edge':
      return map.edges.map((e) => ({ kind: 'edge', edge: e.id }));
    case 'intersection': {
      const out: Target[] = [];
      for (const ix of roundWorld(roundInput(state)).intersections)
        out.push({ kind: 'intersection', tile: { x: ix.x, y: ix.y } });
      return out;
    }
    case 'segment':
      return segmentTargets(state);
  }
}

/**
 * Segment targets as a player places them (ADR-031): every full straight run of non-intersection
 * road tiles (`segmentRuns`, the same helper the run screen and the balance bots use), and, for
 * runs longer than one tile, the reverse too (`reverseSegment`). One-Way takes its direction from
 * the target, from `from` to `to`, and the sim rejects it on a one-tile run.
 */
function segmentTargets(state: RunState): Target[] {
  return segmentRuns(state.map).flatMap((t) =>
    t.kind === 'segment' && (t.from.x !== t.to.x || t.from.y !== t.to.y)
      ? [t, reverseSegment(t)]
      : [t],
  );
}

function throughput(state: RunState): number {
  return Sim.simulate(roundInput(state)).throughput;
}

/**
 * The single play that most raises this round's throughput, or null when none helps. Ties keep
 * the first in hand order, then target order, so the choice is deterministic.
 */
export function bestPlay(state: RunState): { action: RunAction; state: RunState } | null {
  if (state.plays.length >= state.config.maxPlays) return null;
  const cards = new Map(state.config.cards.map((c) => [c.id, c]));
  let best: { action: RunAction; state: RunState; score: number } | null = null;
  let baseline = throughput(state);
  for (let handIndex = 0; handIndex < state.hand.length; handIndex++) {
    const card = cards.get(state.hand[handIndex]?.id ?? '');
    if (!card) continue;
    for (const target of candidateTargets(card.target, state)) {
      const action: RunAction = { type: 'play', handIndex, target };
      const r = step(state, action, env);
      if (!r.ok) continue;
      const score = throughput(r.state);
      if (score > baseline) {
        baseline = score;
        best = { action, state: r.state, score };
      }
    }
  }
  return best && { action: best.action, state: best.state };
}

function playRound(state: RunState, policy: PlayPolicy, log: RunAction[]): RunState {
  let s = state;
  if (policy === 'none') return s;
  for (let p = bestPlay(s); p; p = bestPlay(s)) {
    log.push(p.action);
    s = p.state;
  }
  return s;
}

function apply(state: RunState, action: RunAction): RunState {
  const r = step(state, action, env);
  if (!r.ok) throw new Error(`replay refused ${JSON.stringify(action)}: ${r.error}`);
  return r.state;
}

/** Replays `actions` from the start of the run. */
export function replayTo(config: RunConfig, actions: readonly RunAction[]): RunState {
  let state = startRun(config, env).state;
  for (const a of actions) state = apply(state, a);
  return state;
}

/**
 * Plays the run to the target round and places its cards. Throws when the run ends before the
 * target round (approval reached 0), naming the seed, so a different seed can be picked.
 */
export function planRun(spec: ClipSpec): ClipPlan {
  const seed = spec.seed >>> 0;
  const config = toyConfig(seed);
  const round = spec.round ?? rushRound(config);
  if (!Number.isInteger(round) || round < 1 || round > config.rounds)
    throw new RangeError(`round must be 1..${config.rounds}, got ${round}`);

  const log: RunAction[] = [];
  let state: RunState;
  if (spec.actions) {
    state = replayTo(config, spec.actions);
    log.push(...spec.actions);
  } else {
    state = startRun(config, env).state;
    while (state.round < round) {
      state = playRound(state, 'greedy', log);
      log.push({ type: 'go' });
      state = apply(state, { type: 'go' });
      if (state.phase === 'end')
        throw new Error(
          `seed ${seed}: the run ended in round ${state.round} before round ${round}; pick another seed`,
        );
      const choose: RunAction = { type: 'choose', pick: state.offer?.length ? 0 : 'skip' };
      log.push(choose);
      state = apply(state, choose);
    }
    state = playRound(state, spec.plays ?? 'greedy', log);
  }
  if (state.phase !== 'place' || state.round !== round)
    throw new Error(
      `seed ${seed}: the actions end in round ${state.round} (${state.phase}), not before Go in round ${round}`,
    );
  return {
    seed,
    round,
    rush: state.rush,
    boss: state.boss,
    quota: state.quota,
    actions: log,
    cardsPlayed: state.plays.map((p) => p.card.id),
    input: roundInput(state),
  };
}
