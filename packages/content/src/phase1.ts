/**
 * The 20 Phase 1 cards (docs/tasks/phase-1.md, ADR-007), 4 per archetype, by id.
 *
 * Each one is either bundled in `cards/` or listed in `PHASE1_BLOCKED` with the sim primitive or
 * parameter it is missing; `Effect` in packages/sim/src/types.ts cannot express it exactly as
 * GDD §4 states it, and content never approximates a card (GDD §4: a new card needs the primitive
 * in the sim first). A test keeps the two lists in step.
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
  'smart-signal':
    'tier 2 "phase switch 2 ticks faster": setSignalPhase.switchTicks is absolute and the default adaptive switch time is not defined; needs a relative switchTicksDelta or a published default',
  'one-way':
    'setOneWay.direction is required card data, but the card says "in the chosen direction" (picked at play); needs direction optional and taken from the placed segment (from -> to)',
  'turn-lane':
    'no primitive for a dedicated turn reservation cell; needs e.g. addTurnLane { turns: "left" | "both" }',
  'bus-lane':
    'no primitive to reserve one lane for some types; needs e.g. reserveLane { vehicleTypes } (tier 2 then adds setSpeedLimit for bikes)',
  detour:
    'reroute.toEdge is a map-specific edge id; needs a target-relative destination: "adjacent" (tier 1) and a second player-chosen edge (tier 2)',
  'toll-booth':
    'setSpeedLimit only has a delta; "slow to 1 for 2 cells" needs an absolute cap and a cell span, e.g. setSpeedLimit { max: 1, cells: 2 }',
  'staggered-hours':
    'no demand-shaping primitive; needs e.g. smoothDemand { peakPercent } that flattens the profile before Go',
  'delivery-window':
    'spawnModifier has no time window; needs e.g. spawnWindow { vehicleType, fromTick, toTick } (tier 2 adds scoreModifier, which exists)',
  'no-heavy':
    'tier 2 "district-wide for one road class": the map has no road classes (MapTile has lanes, busStop, ring) and an upgrade would change the target kind; needs a road-class definition (design) and a scope parameter on banType',
  'remove-signal':
    'energyModifier has no condition; "refund 1 energy if it was a signal" needs e.g. condition: "replaced-signal" and an immediate timing',
  overtime:
    'energyModifier has no timing; "+1 energy next round" needs e.g. when: "now" | "next-round" (Remove Signal needs "now")',
  'second-shift': 'tier 2 "+1 energy" next round: same energyModifier timing parameter as Overtime',
  'pilot-program':
    'no cost primitive; "the next card played this round costs 0" needs e.g. costModifier { cards: 1, cost: 0 }',
  recount: 'no redraw primitive; needs e.g. redraw { keep: 0 | 1 }',
};
