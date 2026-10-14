/**
 * @rushwarden/sim — the deterministic, integer-only traffic simulation (GDD section 3).
 *
 * ```ts
 * import { Sim } from '@rushwarden/sim';
 * const result = Sim.simulate(input); // headless, e.g. balance runner or /verify
 *
 * let state = Sim.init(input);        // tick-by-tick, e.g. the render worker
 * while (!state.done) { state = Sim.step(state); post(Sim.snapshot(state)); }
 * const sameResult = Sim.result(state);
 * ```
 */
import { init, result, simulate, snapshot, stateHash, step } from './sim.js';

export const Sim = { simulate, init, step, snapshot, result, stateHash } as const;

export * from './types.js';
export { Hasher, hashValue } from './hash.js';
export { createPrng, clonePrng, nextU32, nextInt, chancePermille, type PrngState } from './prng.js';
export { idiv, imod, pct, clamp } from './math.js';
export {
  emptyMap,
  sampleInput,
  latticeMap,
  denseInput,
  cardInput,
  CARD_MAP,
  PHASE1_CARDS,
} from './fixtures.js';
export { placementError, segmentTiles } from './placements.js';
export {
  createSimWorkerHandler,
  MAX_TICKS_PER_STEP,
  SIM_PROTOCOL_VERSION,
  type FromSimWorker,
  type PostFromWorker,
  type ToSimWorker,
} from './protocol.js';
export {
  buildWorld,
  route,
  routeByEdgeId,
  edgeIndex,
  weightedRoute,
  locateCell,
  sideIndex,
  opposite,
  tileIndex,
  SIDES,
  TileKind,
  Turn,
  type LaneKind,
  type LaneOverride,
  closedLinkMask,
  MapError,
  type World,
  type Link,
  type Lane,
  type Intersection,
  type WorldEdge,
  type Route,
  type NodeRef,
} from './world.js';
export {
  VEHICLE_SPECS,
  BUS_DWELL_TICKS,
  BIKE_SHARED_VMAX,
  MAX_VEHICLE_LENGTH,
  VEHICLE_TYPE_COUNT,
  type VehicleSpec,
} from './vehicles.js';
export { TAXI_LOAD_COST } from './traffic.js';
export { controllerSnapshot, roundWorld, waitingSnapshot } from './sim.js';
export { cutRoutes, type CutReport, type RouteCut } from './reachability.js';
export { resolvePlacements, unsupportedEffect, type PlacementResolution } from './effects.js';
export {
  ControllerCode,
  PocketMode,
  SIGNAL_GREEN_TICKS,
  ADAPTIVE_MIN_GREEN_TICKS,
  ADAPTIVE_MAX_GREEN_TICKS,
  UNCONTROLLED_RESOLVE_TICKS,
  ROUNDABOUT_CAPACITY,
} from './controllers.js';
