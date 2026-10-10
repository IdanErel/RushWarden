# ADR-002: Sim.step takes ownership of its state

Status: Accepted · 2026-10-10 · Lead

The brief specifies `Sim.step(state): state`. Copying the world every tick would break the
2,000 rounds/s budget. `step` may update its argument in place and returns the state to use next;
callers must not use the old reference afterwards. Determinism is unaffected: the trajectory is
still a pure function of `RoundInput`, and `simulate(x)` equals stepping `init(x)` to the end
(tested). Snapshots for the renderer are fresh `Uint16Array`s, so nothing mutable is shared.
