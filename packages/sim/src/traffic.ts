/**
 * Vehicles and tick rules 1, 2, 4 and 6 (GDD section 3; P1-SIM-02). Struct-of-arrays state so a
 * round allocates once and a tick allocates nothing (except taxi re-routes).
 *
 * Each tick:
 * 0. Demand due this tick joins its edge's FIFO; each edge (in index order) spawns from the head of
 *    its queue onto the first free cell 0 of its spawn link's lanes (kerb lane first).
 * Then every vehicle, sorted by (laneId, cellIndex) descending so downstream moves first:
 * 1. Acceleration: `v = min(v + 1, vmax)`.
 * 2. Gap: `v = min(v, free cells ahead along the route)`; a bus also stops at an unserved bus
 *    stop cell. Stop lines and turn reservations arrive with controllers (P1-SIM-03).
 * 4. Move: advance `v` cells one at a time along the pre-computed route. At a link's end the
 *    vehicle enters the intersection box lane of its next movement, then the next link.
 * 6. Exit: moving past the end of the route's last link enters the sink; the vehicle is removed
 *    and its score value is added to throughput.
 * Rule 3 (p_slow) arrives in P1-SIM-04; rule 5 (controllers) in P1-SIM-03.
 */
import {
  BIKE_SHARED_VMAX,
  BUS_DWELL_TICKS,
  MAX_VEHICLE_LENGTH,
  VEHICLE_SPECS,
} from './vehicles.js';
import { opposite, route, Turn, weightedRoute, type World } from './world.js';
import { VehicleType, type DemandProfile } from './types.js';

const NONE = -1;
/** Sort key: lane * KEY_LANE + cell. Lanes never exceed 4095 cells. */
const KEY_LANE = 4096;
/** Taxi route cost per occupied cell on a link, on top of its free-flow length in cells. */
export const TAXI_LOAD_COST = 2;

export interface Traffic {
  readonly world: World;
  readonly demand: DemandProfile;
  /** Physical cell -> vehicle index + 1, or 0 when free. */
  readonly occ: Int32Array;
  /** Occupied road cells per link (taxi cost). */
  readonly linkLoad: Int32Array;
  // Per lane, copied from the world for the hot loop.
  readonly laneCells: Int32Array;
  readonly laneLink: Int32Array;
  readonly laneTurn: Int32Array;
  // Per vehicle (index = spawn order).
  readonly type: Uint8Array;
  readonly lane: Int32Array;
  readonly cell: Int32Array;
  readonly speed: Uint8Array;
  /** Index of the current (or, in a box, the last) road lane within its link. */
  readonly laneIdx: Uint8Array;
  /** Index into the vehicle's route of its current link (in a box: the link just left). */
  readonly step: Int32Array;
  readonly routes: (readonly number[])[];
  readonly dest: Int32Array;
  /** Physical cells held, head first, MAX_VEHICLE_LENGTH per vehicle; -1 = none. */
  readonly tail: Int32Array;
  readonly dwell: Uint8Array;
  /** Flat lane cell of the last bus stop served, or -1. */
  readonly served: Int32Array;
  count: number;
  /** Alive vehicles in update order. */
  readonly order: Int32Array;
  readonly keys: Int32Array;
  orderLen: number;
  /** Per edge: demand indices waiting to spawn, FIFO. */
  readonly pending: number[][];
  readonly pendingHead: Int32Array;
  demandNext: number;
  spawned: number;
  exited: number;
  throughput: number;
  /** Sum of speeds after the last tick (the gridlock detector's input, P1-SIM-04). */
  speedSum: number;
}

export function createTraffic(world: World, demand: DemandProfile): Traffic {
  const cap = demand.length;
  const lanes = world.lanes.length;
  const laneCells = new Int32Array(lanes);
  const laneLink = new Int32Array(lanes);
  const laneTurn = new Int32Array(lanes);
  for (let i = 0; i < lanes; i++) {
    const l = world.lanes[i]!;
    laneCells[i] = l.cells;
    laneLink[i] = l.link;
    laneTurn[i] = l.turn;
  }
  return {
    world,
    demand,
    occ: new Int32Array(world.physCells),
    linkLoad: new Int32Array(world.links.length),
    laneCells,
    laneLink,
    laneTurn,
    type: new Uint8Array(cap),
    lane: new Int32Array(cap),
    cell: new Int32Array(cap),
    speed: new Uint8Array(cap),
    laneIdx: new Uint8Array(cap),
    step: new Int32Array(cap),
    routes: new Array<readonly number[]>(cap),
    dest: new Int32Array(cap),
    tail: new Int32Array(cap * MAX_VEHICLE_LENGTH).fill(NONE),
    dwell: new Uint8Array(cap),
    served: new Int32Array(cap).fill(NONE),
    count: 0,
    order: new Int32Array(cap),
    keys: new Int32Array(cap),
    orderLen: 0,
    pending: world.edges.map(() => []),
    pendingHead: new Int32Array(world.edges.length),
    demandNext: 0,
    spawned: 0,
    exited: 0,
    throughput: 0,
    speedSum: 0,
  };
}

