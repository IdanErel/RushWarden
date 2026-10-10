/**
 * Vehicles and tick rules 1, 2, 4 and 6 (GDD section 3; P1-SIM-02). Struct-of-arrays state so a
 * round allocates once and a tick allocates nothing (except taxi re-routes).
 *
 * Each tick:
 * 0. Demand due this tick joins its edge's FIFO; each edge (in index order) spawns from the head of
 *    its queue onto the first free cell 0 of its spawn link's lanes (kerb lane first).
 * Then every vehicle, sorted by (laneId, cellIndex) descending so downstream moves first:
 * 1. Acceleration: `v = min(v + 1, vmax)`.
 * 2. Gap: `v = min(v, free cells ahead along the route)`; the stop line counts as blocked
 *    when the intersection's controller says stop (rule 5, controllers.ts), and a bus also stops
 *    at an unserved bus stop cell. Turners use the turn pocket when one is placed.
 * 4. Move: advance `v` cells one at a time along the pre-computed route. At a link's end the
 *    vehicle enters the intersection box lane of its next movement, then the next link.
 * 6. Exit: moving past the end of the route's last link enters the sink; the vehicle is removed
 *    and its score value is added to throughput.
 * Rule 5 (controllers.ts) runs at the start of the tick: signals advance and grants are picked.
 * Rule 3 (p_slow) arrives in P1-SIM-04.
 */
import {
  BIKE_SHARED_VMAX,
  BUS_DWELL_TICKS,
  MAX_VEHICLE_LENGTH,
  VEHICLE_SPECS,
} from './vehicles.js';
import {
  enterBox,
  leaveBox,
  mayEnter,
  PocketMode,
  ROUNDABOUT_CAPACITY,
  UNCONTROLLED_RESOLVE_TICKS,
  updateControllers,
} from './controllers.js';
import { opposite, route, Turn, weightedRoute, type World } from './world.js';
import { DEFAULT_SWITCH_TICKS } from './types.js';
import { VehicleType, type DemandProfile } from './types.js';

