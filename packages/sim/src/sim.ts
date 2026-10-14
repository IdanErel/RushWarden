import { Hasher, hashValue } from './hash.js';
import { validatePlacements } from './placements.js';
import { createPrng, type PrngState } from './prng.js';
import { controllerFrame } from './controllers.js';
import { createTraffic, tickTraffic, waitingPerEdge, type Traffic } from './traffic.js';
import { MAX_VEHICLE_LENGTH, VEHICLE_TYPE_COUNT } from './vehicles.js';
import {
  checkSupported,
  configureTraffic,
  laneOverrides,
  resolvePlacements,
  tollFunds,
  transformDemand,
  type Toll,
} from './effects.js';
import { buildWorld, closedLinkMask, edgeIndex, type LaneOverride, type World } from './world.js';
import {
  GRIDLOCK_TICKS,
  ROUND_TICKS,
  SNAPSHOT_HEADER,
  SNAPSHOT_STRIDE,
  type GridMap,
  type RoundInput,
  type RoundResult,
  type SimState,
} from './types.js';

/**
 * Internal state behind the opaque `SimState`: the world (P1-SIM-01) and its traffic
 * (P1-SIM-02). The shape of `init`/`step`/`snapshot`/`result`/`simulate` is the contract and stays.
 */
interface State extends SimState {
  tick: number;
  done: boolean;
  readonly input: RoundInput;
  readonly inputDigest: string;
  /** Tiles, links, lanes, intersections and edges for this round (derived from `input.map`). */
  readonly world: World;
  readonly prng: PrngState;
  /** Vehicles, occupancy and counters (spawned, exited, throughput). */
  readonly traffic: Traffic;
  fundsDelta: number;
  gridlocked: boolean;
  /** Consecutive ticks with vehicles present and no exit or junction entry (ADR-033). */
  stalledTicks: number;
  /** `traffic.exited + traffic.boxEntries` after the previous tick; a change is progress. */
  lastProgress: number;
  /** Rolling per-tick mix so the final hash depends on the whole trajectory, not just the end. */
  trail: number;
  readonly frames: Uint16Array[] | null;
  /** Segment tolls (Toll Booth); `fundsDelta` is computed from their counts. */
  tolls: Toll[];
}

function asState(s: SimState): State {
  return s as State;
}

/**
 * Worlds are a pure function of the map and immutable once built (routes are cached lazily, which
 * gives the same result whenever they are computed), so rounds on the same map object share one.
 * The balance runner plays thousands of rounds per map; this keeps world building and BFS out of
 * its per-round cost. Per-round mutable state (vehicles, controllers) lives in `State`.
 */
const worlds = new WeakMap<GridMap, Map<string, World>>();
function worldFor(map: GridMap, overrides: readonly LaneOverride[] = []): World {
  let byTopology = worlds.get(map);
  if (!byTopology) {
    byTopology = new Map();
    worlds.set(map, byTopology);
  }
  // Topology cards (setOneWay, setLaneCount) give the round its own world, cached by override.
  const key = overrides.length === 0 ? '' : JSON.stringify(overrides);
  let w = byTopology.get(key);
  if (!w) {
    w = buildWorld(map, overrides);
    byTopology.set(key, w);
  }
  return w;
}

/**
 * The world a round runs on: the map plus its topology cards (`setOneWay`, `setLaneCount`).
 * Lane ids in snapshots refer to this world, so the renderer builds its lane layout from it
 * rather than from `buildWorld(map)` (ADR-023). Throws like `Sim.init` on invalid input.
 */
export function roundWorld(input: RoundInput): World {
  validate(input);
  const { applied } = resolvePlacements(input.cardState.runEffects, input.placements);
  checkSupported(applied);
  return worldFor(input.map, laneOverrides(input.map, applied));
}

/**
 * Validates the parts of the input the sim relies on and builds the world. Throws `RangeError`
 * (or its subclass `MapError`) on bad input.
 */