// Walk cursor (module scratch; the sim is single-threaded and never re-enters a walk).
let wLane = 0;
let wCell = 0;
let wStep = 0;
let wIdx = 0;

/** Advances the cursor one cell along `rt`. Returns false when the next cell is the sink. */
function walk(t: Traffic, rt: readonly number[]): boolean {
  if (wCell + 1 < t.laneCells[wLane]!) {
    wCell++;
    return true;
  }
  const w = t.world;
  const linkId = t.laneLink[wLane]!;
  if (linkId !== NONE) {
    if (wStep + 1 >= rt.length) return false;
    const link = w.links[linkId]!;
    const next = w.links[rt[wStep + 1]!]!;
    const inSide = opposite(link.exitDirs[link.exitDirs.length - 1]!);
    wLane = w.movementLane[link.to.index * 16 + inSide * 4 + next.entryDirs[0]!]!;
    wCell = 0;
    return true;
  }
  const next = w.links[rt[wStep + 1]!]!;
  const n = next.lanes.length;
  const turn = t.laneTurn[wLane]!;
  const idx = turn === Turn.Right ? 0 : turn === Turn.Left ? n - 1 : wIdx < n ? wIdx : n - 1;
  wLane = next.lanes[idx]!;
  wCell = 0;
  wStep++;
  wIdx = idx;
  return true;
}

function setCursor(t: Traffic, i: number): void {
  wLane = t.lane[i]!;
  wCell = t.cell[i]!;
  wStep = t.step[i]!;
  wIdx = t.laneIdx[i]!;
}

/** Rule 2: free cells ahead of vehicle `i`, up to `v`. */
function gapAhead(t: Traffic, i: number, v: number): number {
  const w = t.world;
  const rt = t.routes[i]!;
  const isBus = t.type[i] === VehicleType.Bus;
  setCursor(t, i);
  for (let k = 1; k <= v; k++) {
    if (!walk(t, rt)) return v;
    const flat = w.laneCellBase[wLane]! + wCell;
    if (t.occ[w.cellPhys[flat]!] !== 0) return k - 1;
    if (isBus && w.stopCell[flat] === 1 && t.served[i] !== flat) return k;
  }
  return v;
}

function occupy(t: Traffic, i: number, phys: number): void {
  const len = VEHICLE_SPECS[t.type[i]!]!.length;
  const base = i * MAX_VEHICLE_LENGTH;
  const last = t.tail[base + len - 1]!;
  if (last !== NONE) release(t, last);
  for (let j = len - 1; j > 0; j--) t.tail[base + j] = t.tail[base + j - 1]!;
  t.tail[base] = phys;
  t.occ[phys] = i + 1;
  const link = t.world.physLink[phys]!;
  if (link !== NONE) t.linkLoad[link]!++;
}

function release(t: Traffic, phys: number): void {
  t.occ[phys] = 0;
  const link = t.world.physLink[phys]!;
  if (link !== NONE) t.linkLoad[link]!--;
}

/** Taxi re-route on entering a link that ends at an intersection (time-weighted costs). */
function taxiRoute(t: Traffic, i: number, linkId: number): readonly number[] | null {
  const w = t.world;
  const link = w.links[linkId]!;
  if (link.to.kind !== 'intersection') return null;
  const rest = weightedRoute(
    w,
    link.to.index,
    opposite(link.exitDirs[link.exitDirs.length - 1]!),
    t.dest[i]!,
    (l) => w.links[l]!.cells + TAXI_LOAD_COST * t.linkLoad[l]!,
  );
  return rest ? [linkId, ...rest] : null;
}

/** Rules 4 and 6: moves vehicle `i` by `v` cells. Returns false if it exited. */
function move(t: Traffic, i: number, v: number): boolean {
  const w = t.world;
  let rt = t.routes[i]!;
  const isTaxi = t.type[i] === VehicleType.Taxi;
  setCursor(t, i);
  for (let k = 0; k < v; k++) {
    const stepBefore = wStep;
    if (!walk(t, rt)) {
      exit(t, i);
      return false;
    }
    occupy(t, i, w.cellPhys[w.laneCellBase[wLane]! + wCell]!);
    if (isTaxi && wStep !== stepBefore) {
      const r = taxiRoute(t, i, rt[wStep]!);
      if (r) {
        rt = r;
        t.routes[i] = r;
        wStep = 0;
      }
    }
  }
  t.lane[i] = wLane;
  t.cell[i] = wCell;
  t.step[i] = wStep;
  t.laneIdx[i] = wIdx;
  if (t.type[i] === VehicleType.Bus) {
    const flat = w.laneCellBase[wLane]! + wCell;
    if (w.stopCell[flat] === 1 && t.served[i] !== flat) {
      t.served[i] = flat;
      t.dwell[i] = BUS_DWELL_TICKS;
    }
  }
  return true;
}

