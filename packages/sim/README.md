# @rushwarden/sim

The deterministic, integer-only traffic simulation (GDD section 3). No DOM, no Pixi, no clock,
no `Math.random`, no floating point; ESLint enforces these in `src/`. Owner: Sim Engineer.

## Public API

| Export                                                                              | Purpose                                                                                                                      |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `Sim.simulate(input: RoundInput): RoundResult`                                      | Runs a whole round headless. Pure.                                                                                           |
| `Sim.init(input)`, `Sim.step(state)`, `Sim.snapshot(state)`, `Sim.result(state)`    | Tick-by-tick mode for the render worker. `step` returns the state to use next (ADR-002).                                     |
| `Sim.stateHash(state)`                                                              | 64-bit hash of the current state, 16 hex chars.                                                                              |
| `RoundInput`, `RoundResult`, `Placement`, `Effect`, `GridMap`, `DemandProfile`, ... | Types in `src/types.ts`.                                                                                                     |
| `createPrng`, `nextU32`, `nextInt`, `chancePermille`                                | xoshiro128** owned by the round.                                                                                             |
| `placementError(map, placement)`, `segmentTiles(target)`                            | Placement validation (ADR-014): why a card cannot go on a target, or null. Used by `Sim.init`; the UI greys targets with it. |
| `idiv`, `imod`, `pct`, `clamp`                                                      | Integer math; `src/math.ts` is the only file allowed to use `/`.                                                             |
| `buildWorld(map): World`                                                            | Validates a `GridMap` (ADR-012) and builds links, lanes, intersections, edges. Throws `MapError`.                            |
| `route(world, o, d)`, `routeByEdgeId(world, oId, dId)`                              | BFS shortest route between two edges as a list of link ids, cached per round.                                                |
| `weightedRoute(world, intersection, arrivalSide, d, cost)`                          | Integer Dijkstra over links for taxis (time-weighted costs), no U-turns.                                                     |
| `locateCell(world, laneId, cell)`                                                   | Tile, offset, travel directions and box quarter of a snapshot's (lane, cell), for the renderer.                              |
| `VEHICLE_SPECS`, `BUS_DWELL_TICKS`, `BIKE_SHARED_VMAX`, `TAXI_LOAD_COST`            | The GDD §3 vehicle table and tick constants (ADR-017).                                                                       |

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

## World (P1-SIM-01, ADR-012)

```ts
import { buildWorld, routeByEdgeId, locateCell } from '@rushwarden/sim';

const world = buildWorld(map); // throws MapError on a bad template
world.intersections; // road tiles with 3-4 road neighbours, controller 'uncontrolled'
const r = routeByEdgeId(world, 0, 2); // { links: [spawnLink, ..., sinkLink], tiles }
const lane = world.links[r!.links[0]!]!.lanes[0]!; // lane 0 = kerb lane
locateCell(world, lane, 5); // { tile, offset: 1, entryDir, exitDir }; 4 cells per tile
```

A link is one direction along the road between two nodes (intersections or edges); each of its
lanes has 4 cells per tile, cell 0 upstream. Directions are indices 0..3 = n, e, s, w.

## Effects

`Effect` (types.ts) is the Effect union v2 from ADR-014. The sim validates placements in
`Sim.init` (for example, Express Stop's `setBusStopDwell` needs a segment that already has a bus stop) and applies
the effects from P1-SIM-05 on. `DEFAULT_SWITCH_TICKS` is the default phase-switch time.

## Vehicles and lane ids (P1-SIM-02, ADR-017)

Snapshots are `[tick, count, ...count × (id, lane, cell, speed, type)]`, listed in the tick's
update order: (lane, cell) descending at the start of the tick. `id` is the spawn index and
`cell` is the head cell.

| Lane ids                          | What                                                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `0 .. world.roadLanes - 1`        | Road lanes: `world.lanes[id].link` is the link, 4 cells per tile, cell 0 upstream.                                          |
| `world.roadLanes .. lanes.length` | Intersection box lanes, one per movement. 1/2/3 cells for right/straight/left; `locateCell` gives the quarter (0 NE..3 NW). |

Vehicle table (§3): car 1/3/1, taxi 1/3/1, bus 2/2/3, truck 3/2/2, emergency 1/4/5, bike 1/2/1
(length / vmax / score). Bikes move at 1 without a bike lane, and buses stand 4 ticks at each
bus-stop tile.

## Status

P1-SIM-02: vehicles spawn, follow tick rules 1, 2, 4 and 6, and exit with their score.
Controllers (rule 5) follow in P1-SIM-03; p_slow (rule 3) and the gridlock detector in P1-SIM-04.

Any change to
the exported types is an interface change (GDD section 13, rule 6).