function validate(input: RoundInput): World {
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff) {
    throw new RangeError(`seed must be a uint32, got ${input.seed}`);
  }
  if (input.map.id !== input.mapId) {
    throw new RangeError(`map.id "${input.map.id}" does not match mapId "${input.mapId}"`);
  }
  const pSlow = input.districtRules.pSlowPermille;
  if (!Number.isInteger(pSlow) || pSlow < 0 || pSlow > 1000)
    throw new RangeError(`pSlowPermille must be an integer 0..1000, got ${pSlow}`);
  const world = worldFor(input.map);
  let prevTick = 0;
  let prevEdge = -1;
  for (const e of input.demandProfile) {
    if (!Number.isInteger(e.tick) || e.tick < 0 || e.tick >= ROUND_TICKS)
      throw new RangeError(`demand tick ${e.tick} out of range`);
    if (
      !Number.isInteger(e.vehicleType) ||
      e.vehicleType < 0 ||
      e.vehicleType >= VEHICLE_TYPE_COUNT
    )
      throw new RangeError(`demand vehicle type ${e.vehicleType} out of range`);
    if (e.tick < prevTick || (e.tick === prevTick && e.edge < prevEdge))
      throw new RangeError(
        `demand must be sorted by (tick, edge); tick ${e.tick} edge ${e.edge} is out of order`,
      );
    prevTick = e.tick;
    prevEdge = e.edge;
    if (edgeIndex(world, e.edge) === edgeIndex(world, e.destinationEdge)) {
      throw new RangeError(`demand at tick ${e.tick} has edge ${e.edge} as its own destination`);
    }
  }
  validatePlacements(input.map, input.placements);
  validatePlacements(input.map, input.cardState.runEffects);
  return world;
}

const mapDigests = new WeakMap<GridMap, string>();

/**
 * Digest of everything the round depends on (the leaderboard verifier re-simulates exactly this).
 * The map digest is cached per map object and the demand profile, the bulk of the input, is fed
 * as plain integers (validated above); everything else goes through the generic `hashValue`.
 */
function inputDigest(input: RoundInput): string {
  let md = mapDigests.get(input.map);
  if (md === undefined) {
    md = hashValue(new Hasher(), input.map).digest();
    mapDigests.set(input.map, md);
  }
  const h = new Hasher()
    .int(input.seed | 0)
    .str(input.mapId)
    .str(md)
    .int(input.demandProfile.length);
  for (const e of input.demandProfile)
    h.int(e.tick).int(e.edge).int(e.vehicleType).int(e.destinationEdge);
  hashValue(h, {
    placements: input.placements,
    cardState: input.cardState,
    districtRules: input.districtRules,
    // Only when something is closed, so inputs without closures keep their digests.
    ...(input.closedSegments?.length ? { closedSegments: input.closedSegments } : {}),
  });
  return h.digest();
}

/** Creates the state at tick 0 for a round. Pure: the same input always gives an equal state. */
export function init(input: RoundInput): SimState {
  validate(input);
  // Card effects (P1-SIM-05, effects.ts): stacking and conflicts, then topology, demand, traffic.
  const { applied } = resolvePlacements(input.cardState.runEffects, input.placements);
  checkSupported(applied);
  const world = worldFor(input.map, laneOverrides(input.map, applied));
  const demand = transformDemand(input.map, input.demandProfile, applied);
  const state: State = {
    tick: 0,
    done: false,
    input,
    inputDigest: inputDigest(input),
    world,
    prng: createPrng(input.seed),
    traffic: createTraffic(world, demand),
    fundsDelta: 0,
    gridlocked: false,
    stalledTicks: 0,
    lastProgress: 0,
    trail: 0,
    frames: input.recordFrames ? [] : null,
    tolls: [],
  };
  // Rule 3: the round's PRNG drives p_slow and nothing else in the tick (GDD section 3).
  state.traffic.prng = state.prng;
  state.traffic.closed = closedLinkMask(world, input.closedSegments ?? []);
  state.tolls = configureTraffic(
    state.traffic,
    input.map,
    applied,
    input.districtRules.pSlowPermille,
  );
  return state;
}

/**
 * Advances one tick (1/20 s) following the GDD section 3 tick order. Returns the state to use
 * next; the argument must not be used afterwards (it may have been updated in place, ADR-002).
 * Stepping a finished state is a no-op.
 */
export function step(s: SimState): SimState {
  const st = asState(s);
  if (st.done) return st;
  const t = st.traffic;
  // Spawning, rule 5 (controllers) and tick rules 1, 2, 3, 4 and 6 (traffic.ts, controllers.ts).
  tickTraffic(t, st.tick);
  st.trail =
    (Math.imul(st.trail, 31) +
      Math.imul(t.speedSum + 1, 0x9e3779b1) +
      t.orderLen * 7 +
      t.throughput) |
    0;
  st.tick += 1;
  if (st.frames) st.frames.push(snapshot(st));
  // Gridlock detector (ADR-033): the round ends after GRIDLOCK_TICKS consecutive ticks with at
  // least one vehicle on the map and no progress, where progress is a vehicle exiting or a vehicle
  // entering a junction box. Movement elsewhere (creeping along spawn roads) does not reset it. A
  // tick with no vehicle on the map does not count and resets the run.
  const progress = t.exited + t.boxEntries;
  if (t.orderLen > 0 && progress === st.lastProgress) st.stalledTicks++;
  else st.stalledTicks = 0;
  st.lastProgress = progress;
  if (st.stalledTicks >= GRIDLOCK_TICKS) {
    st.gridlocked = true;
    st.done = true;
  }
  if (st.tick >= ROUND_TICKS) st.done = true;
  return st;
}

