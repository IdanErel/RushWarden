# @rushwarden/render

Pixi 8 scene graph, snapshot interpolation, procedural shapes and (later) effects. GDD §6–7.

Owner: Render Engineer. The renderer only draws: the sim runs in a Web Worker and the main thread
receives per-tick `Uint16Array` snapshots through the shared protocol in `@rushwarden/sim`.

## Public API

| Export                                                                   | What it is                                                                                                                                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TrafficScene.create(parent, { map, width, height, palette?, layout? })` | Pixi app + scene: roads, intersections, controller glyphs, vehicles. `setControllers`, `pushSnapshot`, `attach(client)`, `setSpeed`, `setMap`, `resize`, `destroy`, `vehicleCount`, `view`. |
| `SimClient(worker, { onFrame, onDone, onError })`                        | Main-thread side of the worker protocol. Owns timing: call `update(now)` per frame (or `scene.attach(client)`); `start`, `pause`, `resume`, `setSpeed`, `stop`, `dispose`.                  |
| `spawnSimWorker()` / `spawnFakeWorker()`                                 | Worker factories (real sim; fake traffic for dev and tests).                                                                                                                                |
| `SnapshotBuffer`                                                         | Last-two-snapshot interpolation; never predicts past the newest snapshot.                                                                                                                   |
| `LaneLayout`, `tileLaneLayout(map)`                                      | (lane, cell) → map point. `tileLaneLayout` is provisional (see below).                                                                                                                      |
| `vehicleShapes`, `controllerShapes`, `drawShapes`                        | Shape grammar as data, and its Pixi drawer. Reused by card glyphs and `/dev/style`.                                                                                                         |
| `OLD_TOWN`, `contrast`                                                   | District 1 palette tokens and the WCAG contrast check.                                                                                                                                      |
| `FakeTraffic`, `createFakeWorkerHandler`                                 | Deterministic fake traffic in the `Sim.snapshot` format, until the sim spawns vehicles.                                                                                                     |
| geometry helpers                                                         | `fitGrid`, `roadRuns`, `intersections`, `connections`, `roadWidth`, …                                                                                                                       |

## Example

```ts
import { emptyMap, sampleInput } from '@rushwarden/sim';
import { SimClient, TrafficScene, spawnSimWorker } from '@rushwarden/render';

const map = emptyMap();
const scene = await TrafficScene.create(document.body, { map, width: 390, height: 501 });
scene.setControllers([{ x: 3, y: 4, kind: 'signal' }]);
const client = new SimClient(spawnSimWorker(), {
  onFrame: (snapshot, now) => scene.pushSnapshot(snapshot, now),
  onDone: (result) => console.log(result.throughput),
});
scene.attach(client); // the scene's ticker drives client.update(now)
client.start({ ...sampleInput(1), map, mapId: map.id });
client.setSpeed(2); // hold for 2×; also call scene.setSpeed(2)
```

## Dev page

`pnpm --filter @rushwarden/render dev` serves `dev/` (plus map, fake traffic in a worker, legend
of every glyph and vehicle). Query: `seed`, `speed`, `ctrl`, `source=fake|sim`.
`pnpm --filter @rushwarden/render e2e` builds it, checks vehicles arrive from the worker and saves
phone screenshots to `test-results/shots/` (`SHOT_DIR` overrides; `PW_CHROMIUM_PATH` for a local
Chromium).

## Open interface

`tileLaneLayout` numbers lanes per tile and direction (`tileLaneId`). When the sim's world
(P1-SIM-01, ADR-012) lands on `main`, a `worldLaneLayout(world)` adapter over its `Link`/`Lane`
geometry replaces it; only `lanes.ts` and the fake traffic change. ADR-015 records the plan.
