import { Hasher, hashValue } from './hash.js';
import { validatePlacements } from './placements.js';
import { createPrng, nextU32, type PrngState } from './prng.js';
import { buildWorld, edgeIndex, type World } from './world.js';
import {
  ROUND_TICKS,
  SNAPSHOT_HEADER,
  type RoundInput,
  type RoundResult,
  type SimState,
} from './types.js';

/**
 * Internal state behind the opaque `SimState`. P1-SIM-01 builds the world (tiles, lanes,
 * intersections, edges, routes); vehicles arrive in P1-SIM-02, so a round is still 300 empty
 * ticks. The shape of `init`/`step`/`snapshot`/`result`/`simulate` is the contract and stays.
 */
interface State extends SimState {
  tick: number;
  done: boolean;
  readonly input: RoundInput;
  readonly inputDigest: string;
  /** Tiles, links, lanes, intersections and edges for this round (derived from `input.map`). */
  readonly world: World;
  readonly prng: PrngState;
  spawned: number;
  exited: number;
  throughput: number;
  fundsDelta: number;
  gridlocked: boolean;
  /** Consecutive ticks with zero total speed while vehicles are present. */
  stalledTicks: number;
  /** Rolling per-tick mix so the final hash depends on the whole trajectory, not just the end. */
  trail: number;
  readonly frames: Uint16Array[] | null;
}

function asState(s: SimState): State {
  return s as State;
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
  const world = buildWorld(input.map);
  for (const e of input.demandProfile) {
    if (e.tick < 0 || e.tick >= ROUND_TICKS)
      throw new RangeError(`demand tick ${e.tick} out of range`);
    if (edgeIndex(world, e.edge) === edgeIndex(world, e.destinationEdge)) {
      throw new RangeError(`demand at tick ${e.tick} has edge ${e.edge} as its own destination`);
    }
  }
  validatePlacements(input.map, input.placements);
  validatePlacements(input.map, input.cardState.runEffects);
  return world;
}

/** Creates the state at tick 0 for a round. Pure: the same input always gives an equal state. */
export function init(input: RoundInput): SimState {
  const world = validate(input);
  const state: State = {
    tick: 0,
    done: false,
    input,
    inputDigest: hashValue(new Hasher(), { ...input, recordFrames: null }).digest(),
    world,
    prng: createPrng(input.seed),
    spawned: 0,
    exited: 0,
    throughput: 0,
    fundsDelta: 0,
    gridlocked: false,
    stalledTicks: 0,
    trail: 0,
    frames: input.recordFrames ? [] : null,
  };
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
  // Stand-in for tick rules 1-6: no vehicles yet. The PRNG still advances once per tick so the
  // trajectory, and therefore the hash, depends on the seed exactly as the real sim will.
  st.trail = (Math.imul(st.trail, 31) + nextU32(st.prng)) | 0;
  st.tick += 1;
  if (st.frames) st.frames.push(snapshot(st));
  if (st.tick >= ROUND_TICKS) st.done = true;
  return st;
}

/**
 * Compact snapshot for the renderer and replays: `[tick, count, ...count * (id, lane, cell,
 * speed, type)]` as a Uint16Array, suitable for transfer from the worker.
 */
export function snapshot(s: SimState): Uint16Array {
  const st = asState(s);
  const out = new Uint16Array(SNAPSHOT_HEADER);
  out[0] = st.tick;
  out[1] = 0;
  return out;
}

/** 64-bit hash of the current state (16 hex characters). */
export function stateHash(s: SimState): string {
  const st = asState(s);
  return new Hasher()
    .str(st.inputDigest)
    .int(st.tick)
    .ints(st.prng.s)
    .int(st.spawned)
    .int(st.exited)
    .int(st.throughput)
    .int(st.fundsDelta)
    .bool(st.gridlocked)
    .int(st.trail)
    .digest();
}

/** Builds the result from a finished (or gridlocked) state. */
export function result(s: SimState): RoundResult {
  const st = asState(s);
  const base = {
    throughput: st.throughput,
    spawned: st.spawned,
    exited: st.exited,
    ticks: st.tick,
    gridlocked: st.gridlocked,
    fundsDelta: st.fundsDelta,
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
