/**
 * The UI's seam onto the run controller (GDD §2 core loop). Screens read `RunState` and call
 * `RunPort`; nothing else. `ControllerRun` implements it over P1-BAL-01's `RunController`.
 */
import type { BossCondition, RoundInput, RoundResult, Side } from '@rushwarden/sim';
import type { TargetMark } from '@rushwarden/render/core';

export type Tag = 'FLOW' | 'MASS' | 'TOLL' | 'CHAOS' | 'TEMPO';
export type TargetKind = 'intersection' | 'segment' | 'edge' | 'district';

/** A card as the UI shows it. `text` is generated from effects by content (CON-01). */
export interface UiCard {
  readonly id: string;
  /** Tells copies of a card apart; stable while the card stays in the run's deck. */
  readonly uid: number;
  readonly name: string;
  readonly cost: number;
  readonly target: TargetKind;
  readonly tags: readonly Tag[];
  readonly text: string;
  readonly tier: 1 | 2;
  /** For cards that set a controller: the glyph to ghost-preview on the map. */
  readonly controller?: 'signal' | 'roundabout' | 'uncontrolled' | 'stop-all' | 'priority';
  /**
   * The player chooses which way it runs along its segment (One-Way, GDD §4 "one-way in the
   * chosen direction"). It is placed in the segment's default direction and flipped with `flip`.
   */
  readonly directional?: true;
}

export type MissReason = 'block' | 'junction' | 'road' | 'closed' | 'short';

/** A tile on the map grid. */
export interface TileXY {
  readonly x: number;
  readonly y: number;
}

export interface PlacedCard {
  readonly card: UiCard;
  readonly target: TargetMark;
  /** For a segment card: the straight run it was placed on, pointing the way the sim gets it. */
  readonly segment?: { readonly from: TileXY; readonly to: TileXY };
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
  /** Vehicles that entered the map and that left it (reached an exit) this round. */
  readonly spawned?: number;
  readonly exited?: number;
  /**
   * ADR-035: trips that came due but never got on the map (all edges, at round end), and trips
   * with no route to their destination that drove to another exit instead.
   */
  readonly waiting?: number;
  readonly diverted?: number;
}

/**
 * What a placement would cut off this round (ADR-035 `cutRoutes`), by map side: `exits` lose a
 * route into them, `entries` can no longer reach any exit (their traffic waits at the edge).
 * `edges` are the cut exits' map edge ids, for the cross on the map. `trucksOnly` when every cut
 * route is a truck's (No Heavy).
 */
export interface CutSummary {
  readonly exits: readonly Side[];
  readonly exitCount: number;
  readonly entries: readonly Side[];
  readonly edges: readonly number[];
  readonly trucksOnly: boolean;
}

export type Phase = 'place' | 'go' | 'result' | 'end';

export interface RunState {
  readonly phase: Phase;
  /** 1-based. */
  readonly round: number;
  readonly rounds: number;
  readonly rush: boolean;
  /** The rush round's event, if any. */
  readonly event: BossCondition | null;
  readonly quota: number;
  /**
   * The usual quota for this round of the run: the median over the maps the round can pick, for
   * the "busy map" note (QA re-check R3). Null when quotas don't depend on the map (full runs).
   */
  readonly quotaRef: number | null;
  readonly approval: number;
  readonly maxApproval: number;
  readonly energy: number;
  readonly maxEnergy: number;
  readonly playsLeft: number;
  /** Plays allowed per round (GDD: 2). */
  readonly maxPlays: number;
  readonly funds: number;
  readonly district: string;
  readonly hand: readonly UiCard[];
  readonly placed: readonly PlacedCard[];
  /** Set in `result` after a pass: cards to choose from (§2 step 4). */
  readonly offer: readonly UiCard[] | null;
  readonly last: RoundOutcome | null;
  readonly history: readonly RoundMark[];
  /** Every round played so far, oldest first (the run-end table). */
  readonly results: readonly RoundOutcome[];
  readonly won: boolean | null;
  readonly totalThroughput: number;
}

export interface RunPort {
  state(): RunState;
  /** Valid targets for hand card `i` this round, in a stable order. Empty if it cannot be played. */
  targets(handIndex: number): readonly TargetMark[];
  /** Plays hand card `i` on `target`. Throws if not allowed (the UI only offers valid ones). */
  place(handIndex: number, target: TargetMark): void;
  /**
   * Whether play `placedIndex` can still be taken back. False after a redraw (Recount) later in
   * the round, which the rules never undo (ADR-018 point 8), and outside the place phase.
   */
  canUndo(placedIndex: number): boolean;
  /**
   * The straight run a segment target covers, pointing the way a directional card placed on it
   * would run (its `reverse` included); null for any other target. For the One-Way preview.
   */
  segmentOf(target: TargetMark): { readonly from: TileXY; readonly to: TileXY } | null;
  /**
   * What playing hand card `handIndex` on `target` would cut off (ADR-035), or null when it cuts
   * nothing or is not a legal play. Cheap enough for every cursor move.
   */
  cutsAt(handIndex: number, target: TargetMark): CutSummary | null;

  /**
   * Why hand card `i` cannot go on `tile`, for the note on a tap that places nothing (U5):
   * `block` (a building), `junction` / `road` (the other kind of tile than the card takes),
   * `closed` (a road closed this round, Parade), `short` (a one-tile road a directional card
   * cannot point along), or null when there is no simpler reason to give.
   */
  missReason(handIndex: number, tile: TileXY): MissReason | null;
  /** Takes back a card placed this round ("tap again to undo before Go"). No-op if `!canUndo`. */
  undo(placedIndex: number): void;
  /** Whether play `placedIndex` is a directional card that can still be turned round. */
  canFlip(placedIndex: number): boolean;
  /** Turns a directional play round on its segment (from ↔ to). No-op if `!canFlip`. */
  flip(placedIndex: number): void;
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