/**
 * Compact snapshot for the renderer and replays: `[tick, count, ...count * (id, lane, cell,
 * speed, type)]` as a Uint16Array, suitable for transfer from the worker.
 */
export function snapshot(s: SimState): Uint16Array {
  const st = asState(s);
  const t = st.traffic;
  const n = t.orderLen;
  const out = new Uint16Array(SNAPSHOT_HEADER + n * SNAPSHOT_STRIDE);
  out[0] = st.tick;
  out[1] = n;
  for (let k = 0, o = SNAPSHOT_HEADER; k < n; k++, o += SNAPSHOT_STRIDE) {
    const i = t.order[k]!;
    out[o] = i;
    out[o + 1] = t.lane[i]!;
    out[o + 2] = t.cell[i]!;
    out[o + 3] = t.speed[i]!;
    out[o + 4] = t.type[i]!;
  }
  return out;
}

/**
 * Per map edge, in `GridMap.edges` order: trips due but not yet spawned after the last tick,
 * queued behind an occupied entry cell or unable to enter at all (ADR-035). The worker streams
 * it with each frame; it is not part of the state hash.
 */
export function waitingSnapshot(s: SimState): Uint16Array {
  const w = waitingPerEdge(asState(s).traffic);
  return Uint16Array.from(w, (n) => Math.min(n, 0xffff));
}

/** The round's traffic (routes, masks), for sim-internal analyses such as `cutRoutes`. */
export function trafficOf(s: SimState): Traffic {
  return asState(s).traffic;
}

/**
 * Controller state for the renderer, per intersection `[kind, greenMask, boxCount]` (see
 * `controllerFrame`). Not part of the snapshot format yet; the Lead decides how the worker
 * protocol carries it.
 */
export function controllerSnapshot(s: SimState): Uint8Array {
  return controllerFrame(asState(s).traffic);
}

/** 64-bit hash of the current state (16 hex characters). */
export function stateHash(s: SimState): string {
  const st = asState(s);
  const t = st.traffic;
  const h = new Hasher()
    .str(st.inputDigest)
    .int(st.tick)
    .ints(st.prng.s)
    .int(t.spawned)
    .int(t.exited)
    .int(t.throughput)
    .int(st.fundsDelta)
    .bool(st.gridlocked)
    .int(st.trail)
    .int(t.orderLen);
  for (let k = 0; k < t.orderLen; k++) {
    const i = t.order[k]!;
    h.int(i).int(t.lane[i]!).int(t.cell[i]!).int(t.speed[i]!).int(t.dwell[i]!).int(t.step[i]!);
    for (let j = 0; j < MAX_VEHICLE_LENGTH; j++) h.int(t.tail[i * MAX_VEHICLE_LENGTH + j]!);
    h.int(t.atLine[i]!);
  }
  h.ints(t.ctrlKind).ints(t.sigPhase).ints(t.sigTimer).ints(t.sigClearing);
  if (t.tollCount) h.ints(t.tollCount);
  // ADR-035: only rounds that divert or strand a trip hash these, so other hashes are unchanged.
  if (t.diverted > 0 || t.stuck.some((n) => n > 0)) h.int(t.diverted).ints(t.stuck);
  return h.digest();
}

/** Builds the result from a finished (or gridlocked) state. */
export function result(s: SimState): RoundResult {
  const st = asState(s);
  const base = {
    throughput: st.traffic.throughput,
    spawned: st.traffic.spawned,
    exited: st.traffic.exited,
    ticks: st.tick,
    gridlocked: st.gridlocked,
    fundsDelta: st.fundsDelta + tollFunds(st.traffic, st.tolls),
    diverted: st.traffic.diverted,
    waiting: waitingPerEdge(st.traffic),
    finalHash: stateHash(st),
  };
  return st.frames ? { ...base, frames: st.frames } : base;
}

/** Runs a whole round headless. `simulate(x)` always equals stepping `init(x)` to the end. */
export function simulate(input: RoundInput): RoundResult {
  let s = init(input);
  while (!s.done) s = step(s);
  return result(s);
}
