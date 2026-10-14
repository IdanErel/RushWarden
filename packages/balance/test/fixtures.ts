import { fullRunConfig, type RunEnv } from '@rushwarden/app';
import type { RoundInput, RoundResult } from '@rushwarden/sim';
import type { Bot } from '../src/bots.js';
import { standinEnv } from './standin-env.js';
import type { RunRecord, RunSpec } from '../src/runner.js';
import { CARDS, STARTING_DECK } from '../src/data.js';

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * A deterministic fake sim that scores rounds from the cards played, so runs pass rounds, see
 * offers and draft (the real sim has no vehicles yet). Each card adds a fixed, id-dependent bonus;
 * seeds ending in 0 gridlock at tick 120.
 */
export function scoringSim(input: RoundInput): RoundResult {
  const bonus =
    input.placements.reduce((n, p) => n + 100 + (hashStr(p.cardId) % 140), 0) +
    input.cardState.runEffects.length * 40;
  const demand = input.demandProfile.length;
  const throughput = Math.floor((demand * (520 + bonus + (input.seed % 150))) / 1000);
  const gridlocked = input.seed % 10 === 0;
  return {
    throughput,
    spawned: demand,
    exited: throughput,
    ticks: gridlocked ? 120 : 300,
    gridlocked,
    fundsDelta: 0,
    diverted: 0,
    waiting: [],
    finalHash: input.seed.toString(16).padStart(16, '0'),
  };
}

export const scoredEnv: RunEnv = { setupRound: standinEnv.setupRound, simulate: scoringSim };

export function scoredSpec(bot: Bot): RunSpec {
  return {
    bot,
    env: scoredEnv,
    cards: CARDS,
    config: (seed) => fullRunConfig({ seed, cards: CARDS, startingDeck: STARTING_DECK }),
  };
}

export function record(over: Partial<RunRecord> & Pick<RunRecord, 'bot' | 'seed'>): RunRecord {
  return {
    district: 1,
    mayor: 'ada',
    win: false,
    rounds: 12,
    gridlockRounds: 0,
    ticks: 3600,
    deck: [],
    drafted: [],
    offered: [],
    throughputs: [],
    quotas: [],
    ...over,
  };
}