function exit(t: Traffic, i: number): void {
  const base = i * MAX_VEHICLE_LENGTH;
  for (let j = 0; j < MAX_VEHICLE_LENGTH; j++) {
    const p = t.tail[base + j]!;
    if (p !== NONE) release(t, p);
    t.tail[base + j] = NONE;
  }
  t.lane[i] = NONE;
  t.exited++;
  t.throughput += VEHICLE_SPECS[t.type[i]!]!.score;
}

/** Spawns the head of each edge's queue while its spawn link has a free entry cell. */
function spawn(t: Traffic, tick: number): void {
  const w = t.world;
  while (t.demandNext < t.demand.length && t.demand[t.demandNext]!.tick <= tick) {
    const e = t.demand[t.demandNext]!;
    t.pending[w.edgeIndexById.get(e.edge)!]!.push(t.demandNext);
    t.demandNext++;
  }
  for (let edge = 0; edge < w.edges.length; edge++) {
    const queue = t.pending[edge]!;
    const spawnLink = w.links[w.edges[edge]!.spawnLink]!;
    while (t.pendingHead[edge]! < queue.length) {
      let laneIdx = NONE;
      for (let k = 0; k < spawnLink.lanes.length; k++) {
        if (t.occ[w.cellPhys[w.laneCellBase[spawnLink.lanes[k]!]!]!] === 0) {
          laneIdx = k;
          break;
        }
      }
      if (laneIdx === NONE) break;
      const e = t.demand[queue[t.pendingHead[edge]!]!]!;
      t.pendingHead[edge]!++;
      const dest = w.edgeIndexById.get(e.destinationEdge)!;
      const r = route(w, edge, dest);
      if (!r) continue; // Unreachable (one-way, P1-SIM-05): the trip never starts.
      const i = t.count++;
      t.type[i] = e.vehicleType;
      t.dest[i] = dest;
      t.routes[i] = r.links;
      if (e.vehicleType === VehicleType.Taxi) {
        const tr = taxiRoute(t, i, spawnLink.id);
        if (tr) t.routes[i] = tr;
      }
      t.step[i] = 0;
      t.laneIdx[i] = laneIdx;
      t.lane[i] = spawnLink.lanes[laneIdx]!;
      t.cell[i] = 0;
      t.speed[i] = 0;
      occupy(t, i, w.cellPhys[w.laneCellBase[t.lane[i]!]!]!);
      t.order[t.orderLen++] = i;
      t.spawned++;
    }
  }
}

/** Sorts `order` by (lane, cell) descending, ties by vehicle index; insertion sort (nearly sorted). */
function sortOrder(t: Traffic): void {
  const { order, keys, lane, cell } = t;
  const n = t.orderLen;
  for (let k = 0; k < n; k++) keys[k] = lane[order[k]!]! * KEY_LANE + cell[order[k]!]!;
  for (let a = 1; a < n; a++) {
    const v = order[a]!;
    const key = keys[a]!;
    let b = a - 1;
    while (b >= 0 && (keys[b]! < key || (keys[b] === key && order[b]! > v))) {
      order[b + 1] = order[b]!;
      keys[b + 1] = keys[b]!;
      b--;
    }
    order[b + 1] = v;
    keys[b + 1] = key;
  }
}

/** Spawns this tick's demand and sorts `order` into the update order (exported for tests). */
export function prepareTick(t: Traffic, tick: number): void {
  spawn(t, tick);
  sortOrder(t);
}

/** Runs tick rules 1, 2, 4 and 6 (and spawning) for one tick. */
export function tickTraffic(t: Traffic, tick: number): void {
  prepareTick(t, tick);
  moveAll(t);
}

/** Rules 1, 2, 4 and 6 for every vehicle, in the order `prepareTick` left (exported for tests). */
export function moveAll(t: Traffic): void {
  const { order, speed, dwell, type } = t;
  let alive = 0;
  let speedSum = 0;
  for (let k = 0; k < t.orderLen; k++) {
    const i = order[k]!;
    if (dwell[i]! > 0) {
      dwell[i]!--;
      speed[i] = 0;
      order[alive++] = i;
      continue;
    }
    const vt = type[i]!;
    const vmax = vt === VehicleType.Bike ? BIKE_SHARED_VMAX : VEHICLE_SPECS[vt]!.vmax;
    let v = speed[i]! + 1;
    if (v > vmax) v = vmax;
    v = gapAhead(t, i, v);
    if (move(t, i, v)) {
      speed[i] = v;
      speedSum += v;
      order[alive++] = i;
    }
  }
  t.orderLen = alive;
  t.speedSum = speedSum;
}