const NONE = -1;
/** Hot-loop copies of the vehicle table; bikes move at BIKE_SHARED_VMAX without bike lanes. */
const VMAX = Uint8Array.from(VEHICLE_SPECS, (s, type) =>
  type === VehicleType.Bike ? BIKE_SHARED_VMAX : s.vmax,
);
const VEHICLE_LENGTH = Uint8Array.from(VEHICLE_SPECS, (s) => s.length);
/** `Traffic.laneKind` codes. */
const ROAD = 0;
const BOX = 1;
const POCKET = 2;
/** `walk` results. */
const BLOCKED = 0;
const MOVED = 1;
const EXIT = 2;
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
  /** 0 road, 1 box, 2 pocket. */
  readonly laneKind: Uint8Array;
  /** Intersection of box and pocket lanes, else -1. */
  readonly laneIx: Int32Array;
  /** First physical cell of the box quarters (`world.laneCellBase[roadLanes]`). */
  readonly boxBase: number;
  /** Current tick (set by `prepareTick`). */
  tick: number;
  /** When set, every box entry appends (vehicle, intersection, tick). For tests and tools. */
  entryLog: number[] | null;
  // Per intersection: controller state for the round (controllers.ts).
  readonly ctrlKind: Uint8Array;
  readonly ctrlCapacity: Uint8Array;
  /** Priority axis: 0 = n-s, 1 = e-w. */
  readonly ctrlAxis: Uint8Array;
  /** Signal phase: 0 = n-s green, 1 = e-w green. */
  readonly sigPhase: Uint8Array;
  readonly sigTimer: Int32Array;
  /** All-red ticks left before the next phase. */
  readonly sigClearing: Uint8Array;
  readonly sigAdaptive: Uint8Array;
  readonly sigSwitchTicks: Uint8Array;
  readonly resolveTicks: Uint8Array;
  /** `PocketMode` per approach: `[intersection * 4 + inSide]`. */
  readonly pocketMode: Uint8Array;
  /** This tick's grant (uncontrolled, stop-all, priority minor road), or -1. */
  readonly granted: Int32Array;
  /** Vehicles whose head is in the box. */
  readonly boxCount: Int32Array;
  /** Trucks whose head is on a turning movement in the box. */
  readonly truckTurning: Int32Array;
  /**
   * Stop-line cells per intersection, for grants: entries `[lineStart[ix], lineStart[ix + 1])`
   * of `lineLane` (approach lane or pocket), `lineSide` (its in-side) and `linePhys` (its last
   * cell's physical cell).
   */
  readonly lineStart: Int32Array;
  readonly lineLane: Int32Array;
  readonly lineSide: Int8Array;
  readonly linePhys: Int32Array;
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
  /** Tick the head arrived at its current stop-line cell, or -1 when not at a line. */
  readonly atLine: Int32Array;
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
  const laneKind = new Uint8Array(lanes);
  const laneIx = new Int32Array(lanes);
  for (let i = 0; i < lanes; i++) {
    const l = world.lanes[i]!;
    laneCells[i] = l.cells;
    laneLink[i] = l.link;
    laneTurn[i] = l.turn;
    laneKind[i] = l.kind === 'road' ? ROAD : l.kind === 'box' ? BOX : POCKET;
    laneIx[i] = l.intersection;
  }
  const ixCount = world.intersections.length;
  const lineStart = new Int32Array(ixCount + 1);
  const lineLaneList: number[] = [];
  const lineSideList: number[] = [];
  for (const node of world.intersections) {
    for (let s = 0; s < 4; s++) {
      const inLink = node.inLinks[s]!;
      if (inLink === NONE) continue;
      for (const lane of [...world.links[inLink]!.lanes, world.pocketLane[node.index * 4 + s]!]) {
        lineLaneList.push(lane);
        lineSideList.push(s);
      }
    }
    lineStart[node.index + 1] = lineLaneList.length;
  }
  const lineLane = Int32Array.from(lineLaneList);
  const linePhys = lineLane.map(
    (lane) => world.cellPhys[world.laneCellBase[lane]! + laneCells[lane]! - 1]!,
  );
  return {
    world,
    demand,
    occ: new Int32Array(world.physCells),
    linkLoad: new Int32Array(world.links.length),
    laneCells,
    laneLink,
    laneTurn,
    laneKind,
    laneIx,
    boxBase: world.laneCellBase[world.roadLanes]!,
    tick: 0,
    entryLog: null,
    ctrlKind: new Uint8Array(ixCount),
    ctrlCapacity: new Uint8Array(ixCount).fill(ROUNDABOUT_CAPACITY),
    ctrlAxis: new Uint8Array(ixCount),
    sigPhase: new Uint8Array(ixCount),
    sigTimer: new Int32Array(ixCount),
    sigClearing: new Uint8Array(ixCount),
    sigAdaptive: new Uint8Array(ixCount),
    sigSwitchTicks: new Uint8Array(ixCount).fill(DEFAULT_SWITCH_TICKS),
    resolveTicks: new Uint8Array(ixCount).fill(UNCONTROLLED_RESOLVE_TICKS),
    pocketMode: new Uint8Array(ixCount * 4),
    granted: new Int32Array(ixCount).fill(NONE),
    boxCount: new Int32Array(ixCount),
    truckTurning: new Int32Array(ixCount),
    lineStart,
    lineLane,
    lineSide: Int8Array.from(lineSideList),
    linePhys,
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
    atLine: new Int32Array(cap).fill(NONE),
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

/**
 * Advances the cursor one cell along vehicle `i`'s route `rt`. Returns MOVED, EXIT (the next cell
 * is the sink) or BLOCKED (the stop line, and the controller says stop).
 */
function walk(t: Traffic, i: number, rt: readonly number[]): number {
  if (wCell + 1 < t.laneCells[wLane]!) {
    wCell++;
    return MOVED;
  }
  const w = t.world;
  const kind = t.laneKind[wLane]!;
  if (kind === BOX) {
    const next = w.links[rt[wStep + 1]!]!;
    const n = next.lanes.length;
    const turn = t.laneTurn[wLane]!;
    const idx = turn === Turn.Right ? 0 : turn === Turn.Left ? n - 1 : wIdx < n ? wIdx : n - 1;
    wLane = next.lanes[idx]!;
    wCell = 0;
    wStep++;
    wIdx = idx;
    return MOVED;
  }
  // At the end of an approach lane or a turn pocket: the stop line.
  if (kind === ROAD && wStep + 1 >= rt.length) return EXIT;
  const link = w.links[t.laneLink[wLane]!]!;
  const ix = link.to.index;
  const inSide = opposite(link.exitDirs[link.exitDirs.length - 1]!);
  const box = w.movementLane[ix * 16 + inSide * 4 + w.links[rt[wStep + 1]!]!.entryDirs[0]!]!;
  if (kind === ROAD) {
    const mode = t.pocketMode[ix * 4 + inSide]!;
    const turn = t.laneTurn[box]!;
    if (
      mode !== PocketMode.None &&
      (turn === Turn.Left || (mode === PocketMode.Both && turn === Turn.Right))
    ) {
      wLane = w.pocketLane[ix * 4 + inSide]!;
      wCell = 0;
      return MOVED;
    }
  }
  if (!mayEnter(t, i, ix, inSide, box)) return BLOCKED;
  wLane = box;
  wCell = 0;
  return MOVED;
}

function setCursor(t: Traffic, i: number): void {
  wLane = t.lane[i]!;
  wCell = t.cell[i]!;
  wStep = t.step[i]!;
  wIdx = t.laneIdx[i]!;
}

// The path `gapAhead` walked, replayed by `move` (module scratch, at most vmax <= 4 cells):
// cursor state after each step, and the step at which the vehicle reaches the sink (or 0).
const pLane = new Int32Array(8);
const pCell = new Int32Array(8);
const pStep = new Int32Array(8);
const pIdx = new Int32Array(8);
const pPhys = new Int32Array(8);
let pExitAt = 0;

/** Rule 2: free cells ahead of vehicle `i`, up to `v`; records the path for `move`. */
function gapAhead(t: Traffic, i: number, v: number): number {
  const w = t.world;
  const rt = t.routes[i]!;
  const isBus = t.type[i] === VehicleType.Bus;
  setCursor(t, i);
  pExitAt = 0;
  for (let k = 1; k <= v; k++) {
    const r = walk(t, i, rt);
    if (r === EXIT) {
      pExitAt = k;
      return k;
    }
    if (r === BLOCKED) return k - 1;
    const flat = w.laneCellBase[wLane]! + wCell;
    const phys = w.cellPhys[flat]!;
    if (t.occ[phys] !== 0) return k - 1;
    pLane[k] = wLane;
    pCell[k] = wCell;
    pStep[k] = wStep;
    pIdx[k] = wIdx;
    pPhys[k] = phys;
    if (isBus && w.stopCell[flat] === 1 && t.served[i] !== flat) return k;
  }
  return v;
}

function occupy(t: Traffic, i: number, phys: number): void {
  const len = VEHICLE_LENGTH[t.type[i]!]!;
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

/** Rules 4 and 6: moves vehicle `i` by `v` cells along the path `gapAhead` recorded. Returns false if it exited. */
function move(t: Traffic, i: number, v: number): boolean {
  const w = t.world;
  const isTaxi = t.type[i] === VehicleType.Taxi;
  let lane = t.lane[i]!;
  let step = t.step[i]!;
  let shift = 0; // a taxi re-route renumbers its route from the current link (index 0)
  for (let k = 1; k <= v; k++) {
    if (k === pExitAt) {
      exit(t, i);
      return false;
    }
    const next = pLane[k]!;
    if (next !== lane) {
      if (t.laneKind[lane] === BOX) leaveBox(t, i, lane);
      if (t.laneKind[next] === BOX) enterBox(t, i, next);
      lane = next;
    }
    occupy(t, i, pPhys[k]!);
    const nextStep = pStep[k]! - shift;
    if (isTaxi && nextStep !== step) {
      const r = taxiRoute(t, i, t.routes[i]![nextStep]!);
      if (r) {
        t.routes[i] = r;
        shift += nextStep;
      }
    }
    step = pStep[k]! - shift;
  }
  if (v > 0) {
    t.lane[i] = lane;
    t.cell[i] = pCell[v]!;
    t.step[i] = step;
    t.laneIdx[i] = pIdx[v]!;
  }
  const flat = w.laneCellBase[lane]! + t.cell[i]!;
  if (w.lineCell[flat] === 0) t.atLine[i] = NONE;
  else if (v > 0) t.atLine[i] = t.tick;
  if (t.type[i] === VehicleType.Bus) {
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

/** Spawns this tick's demand, sorts `order` into the update order and runs rule 5's start-of-tick step. */
export function prepareTick(t: Traffic, tick: number): void {
  t.tick = tick;
  spawn(t, tick);
  sortOrder(t);
  updateControllers(t);
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
    const vmax = VMAX[vt]!;
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
