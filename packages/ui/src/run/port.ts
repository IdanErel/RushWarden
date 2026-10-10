/**
 * The UI's seam onto the run controller (GDD §2 core loop). Screens read `RunState` and call
 * `RunPort`; nothing else. `ControllerRun` implements it over P1-BAL-01's `RunController`.
 */
import type { RoundInput, RoundResult } from '@rushwarden/sim';
import type { TargetMark } from '@rushwarden/render/core';

export type Tag = 'FLOW' | 'MASS' | 'TOLL' | 'CHAOS' | 'TEMPO';
export type TargetKind = 'intersection' | 'segment' | 'edge' | 'district';

/** A card as the UI shows it. `text` is generated from effects by content (CON-01). */
export interface UiCard {
  readonly id: string;
  readonly name: string;
  readonly cost: number;
  readonly target: TargetKind;
  readonly tags: readonly Tag[];
  readonly text: string;
  readonly tier: 1 | 2;
  /** For cards that set a controller: the glyph to ghost-preview on the map. */
  readonly controller?: 'signal' | 'roundabout' | 'uncontrolled' | 'stop-all' | 'priority';
}

export interface PlacedCard {
  readonly card: UiCard;
  readonly target: TargetMark;
}

/** §5 share glyphs: green pass, amber pass under 110%, red fail, black gridlock. */
export type RoundMark = 'pass' | 'near' | 'fail' | 'gridlock';

export interface RoundOutcome {
  readonly round: number;
  readonly pass: boolean;
  readonly throughput: number;
  readonly quota: number;
  readonly gridlocked: boolean;
  readonly fundsEarned: number;
  readonly approvalLost: number;
  /** The sim's final-state hash for the round (test hook H2 `data-round-hash`). */
  readonly hash: string;
}

export type Phase = 'place' | 'go' | 'result' | 'end';

export interface RunState {
  readonly phase: Phase;
  /** 1-based. */
  readonly round: number;
  readonly rounds: number;
  readonly rush: boolean;
  readonly quota: number;
  readonly approval: number;
  readonly maxApproval: number;
  readonly energy: number;
  readonly maxEnergy: number;
  readonly playsLeft: number;
  readonly funds: number;
  readonly district: string;
  readonly hand: readonly UiCard[];
  readonly placed: readonly PlacedCard[];
  /** Set in `result` after a pass: cards to choose from (§2 step 4). */
  readonly offer: readonly UiCard[] | null;
  readonly last: RoundOutcome | null;
  readonly history: readonly RoundMark[];
  readonly won: boolean | null;
  readonly totalThroughput: number;
}

export interface RunPort {
  state(): RunState;
  /** Valid targets for hand card `i` this round, in a stable order. Empty if it cannot be played. */
  targets(handIndex: number): readonly TargetMark[];
  /** Plays hand card `i` on `target`. Throws if not allowed (the UI only offers valid ones). */
  place(handIndex: number, target: TargetMark): void;
  /** Takes back a card placed this round ("tap again to undo before Go"). */
  undo(placedIndex: number): void;
  /** The sim input for this round's Go phase, including the placements. */
  roundInput(): RoundInput;
  /** Moves to `go`. */
  go(): void;
  /** Feeds the sim's result; moves to `result` or `end`. */
  finishRound(result: RoundResult): void;
  /** Takes offer card `i`, or skips for funds with null. Then the next round (or end). */
  pickOffer(i: number | null): void;
  /** After a failed round's result: continue to the next round (or end). */
  next(): void;
  /** Starts a new run with the same settings. */
  retry(): void;
}
