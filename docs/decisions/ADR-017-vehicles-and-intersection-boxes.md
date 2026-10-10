# ADR-017: Vehicles, intersection boxes and tick mechanics

Status: Proposed · 2026-10-10 · Sim Engineer (P1-SIM-02)

GDD §3 fixes the vehicle table, tick rules 1, 2, 4 and 6, and the update order. It does not say
how vehicles cross an intersection, where buses stop, or how a blocked spawn behaves. These are
the choices in `packages/sim/src/traffic.ts`.

1. **Intersection boxes.** An intersection tile is a box of 4 physical cells, one per quarter
   (NE, SE, SW, NW).
   - Each movement (in-side → out-side, no U-turns) is a box lane with reserved ids from
     `world.roadLanes` up to `lanes.length`.
   - A right turn uses 1 quarter, straight 2 and a left turn 3. Each starts in the right-hand
     quarter of the approach, since traffic drives on the right (ADR-012).
   - Box lanes of crossing movements share quarters, so two vehicles can never occupy the same
     space. Who goes first is decided by the controllers in P1-SIM-03; until then the box is
     first come, first served in update order.
   - `locateCell` returns the quarter for snapshots.
2. **Occupancy is physical.** Every road lane cell and every box quarter is one physical cell.
   Rule 2's gap counts free physical cells along the vehicle's own route. A bus holds 2 cells and
   a truck 3, trailing behind the head along its path, including through boxes. Snapshots carry
   the head cell.
3. **Lanes.** A vehicle spawns on its spawn link's kerb lane, or on lane 1 when cell 0 of the kerb
   lane is taken. After a box it takes lane 0 for a right turn, the innermost lane for a left
   turn, and keeps its lane index going straight. There are no lane changes in Phase 1.
4. **Spawning.**
   - Demand due this tick joins its edge's queue, first in, first out.
   - Each edge, in index order, spawns from the head of its queue while cell 0 of a spawn lane
     is free. A blocked edge holds its queue (the spill-back is visible in the heat-strip).
   - Spawned vehicles start at v = 0 and take part in the same tick.
   - Demand must be sorted by (tick, edge) and use valid vehicle types; `Sim.init` rejects it
     otherwise.
5. **Bus stops.** A bus stops on the downstream cell of each bus-stop tile on its route and stands
   for `BUS_DWELL_TICKS` = 4 ticks, once per stop. Other types pass.
6. **Bikes** move at `BIKE_SHARED_VMAX` = 1 until bike lanes exist ("else shares the lane at
   speed 1").
7. **Taxis** re-route each time they enter a link that ends at an intersection, using
   `weightedRoute` with cost = the link's cells + `TAXI_LOAD_COST` (2) × its occupied cells.
   Everyone else keeps the BFS route chosen at spawn.
8. **Exit (rule 6).** Moving past the last cell of the route's sink link removes the vehicle,
   frees all its cells and adds its score value.
9. **Performance.** Worlds and map digests are cached per `GridMap` object; both are pure
   functions of the map, so results are identical. The input digest feeds the demand profile as
   integers. The whole input is still covered, so the verifier re-simulates exactly the client's
   input (ADR-001), but final hashes change once (golden regenerated in this PR).

Speeds are the §3 values and are not changed here. At 20 ticks/s a lone car crosses a 9-tile map
in 0.55–0.65 s, and a median trip under load takes about 0.5 s. That is the Render Engineer's
pillar-5 readability concern (ADR-015). It is a design question for the Lead and Content, not a
sim change.
