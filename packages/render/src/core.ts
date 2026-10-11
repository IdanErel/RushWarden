/**
 * The pure part of @rushwarden/render: no Pixi, no DOM, safe to import in Node (UI logic, tests,
 * tools). `@rushwarden/render` re-exports all of this plus the Pixi scene and worker client.
 */
export * from './geometry.js';
export * from './lanes.js';
export * from './interpolate.js';
export * from './palette.js';
export * from './shapes.js';
export * from './effects.js';
export * from './targets.js';
export * from './jam.js';
export {
  FakeTraffic,
  SCORE_VALUE,
  buildRoute,
  fakeDemand,
  type FakeTrafficOptions,
  type FakeTrafficState,
} from './fake-traffic.js';
