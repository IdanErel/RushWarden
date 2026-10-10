/**
 * The 20 Phase 1 cards (docs/tasks/phase-1.md, ADR-007), 4 per archetype, by id.
 *
 * Each one is either bundled in `cards/` or listed in `PHASE1_BLOCKED` with the sim primitive or
 * parameter it is missing; `Effect` in packages/sim/src/types.ts cannot express it exactly as
 * GDD §4 states it, and content never approximates a card (GDD §4: a new card needs the primitive
 * in the sim first). A test keeps the two lists in step. Effect union v2 (ADR-014) unblocked
 * all but one.
 */
export const PHASE1_CARD_IDS = [
  // FLOW
  'smart-signal',
  'one-way',
  'turn-lane',
  'speed-limit-up',
  // MASS
  'bus-priority',
  'express-stop',
  'bus-lane',
  'fare-holiday',
  // TOLL
  'detour',
  'toll-booth',
  'staggered-hours',
  'delivery-window',
  // CHAOS
  'roundabout',
  'yield-culture',
  'no-heavy',
  'remove-signal',
  // TEMPO
  'overtime',
  'second-shift',
  'pilot-program',
  'recount',
] as const;

export type Phase1CardId = (typeof PHASE1_CARD_IDS)[number];

/** Phase 1 cards waiting on a sim primitive or parameter, with what is missing. */
export const PHASE1_BLOCKED: Readonly<Partial<Record<Phase1CardId, string>>> = {
  'pilot-program':
    'costModifier { cards, delta } cannot say "the next card played this round costs 0" (tier 2: next two): it has no count of upcoming plays, no round scope, and only a relative delta; needs e.g. costModifier { next: 1 | 2, cost: 0 } (cost absolute, applies to the next N cards played this round)',
};
