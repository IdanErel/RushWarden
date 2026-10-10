# ADR-015: Renderer playback, provisional lane layout, and fake traffic

Status: Proposed · 2026-10-10 · Render Engineer (P1-REN-01)

GDD §6 says the renderer interpolates between the last two snapshots and never predicts, and
P1-LEAD-01 (`packages/sim/src/protocol.ts`) makes the main thread own timing (pull model). The
brief does not say how playback is paced, how a snapshot's (lane, cell) becomes a screen point
before the sim's world exists, or how the renderer is exercised while the sim has no vehicles.

## Decision

1. **Playback.** `SimClient.update(now)` runs once per display frame, accumulates sim time as
   wall time × speed, keeps about 150 ms of sim time requested ahead (`step` messages), and
   releases one snapshot per 50 ms of sim time (25 ms at 2×). The scene blends from the previous
   to the newest released snapshot over one tick and clamps at the newest. When the worker is late,
   playback waits instead of banking time, so it never jumps or extrapolates.
2. **Lane geometry behind an interface.** The scene depends only on `LaneLayout.cellPoint(lane,
cell)`. Until P1-SIM-01 is on `main`, `tileLaneLayout` uses a provisional per-tile numbering
   (lane 0 = kerb, right-hand traffic, as in ADR-012). It is replaced by an adapter over the sim's
   `World` links and lanes.
3. **Fake traffic** (`FakeTraffic`) emits snapshots in the exact `Sim.snapshot` format from a
   seed, for tests and the dev page. It runs in its own worker entry speaking the shared protocol
   unchanged, so nothing is added to the protocol. It is deleted when the sim spawns vehicles.
4. **Uncontrolled intersections have no glyph.** §7 names glyphs for signal, roundabout, stop and
   priority only; a plain square reads as "default rules".
5. **District 1 colours** are hand-picked tokens until the §7 OKLCH generator; a unit test keeps
   every vehicle body at ≥ 3:1 contrast against the road (WCAG AA for graphics).

## Lane geometry from the sim (Lead's decision, 2026-10-10)

- `World`, `Link`, `Lane`, `buildWorld` and `locateCell` are exported from `@rushwarden/sim` (#13,
  on `main`). `worldLaneLayout(world)` reads them and is the scene's default layout. A lane sits
  `index + 0.5` lane widths in from the right-hand kerb of the whole road (both directions'
  lanes), so a one-way road with doubled lanes fills the road. On a turning tile, cells 0–1 follow
  the entry direction and cells 2–3 the exit direction.
