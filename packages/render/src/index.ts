/**
 * @rushwarden/render — Pixi scene graph, tick interpolation, procedural sprite generation and
 * effects (GDD §6–7). See README.md for the API and an example.
 *
 * Pure modules (geometry, lanes, interpolation, shapes, palette, fake traffic, worker handlers) have no
 * Pixi or DOM dependency and run in Node; `TrafficScene` and `SimClient` need a browser.
 */
export * from './core.js';
export type { WorkerLike } from './worker/protocol.js';
export { createFakeWorkerHandler } from './worker/fake-handler.js';
export {
  SimClient,
  spawnFakeWorker,
  spawnSimWorker,
  type SimClientHandlers,
} from './worker/client.js';
export {
  TrafficScene,
  type ControllerMark,
  type PlacedMark,
  type SceneStats,
  type TrafficSceneOptions,
} from './pixi/scene.js';
export { drawShapes } from './pixi/draw.js';
