# ADR-022: p_slow, the gridlock detector and closed segments

Status: Proposed · 2026-10-10 · Sim Engineer (P1-SIM-04). Number assigned by the
Lead.

GDD §3 fixes tick rule 3 ("the classic NaSch slowdown probability exists as a parameter `p_slow`
… driven by the seeded PRNG only") and the gridlock detector ("if the sum of `v` across all
vehicles is 0 for 60 consecutive ticks, the round ends"). The Lead added a round input for the
Parade boss ("one segment closed", §5). The brief leaves the details below open. Demand spawning
and throughput scoring, also listed under P1-SIM-04, shipped with P1-SIM-02 (ADR-017 points 4
and 8).

1. **Rule 3.** After rule 2, a vehicle with v > 0 slows by 1 with probability
   `pSlowPermille / 1000`, drawn with `chancePermille` from the round's xoshiro128\*\* in update
   order.
   - A vehicle whose gap leaves it at v = 0, or a dwelling bus, draws nothing.
   - With p_slow 0 nothing is drawn at all, so rounds without p_slow keep their hashes and pay
     no cost.
   - At 1000 the draw is skipped and the vehicle always slows (`chancePermille` short-circuits).
     A vehicle at rest then never moves, which is classic NaSch behaviour.
   - Every vehicle type is affected, emergency vehicles included (Fog: "for everyone").
2. **p_slow source.** It is `DistrictRules.pSlowPermille`, an integer from 0 to 1000; `Sim.init`
   rejects anything else. From P1-SIM-05, `setPSlow` cards and the Blackout boss add to it, capped
   at 1000.
3. **Gridlock detector.** After each tick, if at least one vehicle is on the map and the sum of v
   is 0, a counter rises; otherwise it resets. When it reaches `GRIDLOCK_TICKS` (60), the round
   ends.
   - The state is `done`, `RoundResult.gridlocked` is true, and `RoundResult.ticks` is the tick
     at which it ended.
   - The worker sends `done` after that tick's frame.
   - Ticks with no vehicle on the map never count, so an empty map before the first spawn is not
     a gridlock.
   - Fixed signals (40 green plus 6 all-red) and the 3-tick uncontrolled wait are shorter than
     the window, so normal waiting never trips the detector.
4. **Closed segments** (`RoundInput.closedSegments?: SegmentId[]`, Parade).
   - **Shape.** A `SegmentId` is `{ from, to }`: a straight in-bounds run of plain road tiles,
     with no intersection or block tiles. `Sim.init` rejects anything else with a `RangeError`.
   - **What closes.** Every link holding a closed tile is closed in both directions, for the whole
     round (`closedLinkMask`).
   - **Vehicles reroute at spawn.** The BFS route at spawn avoids closed links, and taxi
     re-routes do too. Routes with closures are cached per round, never in the shared world
     (ADR-017 point 9).
   - **Cut-off trips never start.** If a trip's origin or destination edge is cut off, or no open
     route exists, the trip never starts and does not count as spawned, like an unreachable trip
     on a one-way. Holding such trips at the edge would only block the edge forever.
     _Superseded by ADR-035: such trips divert to the nearest reachable exit, or wait at their
     edge without blocking the queue._
   - **Hash.** The input digest includes `closedSegments` only when it is non-empty, so an empty
     list hashes the same as no field.
   - **Renderer.** It can draw closures from the round input it already has (`closedLinkMask`).