- Vehicles inside an intersection: the sim names the turn movement. Intersection movement lanes
  get reserved lane ids after the road lanes (P1-SIM-02, #23), and `locateCell` resolves them.
  Until #23 merged, the Lead's interim rule drew box cells on a straight line from the approach
  lane's last cell to the exit lane's first cell. With #23 on `main`, the renderer draws each
  box-lane cell at the centre of the box quarter the sim puts it in (`locateCell(...).quadrant`:
  right turns use 1 quarter, straight 2, left 3, starting in the right-hand quarter of the
  approach). So what you see matches the sim's shared quadrant cells, and a vehicle waiting in a
  quarter is drawn where it blocks crossing traffic. A cell's heading points from the previous
  point (the approach lane's last cell, or the previous quarter) to the next (the next quarter,
  or the exit lane's first cell). Every step into, through and out of the box is at most half a
  tile (tested).
- `tileLaneLayout` (per-tile ids) stays only for `FakeTraffic`, which the dev page pairs with it.

## Readability and shape notes (review of #18)

- **Shape alone (§7 accessibility).** Car and taxi share a body, so the taxi also carries a
  crosswise roof-sign block that sticks out past the stripe ("+" against the car's "−"). The
  shape test compares geometry only, never fills.
- **"Readable at 12 px".** Read as: a 1-cell vehicle is at least 12 px long on the 390 px design
  width (GDD §1 constraint 5), and every shape stays distinguishable there. Narrower phones scale
  the whole map down with it (a car is about 11.5 px at 360 px); the map does not grow past the
  width, so the shapes, not a size floor, carry readability below 390 px.
- **Truck "darker".** Read as darker than the other vehicle bodies (box `truckBox` against the
  light `vehicleBody`), not darker than the road: on District 1's dark road a dark truck would
  fall under the 3:1 contrast floor.

## Live controller readouts (REN-03, 2026-10-10)

The sim worker's `frames` carry `controllers` (ADR-020 point 10): `[kind, greenMask, boxCount]`
per intersection, for the same tick as each snapshot. `SimClient` releases each one with its
snapshot, and the scene draws:

- **Signal stop bars.** For a signalled intersection, there is one bar per approach, just outside
  the box and across that approach's inbound lanes. It is green when the approach may enter and red
  otherwise, so all four are red during the all-red clearance. The bars are drawn from the live
  mask, not from the glyph, so they show the real phase. Other controller kinds have no bars.
- **Box occupancy.** The box square gets an amber tint that rises per vehicle inside it, up to
  alpha 0.5 at 4 vehicles (one per quarter, so the box is full). It sits under the glyph and the
  vehicles, so it reads as a box filling up without hiding what is in it.
- **Live glyphs.** A glyph the UI set wins. Otherwise the scene shows the live controller kind
  from the frame. The sim sets the kind from the round's controller cards (#32). The dev page's
  fake traffic sends frames in the same layout that honour `setController` placements and
  alternate signal phases.
- **Per-round lanes and closures.** `setRound(input)` lays lanes out on `roundWorld(input)`
  (ADR-023), because topology cards change lane ids. It draws `input.closedSegments` (Parade,
  ADR-022) through the sim's `closedLinkMask`: every closed link's road is faded, and a barrier
  crosses the road at each end of each segment.

## Consequences

- Swapping in the sim's lane geometry touches `lanes.ts` (and the fake) only.
- Observation for the Sim Engineer and Lead: at §3 speeds (vmax 3 cells/tick, 20 ticks/s, 4 cells
  per tile) a car crosses the 9-tile map in about 0.6 s. Interpolation keeps it smooth, but it is
  fast to read on a phone; worth checking against pillar 5 (watchable) once real traffic exists.

## Addendum: readability effects (P1-REN-02)

The brief fixes the effects (§7) and the reduced-motion rules (§8). It does not fix these details:

- **Queue = speed 0 in the snapshot.** The pulse is phase-locked to the clock, so a whole queue
  pulses together and reads as one queue. A bus dwelling at a stop also has speed 0 and pulses;
  the snapshot has no dwell flag, and a stopped bus does hold traffic.
- **Gridlock comes from the round result** (`RoundResult.gridlocked`), not from the renderer.
  The scene never decides game state. `setGridlock(true)` tints stopped vehicles desaturated red
  and shakes the camera. The next round (tick 0) clears it.
- **Reduced motion:**
  - no trails, as §8 says
  - no shake, as §8 says
  - queues get a steady outline instead of a pulse. The brief does not cover this case; a steady
    outline keeps queues marked without animation.
- **Heat-strips are at least 6 px thick at the 390 px design width** (Lead's decision,
  2026-10-10, after review of #24 found them about 4 px). They fill a 6 px margin around the grid
  edge to edge (`HEAT_STRIP_MIN_PX`, `HEAT_GUTTER_PX`), so they never cover traffic. A wider
  margin would drop a 390 px phone to 53 px tiles and the car under 12 px, so the strip has no
  inset. Bin length (about 3 px per second on a phone) is unchanged; the reviewer's other options
  (a larger strip for a selected edge, coarser bins) stay open for UI-01 and the P1-REV-02 feel
  check.
  - Each strip is centred on its edge and runs along the boundary: left to right on n/s edges,
    top to bottom on e/w edges.
  - It has 15 one-second bins on a 5-step ramp that darkens with each step, so it reads without
    colour. Bins are scaled to the busiest second on the whole map, so edges compare directly.
  - During Go, elapsed seconds dim.
  - With the margin, a 390 px phone still gets 54 px tiles, and a car is 12.2 px long.
- **Dev-only jam mode.** The fake worker runs the "Gridlock Drill" boss as a jam, so the gridlock
  effect shows through the normal `done` path. It goes away with the fake.
