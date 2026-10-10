# @rushwarden/sim

The deterministic, integer-only traffic simulation (GDD section 3). No DOM, no Pixi, no clock,
no `Math.random`, no floating point; ESLint enforces these in `src/`. Owner: Sim Engineer.

## Public API

| Export                                                                              | Purpose                                                                                  |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `Sim.simulate(input: RoundInput): RoundResult`                                      | Runs a whole round headless. Pure.                                                       |
| `Sim.init(input)`, `Sim.step(state)`, `Sim.snapshot(state)`, `Sim.result(state)`    | Tick-by-tick mode for the render worker. `step` returns the state to use next (ADR-002). |
| `Sim.stateHash(state)`                                                              | 64-bit hash of the current state, 16 hex chars.                                          |
| `RoundInput`, `RoundResult`, `Placement`, `Effect`, `GridMap`, `DemandProfile`, ... | Types in `src/types.ts`.                                                                 |
| `createPrng`, `nextU32`, `nextInt`, `chancePermille`                                | xoshiro128** owned by the round.                                                         |
| `idiv`, `imod`, `pct`, `clamp`                                                      | Integer math; `src/math.ts` is the only file allowed to use `/`.                         |

## Worker protocol (P1-LEAD-01)

`createSimWorkerHandler(post)` runs inside the sim worker. The main thread owns timing and pulls
ticks: `start {roundId, input}` → `step {roundId, ticks}` (≤ 60) → `frames` replies with
transferable snapshot buffers, then one `done {result}`. `finish` runs the rest at once, `abort`
drops the round, and bad input yields `error`. Frames equal a headless `recordFrames` run
(tested over `worker_threads`).

```ts
// sim.worker.ts
import { createSimWorkerHandler } from '@rushwarden/sim';
const handle = createSimWorkerHandler((m, t) => self.postMessage(m, t));
self.onmessage = (e) => handle(e.data);
```

## Example

```ts
import { Sim, sampleInput } from '@rushwarden/sim';

const result = Sim.simulate(sampleInput(42));
console.log(result.throughput, result.finalHash);

let state = Sim.init({ ...sampleInput(42), recordFrames: false });
while (!state.done) {
  state = Sim.step(state);
  const frame = Sim.snapshot(state); // Uint16Array [tick, count, ...(id, lane, cell, speed, type)]
}
```

## Status

Phase 0 stub: the round runs 300 empty ticks and hashes its trajectory. The Sim Engineer
implements the world, vehicles and controllers in Phase 1 behind this same API. Any change to
the exported types is an interface change (GDD section 13, rule 6).
