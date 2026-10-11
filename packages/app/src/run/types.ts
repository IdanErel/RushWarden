import type {
  BossCondition,
  DemandProfile,
  Effect,
  GridMap,
  Placement,
  PrngState,
  RoundInput,
  RoundResult,
  SegmentId,
  Target,
} from '@rushwarden/sim';

/**
 * Types of the deterministic run controller (GDD §2 core loop, §4 draft rules, ADR-007, ADR-018).
 * Everything here is plain data: integers, strings and arrays, so a run is replayable from its
 * config and its action list (GDD §6: "nothing is recorded but inputs").
 */

export type CardTag = 'FLOW' | 'MASS' | 'TOLL' | 'CHAOS' | 'TEMPO';
export const TAG_ORDER: readonly CardTag[] = ['FLOW', 'MASS', 'TOLL', 'CHAOS', 'TEMPO'];
export type Rarity = 'common' | 'uncommon' | 'rare';
export type TargetKind = Target['kind'];

/**
 * The card fields the controller needs. Structurally a subset of `CardDef` in
 * `@rushwarden/content`, so content's loaded cards can be passed in directly.
 */
export interface RunCard {
  readonly id: string;
  readonly cost: number;
  readonly target: TargetKind;
  readonly duration: 'round' | 'run';
  readonly rarity: Rarity;
  readonly tags: readonly CardTag[];
  readonly effects: readonly Effect[];
  readonly upgrade: { readonly cost?: number; readonly effects?: readonly Effect[] };
}

/** One card in the run's deck. `uid` tells copies apart. */
export interface DeckCard {
  readonly uid: number;
  readonly id: string;
  readonly tier: 1 | 2;
}

export interface RushRound {
  readonly round: number;
  readonly boss: BossCondition | null;
}

export interface RunConfig {
  /** uint32 run seed; every random choice in the run comes from it. */
  readonly seed: number;
  readonly district: 1 | 2 | 3;
  readonly mayor: string;
  readonly daily: boolean;
  /** 5 for the itch toy, 12 for a full run (ADR-007 item 1). */
  readonly rounds: number;
  /** Rush rounds (1.6× demand, boss condition). */
  readonly rushRounds: readonly RushRound[];
  /**
   * ADR-030: for each round of this run, the district-curve round it plays (its quota and demand
   * via `roundQuota` and `setupRound`). Absent: round `r` plays curve round `r` (full runs).
   */
  readonly curveRounds?: readonly number[];
  /** Starting deck, by card id, tier 1. */
  readonly startingDeck: readonly string[];
  /** Every card that can be drawn or offered. */
  readonly cards: readonly RunCard[];
  readonly handSize: number;
  readonly energy: number;
  readonly maxPlays: number;
  readonly approval: number;
  /** Mayor quota modifier in per-mille (1000 = none; Economist 1100, Intern 1150). */
  readonly quotaPermille: number;
}

/** A card played this round. */
export interface Play {
  readonly card: DeckCard;
  readonly placement: Placement;
  /** Energy paid (after cost modifiers); refunded if a later controller card overrides it. */
  readonly paid: number;
  readonly refunded: boolean;
}

export interface CostRule {
  readonly cards: readonly string[] | 'all';
  readonly delta: number;
}

export interface RoundOutcome {
  readonly round: number;
  readonly throughput: number;
  readonly quota: number;
  readonly pass: boolean;
  readonly gridlocked: boolean;
  /** Ticks simulated (fewer than 300 on gridlock): the round's watch time at 1×. */
  readonly ticks: number;
  readonly fundsEarned: number;
  readonly finalHash: string;
  readonly cardsPlayed: readonly string[];
}

export type RunPhase = 'place' | 'result' | 'end';

export interface RunState {
  readonly config: RunConfig;
  readonly phase: RunPhase;
  /** The run PRNG; cloned before every use, never mutated in a state that has been returned. */
  readonly prng: PrngState;
  readonly nextUid: number;
  /** 1-based. */
  readonly round: number;
  readonly approval: number;
  readonly funds: number;

  readonly drawPile: readonly DeckCard[];
  /** Played cards waiting for the next reshuffle. */
  readonly spent: readonly DeckCard[];
  readonly hand: readonly DeckCard[];

  readonly energy: number;
  readonly plays: readonly Play[];

  // Round setup, fixed at round start so demand can be shown before placement (GDD §2).
  readonly roundSeed: number;
  readonly map: GridMap;
  readonly demandProfile: DemandProfile;
  readonly rush: boolean;
  readonly boss: BossCondition | null;
  readonly quota: number;
  /** Segments closed for the round (the Parade boss, ADR-021/ADR-022), from `setupRound`. */
  readonly closedSegments: readonly SegmentId[];
  /** The round's NaSch p_slow (GDD §3 rule 3) from the district rules `setupRound` returns. */
  readonly pSlowPermille: number;

  // Run-level effects.
  readonly runEffects: readonly Placement[];
  readonly runCostRules: readonly CostRule[];
  readonly roundCostRules: readonly CostRule[];
  /** Pilot Program: the next `remaining` plays this round cost exactly `cost`. */
  readonly pendingCost: { readonly remaining: number; readonly cost: number } | null;
  readonly nextDrawBonus: number;
  readonly nextEnergyBonus: number;
  readonly energyPerRound: number;

  /** States before each play this round, for undo (GDD §8 "tap again to undo before Go"). */
  readonly undoStack: readonly RunState[];
  readonly history: readonly RoundOutcome[];
  /** Cards offered after a passed round; null when there is no offer. */
  readonly offer: readonly DeckCard[] | null;
  readonly outcome: 'win' | 'loss' | null;
}

export type RunAction =
  | {
      readonly type: 'play';
      readonly handIndex: number;
      readonly target: Target;
      readonly secondaryTarget?: Target;
      /** For a `redraw` with `keep: 1`: the hand index (after this card leaves) to keep. */
      readonly keepHandIndex?: number;
    }
  | { readonly type: 'undo' }
  | { readonly type: 'go' }
  | { readonly type: 'choose'; readonly pick: number | 'skip' };

/** Where each round's map and demand come from (content, P1-CON-03/04) and how it is simulated. */
export interface RunEnv {
  setupRound(args: {
    readonly district: 1 | 2 | 3;
    readonly round: number;
    readonly rush: boolean;
    readonly boss: BossCondition | null;
    readonly seed: number;
  }): {
    readonly map: GridMap;
    readonly demandProfile: DemandProfile;
    /** Segments closed for the round (Parade). Content's `setupRound` returns them; default none. */
    readonly closedSegments?: readonly SegmentId[];
    /** The round's district rules; only `pSlowPermille` is read (default 0). */
    readonly districtRules?: { readonly pSlowPermille: number };
  };
  /** Defaults to `Sim.simulate`. */
  simulate?(input: RoundInput): RoundResult;
}

/** The three run events of ADR-007, shaped as GDD §10 lists them. */
export type RunEvent =
  | {
      readonly event: 'run_start';
      readonly props: { mayor: string; district: number; daily: boolean };
    }
  | {
      readonly event: 'round_end';
      readonly props: {
        round: number;
        pass: boolean;
        throughput: number;
        quota: number;
        cardsPlayed: string[];
      };
    }
  | {
      readonly event: 'run_end';
      readonly props: { rounds: number; result: 'win' | 'loss'; deckTags: CardTag[] };
    };

export type StepResult =
  | { readonly ok: true; readonly state: RunState; readonly events: readonly RunEvent[] }
  | { readonly ok: false; readonly error: string };
