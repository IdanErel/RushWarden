# @rushwarden/render

Pixi 8 scene graph, snapshot interpolation, procedural shapes and (later) effects. GDD §6–7.

Owner: Render Engineer. The renderer only draws: the sim runs in a Web Worker and the main thread
receives per-tick `Uint16Array` snapshots through the shared protocol in `@rushwarden/sim`.

## Public API

| Export                                                                   | What it is                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TrafficScene.create(parent, { map, width, height, palette?, layout? })` | Pixi app + scene: roads, intersections, controller glyphs, vehicles. `setControllers`, `pushSnapshot`, `pushControllers`, `liveControllers`, `attach(client)`, `setSpeed`, `setMap`, `resize`, `destroy`, `vehicleCount`, `view`.                              |
| `SimClient(worker, { onFrame, onDone, onError })`                        | Main-thread side of the worker protocol. `onFrame(snapshot, now, controllers?)` also gets the same tick's controllers frame. Owns timing: call `update(now)` per frame (or `scene.attach(client)`); `start`, `pause`, `resume`, `setSpeed`, `stop`, `dispose`. |
| `spawnSimWorker()` / `spawnFakeWorker()`                                 | Worker factories (real sim; fake traffic for dev and tests).                                                                                                                                                                                                   |
| `SnapshotBuffer`                                                         | Last-two-snapshot interpolation; never predicts past the newest snapshot.                                                                                                                                                                                      |
| `LaneLayout`, `worldLaneLayout(world)`, `tileLaneLayout(map)`            | (lane, cell) → map point. `worldLaneLayout` reads the sim's lanes (scene default); `tileLaneLayout` is for fake traffic only.                                                                                                                                  |
| `vehicleShapes`, `controllerShapes`, `drawShapes`                        | Shape grammar as data, and its Pixi drawer. Reused by card glyphs and `/dev/style`.                                                                                                                                                                            |
| `OLD_TOWN`, `contrast`                                                   | District 1 palette tokens and the WCAG contrast check.                                                                                                                                                                                                         |
| `FakeTraffic`, `createFakeWorkerHandler`, `fakeControllerFrame`          | Deterministic fake traffic in the `Sim.snapshot` format, with fake controllers frames, for the dev page and tests.                                                                                                                                             |
| `readControllers`, `stopBars`, `boxAlpha`                                | Live controller state (ADR-020 frames) decoded, and the signal stop bars and box tint drawn from it.                                                                                                                                                           |
| geometry helpers                                                         | `fitGrid`, `roadRuns`, `intersections`, `connections`, `roadWidth`, …                                                                                                                                                                                          |

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

## Lane geometry

`worldLaneLayout(buildWorld(map))` places sim snapshots using `locateCell` (ADR-012 numbering).
Intersection box lanes from P1-SIM-02 (#23) are drawn at the centre of the sim's box quarter for each
cell (`locateCell(...).quadrant`). Turn pockets (#27) sit beside the approach's last cell, half a lane inside its
innermost lane. The layout dispatches on `Lane.kind`. `FakeTraffic` still numbers lanes per tile (`tileLaneId`) and is paired with
`tileLaneLayout`; both go when the sim spawns vehicles. ADR-015 records this.

## Status

Done (P1-REN-01): map, glyphs, vehicles, worker playback, interpolation, sim lane geometry.
REN-03 (live readouts): signal stop bars, box occupancy and live glyphs from the worker's
controllers frames; turn pockets (#33). Waiting on #30 and #32: closed segments
(`closedLinkMask`) and a per-round `roundWorld(input)` lane layout.
Next (P1-REN-02, #24): §7 motion feedback (trails, queue pulse, gridlock red and shake),
demand heat-strips and reduced motion. Not yet measured: frame time at 120 vehicles (§6).
