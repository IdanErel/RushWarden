# Sim CPU profile, 2026-10-10 (input for P2-SIM-perf)

Sim Engineer, measured on main at 7604fb7 (after #37 and #42). ADR-026 sets the Phase 1 floor at
1,000 rounds/s against the GDD §3 target of 2,000 and moves the rest of the gap to P2-SIM-perf.
This page records where the time goes, so that task starts from numbers. No code changed.

## What a bench round does

The round is the `packages/sim/bench` input: the D1-like lattice (4 intersections) with 150
vehicles, both demand mixes ("sim-02" and "reviewer"), 64 seeds each. The 12-intersection lattice
is shown for comparison.

| Mix, map                   | Ticks | Vehicle-ticks | Alive (mean / peak) | Moving | Stopped (at a stop line) | Dwelling | Cells advanced |
| -------------------------- | ----: | ------------: | ------------------: | -----: | -----------------------: | -------: | -------------: |
| sim-02, D1-like            |   300 |         3,173 |             11 / 26 |    73% |                27% (22%) |       1% |          4,226 |
| reviewer, D1-like          |   300 |         3,327 |             11 / 27 |    73% |                27% (22%) |       1% |          4,234 |
| sim-02, 12 intersections   |   300 |         3,370 |             11 / 26 |    64% |                36% (33%) |       0% |          3,552 |
| reviewer, 12 intersections |   300 |         3,501 |             12 / 40 |    64% |                36% (33%) |       0% |          3,547 |

- Every round runs all 300 ticks; none of the 64 inputs gridlocks.
- "150 vehicles" in the bench means 150 spawned per round, not 150 on the map at once: about 11
  are alive at any tick. A load closer to the GDD's "up to 150 vehicles" would cost much more per
  round, so a P2 bench should add a dense case.
- Best timing here: about 720 µs per round (about 1,390 rounds/s, about 225 ns per vehicle-tick)
  on an Intel Xeon at 2.1 GHz. The machine was shared (load about 29 on 4 cores), so treat the
  absolute number as rough; ADR-026's EPYC 7763 figures (1,133–1,178 rounds/s) remain the
  reference. The shares below are from sampling and hold up under load.

## Where the time goes

`node --cpu-prof --cpu-prof-interval 50` on 15,000 rounds (sim-02, D1-like), after a 500-round
warm-up. Sample positions are credited back to their source function, so inlined helpers
(`occupy`, `release`, `sortOrder`) show up under their own names.

| Function                                                                                   | Self share |
| ------------------------------------------------------------------------------------------ | ---------: |
| `gapAhead` (traffic.ts)                                                                    |      17.2% |
| `moveAll`                                                                                  |      13.5% |
| `move`                                                                                     |      13.0% |
| `sortOrder`                                                                                |       8.2% |
| `occupy`                                                                                   |       7.4% |
| `grant` (controllers.ts)                                                                   |       7.3% |
| `spawn`                                                                                    |       4.9% |
| `release`                                                                                  |       4.0% |
| `walk`                                                                                     |       3.2% |
| `updateControllers`                                                                        |       2.3% |
| `weightedRoute` (world.ts)                                                                 |       1.9% |
| Per-round setup and hash (`init`, `createTraffic`, `validate`, `inputDigest`, `stateHash`) |   about 5% |
| Garbage collection                                                                         |   under 1% |

## Top three hot spots

1. **Moving vehicles cell by cell: about 45%** (`gapAhead` 17.2, `move` 13.0, `occupy` 7.4,
   `release` 4.0, `walk` 3.2). Each moving vehicle walks its path twice, once to record it
   (`gapAhead`) and once to replay it (`move`). On every cell it also shifts its tail array,
   releases and occupies cells, and updates the per-link load counter. The hottest single lines
   are the occupancy check in `gapAhead` (2.2%) and the link-load updates in `release` and
   `occupy` (2.1% and 1.5%).
2. **The per-tick order and vehicle loop: about 22%** (`moveAll` body 13.5, `sortOrder` 8.2).
   The `moveAll` body covers the dwell and stop-line fast-path checks, the vmax lookup and the
   p_slow draw. Every tick, `sortOrder` rebuilds all sort keys and runs an insertion sort, even
   though only about 11 vehicles are alive.
3. **Controllers and spawning, rerun every tick: about 17%** (`grant` 7.3, `updateControllers`
   2.3, `mayEnter` 0.7, `spawn` 4.9). Grants are recomputed for every non-signal intersection on
   every tick, even when nothing at its stop lines changed, and `spawn` scans every edge's queue
   each tick.

Smaller: taxi re-routes about 3% (`weightedRoute` 1.9, route cache 0.8, `taxiRoute` 0.6).

## Directions for P2-SIM-perf

None of these is a small change that clearly keeps the golden hashes, and ADR-026 point 3 rules
out more micro-optimisation in Phase 1. The structural rework should:

- walk each moving vehicle's path once instead of recording and replaying it;
- update link load only when a vehicle changes link, not on every cell;
- keep the update order incrementally instead of re-sorting every tick;
- re-evaluate a controller's grant and an edge's spawn queue only when something there changed.

Any change that alters the update order or grant timing changes the golden hashes; ADR-026 still
requires each such change to be explained in its PR.

## Reproducing

Bundle the bench's input builder (`packages/sim/bench/simulate.bench.ts`, without the vitest
calls) with a loop of `Sim.simulate` calls, using the sim package's esbuild
(`esbuild run.ts --bundle --platform=node --format=esm`), and run it under
`node --cpu-prof --cpu-prof-interval 50`. The census columns come from stepping `Sim.init`/`Sim.step`
and reading the traffic state after each tick.
