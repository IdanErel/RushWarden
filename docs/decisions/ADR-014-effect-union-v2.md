# ADR-014: Effect union v2

Status: Accepted · 2026-10-10 · Lead (decisions), Sim Engineer (P1-SIM-01b, written up)

Content could not express 14 of the 20 Phase 1 cards with the Phase 0 `Effect` union. The Lead
decided the following interface change to `packages/sim/src/types.ts`. The sim applies these
effects in P1-SIM-05. For now `Sim.init` only validates them, and no current input uses them, so
golden hashes are unchanged.

1. `setSignalPhase` gains `switchTicksDelta?`, a change relative to the new constant
   `DEFAULT_SWITCH_TICKS` = 6 ticks (0.3 s between greens). Smart Signal's upgrade is −2.
   The absolute `switchTicks?` stays as an override.
2. `setOneWay.direction` is optional. When it is absent, traffic flows along the placed segment
   target from `from` to `to`, so the segment must span at least two tiles.
3. New `addTurnLane { turns: 'left' | 'both' }` (Turn Lane).
4. New `reserveLane { vehicleTypes }` (Bus Lane): the kerb lane is reserved for these types.
5. `reroute` replaces the map-specific `toEdge` with `to: 'adjacent' | 'secondary'`.
   - `adjacent` is the next edge clockwise along the map boundary.
   - `secondary` is the edge in the new `Placement.secondaryTarget`, used by cards where the
     player picks a second target. It must be an edge target.
6. `setSpeedLimit` gains an absolute `max?` (applied after `delta`, 0..15) and a `cells?` span,
   counted from the segment's upstream end. `delta` stays. Toll Booth is `{ delta: 0, max: 1, cells: 2 }`.
7. New `smoothDemand { peakPermille }` (Staggered Hours), 0..1000.
8. New `spawnWindow { vehicleType, fromTick, toTick }` (Delivery Window), half-open
   `[fromTick, toTick)` within the round.
9. Road class is derived, not authored. `RoadClass` is `local` for a 1-lane segment and `arterial`
   for 2 or more lanes. `banType` gains `scope?: 'target' | { roadClass }`, and a road-class
   scope applies across the whole district.
10. `energyModifier` gains `when: 'now' | 'next-round'` (required) and
    `condition?: 'replaced-signal'` (Remove Signal's refund).
11. New `costModifier { cards: string[] | 'all', delta }` (Pilot Program).
12. New `redraw { keep: 0 | 1 }` (Recount).
13. `drawModifier` applies to the next round's draw.
14. Express Stop (`setBusStopDwell`, see addendum 2) is valid only on a segment that already has a bus
    stop tile. `Sim.init` rejects it elsewhere, and the UI uses `placementError(map, placement)`
    to grey out such targets.

Run-controller effects (`drawModifier`, `energyModifier`, `costModifier`, `redraw`,
`fundsModifier`) travel in `Placement.effects` but the sim ignores them. Their numeric ranges
(for example `costModifier.delta` and `drawModifier.delta`) are bounded by the content schema
and enforced by the run controller, not by `Sim.init`.

Sim Engineer details:

- A segment target is a straight run of tiles from `from` to `to`, inclusive, along one row or
  column (`segmentTiles`). Diagonal or out-of-bounds segments are invalid placements.
- `Sim.init` also rejects these, with a `RangeError` naming the card:
  - an edge target, or a secondary target, naming an unknown edge;
  - an out-of-bounds intersection tile;
  - out-of-range parameters.

  It checks both `placements` and `cardState.runEffects`.

## Addendum (P1-SIM-01c, 2026-10-10, Lead)

1. `costModifier` gains `next?: 1 | 2` and `cost?: number`: the next N cards played this round
   cost exactly `cost` energy (0..3), for Pilot Program. `delta` becomes optional. Exactly one form
   must be set: either `delta`, or both `next` and `cost`. `Sim.init` rejects anything else.
2. `addBusStop` is renamed `setBusStopDwell`. Its behaviour is unchanged: it is valid only on a
   segment that already has a bus stop.
3. `banType.scope` gains `'target-class'`, the road class of the placed segment applied across the
   whole district. It needs a segment target.

Golden hashes are unchanged: no golden input uses placements.
