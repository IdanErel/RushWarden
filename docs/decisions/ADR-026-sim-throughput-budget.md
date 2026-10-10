# ADR-026: Phase 1 sim throughput budget

Status: Accepted (Lead) · 2026-10-10 · Sim Engineer (P1-SIM-06b). Number assigned by the Lead.

GDD §3 sets the headless budget: "at least 2,000 full 300-tick rounds per second on a developer
laptop single core, with up to 150 vehicles", which makes the §11 nightly balance runs feasible.
After P1-SIM-06 (#35) and P1-SIM-06b (#37), the sim is short of that on the CI runner. The Lead
decided:

1. **Phase 1 floor.** At least **1,000 rounds/s** on the bench round with 4 intersections and 150
   vehicles (`packages/sim/bench`, both demand mixes), measured by the report-only `sim-bench` CI
   job on the hosted **AMD EPYC 7763** runner.
   - #37 measures 1,133–1,178 there, about 57% of the §3 target of 2,000.
   - The CI job stays report-only (`continue-on-error`). This floor is checked by reading its job
     summary, not by a gate.
2. **Effect.** The nightly balance runs (§11) take about **1.7×** the GDD's estimate of about 10
   minutes on 8 cores. This is acceptable for Phase 1, since the 10k report already runs in under
   an hour on 4 cores.
3. **The §3 target stays for Phase 2.** Reaching 2,000 rounds/s is task **P2-SIM-perf**: a
   structural rework of the per-vehicle loop. No more micro-optimisation steps in Phase 1. After
   #35 and #37 the profile is spread evenly over movement bookkeeping, grants and taxi re-routes,
   and each further small step is worth about 5–15%.
4. **Runner caveat.** Hosted runners differ in CPU. On different runners the same commit measured
   2,141 and 1,225 rounds/s two minutes apart. The bench summary names the CPU model, and bench
   numbers are compared **only between runs on the same CPU model**. The floor in point 1 refers
   to the EPYC 7763.

The determinism rules are unchanged: every speed-up must keep the golden hashes, or explain each
change in its PR.
