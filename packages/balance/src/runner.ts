import {
  deckOf,
  startRun,
  step,
  type RunAction,
  type RunCard,
  type RunConfig,
  type RunEnv,
  type RunState,
} from '@rushwarden/app';
import { botContext, type Bot } from './bots.js';

/** One finished run, everything the report needs. Plain data, so workers can post it. */
export interface RunRecord {
  readonly bot: string;
  readonly seed: number;
  readonly district: number;
  readonly mayor: string;
  readonly win: boolean;
  /** Rounds played (the round of death on a loss). */
  readonly rounds: number;
  readonly gridlockRounds: number;
  /** Simulated ticks over all rounds (20 per second): the run's watch time at 1×. */
  readonly ticks: number;
  /** Final deck, card ids sorted. */
  readonly deck: readonly string[];
  /** Cards picked from offers, in order. */
  readonly drafted: readonly string[];
  /** Every card offered, in order (repeats counted). */
  readonly offered: readonly string[];
  readonly throughputs: readonly number[];
}

export interface RunSpec {
  readonly bot: Bot;
  readonly config: (seed: number) => RunConfig;
  readonly env: RunEnv;
  readonly cards: readonly RunCard[];
  readonly targetsPerKind?: number;
}

/** Bot salts are fixed per bot name, so adding a bot never changes another bot's runs. */
function salt(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) >>> 0;
  return h;
}

function apply(state: RunState, action: RunAction, env: RunEnv): RunState {
  const r = step(state, action, env);
  if (!r.ok) throw new Error(`bot made an illegal action ${JSON.stringify(action)}: ${r.error}`);
  return r.state;
}

/** Plays one full run with a bot. Deterministic in (bot, seed, config, env). */
export function runOne(spec: RunSpec, seed: number): RunRecord {
  const config = spec.config(seed);
  const ctx = botContext(seed, salt(spec.bot.name), spec.env, spec.cards, spec.targetsPerKind);
  let state = startRun(config, spec.env).state;
  const drafted: string[] = [];
  const offered: string[] = [];
  while (state.phase !== 'end') {
    for (const a of spec.bot.plays(state, ctx)) state = apply(state, a, spec.env);
    state = apply(state, { type: 'go' }, spec.env);
    if (state.phase === 'result') {
      const offer = state.offer;
      let pick: number | 'skip' = 'skip';
      if (offer) {
        offered.push(...offer.map((c) => c.id));
        pick = spec.bot.pick(state, ctx);
        const card = pick === 'skip' ? undefined : offer[pick];
        if (card) drafted.push(card.id);
      }
      state = apply(state, { type: 'choose', pick }, spec.env);
    }
  }
  return {
    bot: spec.bot.name,
    seed,
    district: config.district,
    mayor: config.mayor,
    win: state.outcome === 'win',
    rounds: state.history.length,
    gridlockRounds: state.history.filter((h) => h.gridlocked).length,
    ticks: state.history.reduce((n, h) => n + h.ticks, 0),
    deck: deckOf(state)
      .map((c) => c.id)
      .sort(),
    drafted,
    offered,
    throughputs: state.history.map((h) => h.throughput),
  };
}

/** Runs a list of seeds in order. Workers call this on their share; results merge by (bot, seed). */
export function runSeeds(spec: RunSpec, seeds: readonly number[]): RunRecord[] {
  return seeds.map((s) => runOne(spec, s));
}

/** The fixed seed set: seeds 1..n (documented in the report header and ADR-019). */
export function seedSet(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1);
}

/** Sorts records into the canonical order, so parallel and serial runs give identical reports. */
export function canonical(records: readonly RunRecord[], botOrder: readonly string[]): RunRecord[] {
  return records
    .slice()
    .sort((a, b) => botOrder.indexOf(a.bot) - botOrder.indexOf(b.bot) || a.seed - b.seed);
}
