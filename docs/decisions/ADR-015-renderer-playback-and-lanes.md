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

- `World`, `Link`, `Lane`, `buildWorld` and `locateCell` are exported from `@rushwarden/sim` by
  #13. The renderer adds `worldLaneLayout(world)` over them once #13 is on `main`.
- Vehicles inside an intersection: the sim names the turn movement. Intersection movement lanes
  get reserved lane ids after the road lanes (SIM-03), and `locateCell` resolves them. Until
  SIM-03 lands, the renderer draws a straight line from the approach cell to the exit cell.

## Consequences

- Swapping in the sim's lane geometry touches `lanes.ts` (and the fake) only.
- Observation for the Sim Engineer and Lead: at §3 speeds (vmax 3 cells/tick, 20 ticks/s, 4 cells
  per tile) a car crosses the 9-tile map in about 0.6 s. Interpolation keeps it smooth, but it is
  fast to read on a phone; worth checking against pillar 5 (watchable) once real traffic exists.
