# ADR-023: Card effects, stacking and controller conflicts

Status: Proposed · 2026-10-10 · Sim Engineer (P1-SIM-05). Number assigned by the Lead.

GDD §4 lists the primitives and two rules: "Stacking: same card on same target does not stack;
different cards do. Conflicting controllers: the last played wins and the earlier card is
refunded." ADR-014 fixed the `Effect` union. This ADR records how the sim applies it
(`packages/sim/src/effects.ts`) where the brief is silent.

## Resolution (`resolvePlacements`)

1. **Order.** Run effects (`cardState.runEffects`) apply first. This round's placements follow,
   sorted by `order`, with ties kept in array order.
2. **Same card, same target.** A placement with the same `cardId` and target as an earlier one is
   **ignored**: not applied and not refunded. A segment and its reverse count as one target. The
   UI should not allow the play.
3. **Controller conflicts.** When two of this round's placements set the controller of one
   intersection, the later one wins and the earlier one is **refunded whole**: none of its
   effects apply. Run effects are never refunded; this round's cards simply override them.
4. **`replacedController`.** For each applied `setController` placement, this is the
   intersection's controller before this round's cards: the map default after run effects. Remove
   Signal's refund (`condition: 'replaced-signal'`) uses it. A signal played and refunded in the
   same round never stood, so removing it refunds nothing; this closes a free-energy loop.
5. **Rejected forms.** No Phase 1 card uses these, so `Sim.init` rejects them with a
   `RangeError`; card text must never promise what the sim does not do:
   - `setSignalPhase` modes `wave` and `district-cycle`;
   - `scoreModifier` with a `condition`;
   - `setController` on anything but an intersection tile;
   - each primitive on a target kind it has no meaning for (for example `preferType` on a
     segment).

## Topology (per-round world)

6. **`setOneWay`** closes the direction against the flow (0 lanes) on every link holding a
   segment tile.
   - With `doubleLanes`, the flowing direction gets both directions' lanes, at most 4.
   - The direction must run along the segment. A one-tile segment needs an explicit direction.
   - Links run between nodes, so the change covers the whole link, not just the segment's tiles.
7. **`setLaneCount`** sets lanes per direction on the segment's links. The `ring` scope covers
   every `ring` tile.
8. **Lane ids.** Topology cards give the round its own `World` (`buildWorld(map, overrides)`,
   cached per map and override set). Snapshot lane ids refer to that world, so the renderer must
   build its lane layout from **`roundWorld(input)`**, not `buildWorld(map)`. This is an interface
   change for Render. Trips that a one-way leaves without a route never start (as in ADR-022).

## Demand (before the first tick)

9. **Selection is exact and deterministic**, by integer error diffusion, never random. "50% of
   spawns" is every second matching spawn in demand order. The round PRNG stays reserved for
   p_slow.
10. **`spawnModifier`** (Fare Holiday):
    - a negative percent drops that share of the type's spawns;
    - a positive percent duplicates that share, at the same tick, edge and destination;
    - an edge target limits it to that edge.
11. **`reroute`** (Detour) moves the selected share of the edge's spawns to the next edge
    clockwise along the boundary, or to `secondaryTarget`. A spawn whose new origin would equal
    its destination stays put.
12. **`spawnWindow`** (Delivery Window) compresses the type's spawn ticks into the window
    (`from + tick × span / 300`). No spawn is lost.
13. **`smoothDemand`** (Staggered Hours):
    - Per one-second bin, the cap is the busiest second's count minus `peakPermille`.
    - Overflow moves to the next seconds with room, then to earlier ones, keeping its tick
      offset within the second.
    - No spawn is lost.
14. **Order.** Demand effects apply in play order, and the result is re-sorted by (tick, edge).

## Traffic

15. **Controllers.**
    - `setController` maps to ADR-020's controllers.
    - `setSignalPhase` (adaptive) sets the switch time to `switchTicks`, or to
      `DEFAULT_SWITCH_TICKS + switchTicksDelta`.
    - `addTurnLane` opens ADR-020's turn pockets.
    - `yieldRule` subtracts `fasterTicks` from the uncontrolled wait at every intersection,
      with a minimum of 1 tick.
16. **`preferType`** (Bus Priority, "buses get green on approach"). At that intersection the
    preferred types behave like emergency vehicles: they enter on red and win grants without
    the wait. Box quarters still prevent physical conflicts.
17. **`setSpeedLimit`** builds a per-cell, per-type vmax for the segment's cells, optionally only
    the first `cells` cells along each lane's travel direction.
    - The new limit is `min(current + delta, max)`, clamped to 0..15, so different cards stack
      in play order.
    - A vehicle accelerates only to the limit of the cell it stands in.
    - It never enters a cell whose limit is below the number of cells it has already moved this
      tick. So Toll Booth (`max 1, cells 2`) makes every vehicle cross its 2 cells at speed 1,
      and Speed Limit Up's +1 applies inside the segment.
    - Base vehicle speeds are unchanged.
18. **`addBikeLane`** sets bike vmax on the segment and adds `carVmaxDelta` to cars.
19. **`reserveLane`** (Bus Lane):
    - On links with 2 or more lanes, the kerb lane is reserved for the listed types. Others spawn
      and turn into the other lanes.
    - **On a 1-lane link, the only lane is reserved.** Cars, taxis and trucks lose the road and
      route around the segment; trips with no other route never start.
      - This is the **Lead's decision (2026-10-10)**: take the literal GDD reading, "one lane
        reserved for buses and bikes; cars lose it".
      - On District 1's 1-lane maps, Bus Lane is therefore a ban on cars, taxis and trucks.
      - **Flagged for the balance report.** Content may propose a change after the BAL-02 data.
    - Emergency vehicles keep their §3 override ("others yield; ignores signals") and may always
      use a reserved lane.
20. **`banType`** closes links to the type for routing (spawn BFS and taxi re-routes):
    - `target`: the segment's links;
    - `target-class`: every link of the placed segment's road class;
    - `{ roadClass }`: every link of that class.

    Road class comes from the map tile's lanes: 1 is local, 2 or more is arterial. Trips with no
    route never start.

21. **Bus stops.** `setBusStopDwell` sets the dwell at bus-stop cells on the segment.
22. **p_slow.** `setPSlow` adds to `DistrictRules.pSlowPermille`, capped at 0..1000.
23. **Score.** `scoreModifier` (no condition) adds to the type's score on exit. A vehicle's score
    never goes below 0.
24. **Tolls.** `fundsModifier { delta, per }` on a segment is a toll:
    - every vehicle whose head enters one of the segment's links counts once per link;
    - `RoundResult.fundsDelta` adds `floor(count / per) × delta`;
    - toll counts are part of the state hash.

    Without `per`, or on another target, `fundsModifier` is run-controller funds (Grant), and the
    sim ignores it, like the other run-controller effects.
