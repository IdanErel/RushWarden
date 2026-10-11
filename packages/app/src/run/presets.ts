import { TOY_ROUNDS, toyRushRounds } from '@rushwarden/content';
import type { BossCondition } from '@rushwarden/sim';
import type { RunCard, RunConfig, RushRound } from './types.js';

/** GDD §5 rush-round bosses per district, for rounds 4, 8 and 12. */
export const DISTRICT_BOSSES: Record<
  1 | 2 | 3,
  readonly [BossCondition, BossCondition, BossCondition]
> = {
  1: ['market-day', 'parade', 'festival'],
  2: ['stadium-exit', 'signal-outage', 'blackout'],
  3: ['convoy', 'marathon', 'gridlock-drill'],
};

/**
 * The Phase 1 starting deck: GDD §4's default deck with Grant replaced by Pilot Program
 * (ADR-007 item 2).
 */
export const PHASE1_STARTING_DECK: readonly string[] = [
  'smart-signal',
  'smart-signal',
  'one-way',
  'one-way',
  'roundabout',
  'bus-priority',
  'detour',
  'overtime',
  'pilot-program',
  'turn-lane',
  'speed-limit-up',
  'recount',
];

/** GDD §2/§4 defaults: hand 5, energy 3, max 2 plays, approval 3. */
export const DEFAULT_RULES = {
  handSize: 5,
  energy: 3,
  maxPlays: 2,
  approval: 3,
  quotaPermille: 1000,
} as const;

interface PresetArgs {
  readonly seed: number;
  readonly cards: readonly RunCard[];
  readonly startingDeck?: readonly string[];
  readonly mayor?: string;
  readonly daily?: boolean;
}

/**
 * The itch toy: a 5-round District 1 run with no shop (ADR-007 item 1). Its rounds sample D1's
 * 12-round curve (ADR-030): content's `TOY_ROUNDS` picks each round's quota and demand, and
 * `toyRushRounds()` its rush flag and boss.
 */
export function toyRunConfig(a: PresetArgs): RunConfig {
  return {
    ...DEFAULT_RULES,
    seed: a.seed >>> 0,
    district: 1,
    mayor: a.mayor ?? 'ada',
    daily: a.daily ?? false,
    rounds: TOY_ROUNDS.length,
    rushRounds: toyRushRounds(),
    curveRounds: TOY_ROUNDS,
    templateDemand: true,
    startingDeck: a.startingDeck ?? PHASE1_STARTING_DECK,
    cards: a.cards,
  };
}

/** A full 12-round run (the balance runner's District 1 run): rush rounds 4, 8, 12 (GDD §2). */
export function fullRunConfig(a: PresetArgs & { readonly district?: 1 | 2 | 3 }): RunConfig {
  const district = a.district ?? 1;
  const bosses = DISTRICT_BOSSES[district];
  const rushRounds: RushRound[] = [4, 8, 12].map((round, i) => ({
    round,
    boss: bosses[i] ?? null,
  }));
  return {
    ...DEFAULT_RULES,
    seed: a.seed >>> 0,
    district,
    mayor: a.mayor ?? 'ada',
    daily: a.daily ?? false,
    rounds: 12,
    rushRounds,
    startingDeck: a.startingDeck ?? PHASE1_STARTING_DECK,
    cards: a.cards,
  };
}
