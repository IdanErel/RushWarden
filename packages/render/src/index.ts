/**
 * @rushwarden/render — Pixi scene graph, tick interpolation, procedural sprite generation and
 * effects (GDD §6–7). See README.md for the API and an example.
 *
 * Pure modules (geometry, lanes, interpolation, shapes, palette, fake traffic, worker handlers) have no
 * Pixi or DOM dependency and run in Node; `TrafficScene` and `SimClient` need a browser.
 */
export * from './geometry.js';
export * from './lanes.js';
export * from './interpolate.js';
export * from './palette.js';
export * from './shapes.js';
export * from './effects.js';
export {
  FakeTraffic,
  buildRoute,
  fakeDemand,
  type FakeTrafficOptions,
  type FakeTrafficState,
} from './fake-traffic.js';
export type { WorkerLike } from './worker/protocol.js';
export * from './controller-state.js';
export * from './closures.js';
export {
  FAKE_ALL_RED_TICKS,
  createFakeWorkerHandler,
  fakeControllerFrame,
} from './worker/fake-handler.js';
export { SimClient, spawnSimWorker, type SimClientHandlers } from './worker/client.js';
export {
  TrafficScene,
  type ControllerMark,
  type SceneStats,
  type TrafficSceneOptions,
} from './pixi/scene.js';
export { drawShapes } from './pixi/draw.js';
