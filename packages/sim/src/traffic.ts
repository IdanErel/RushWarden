/**
 * Vehicles and tick rules 1–6 (GDD section 3; P1-SIM-02 to P1-SIM-04). Struct-of-arrays state so a
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
 * 3. Randomization: with `pSlowPermille` (round PRNG), a vehicle with v > 0 slows by 1.
 * 4. Move: advance `v` cells one at a time along the pre-computed route. At a link's end the
 *    vehicle enters the intersection box lane of its next movement, then the next link.
 * 6. Exit: moving past the end of the route's last link enters the sink; the vehicle is removed
 *    and its score value is added to throughput.
 * Rule 5 (controllers.ts) runs at the start of the tick: signals advance and grants are picked.
 * The gridlock detector (sum of v is 0 for 60 ticks) runs in sim.ts after the tick.
 */
import {
  BIKE_SHARED_VMAX,
  BUS_DWELL_TICKS,
  MAX_VEHICLE_LENGTH,
  VEHICLE_SPECS,
  VEHICLE_TYPE_COUNT,
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
import { opposite, route, Turn, weightedRoute, type Route, type World } from './world.js';
import { DEFAULT_SWITCH_TICKS } from './types.js';
import { chancePermille, type PrngState } from './prng.js';
import { VehicleType, type DemandProfile } from './types.js';

const NONE = -1;
/** Hot-loop copies of the vehicle table; bikes move at BIKE_SHARED_VMAX without bike lanes. */
export const VMAX = Uint8Array.from(VEHICLE_SPECS, (s, type) =>
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
  /**
   * Road lanes and pockets whose link ends at an intersection: that intersection and the side it
   * is entered from (the stop line `walk` reaches); -1 otherwise.
   */
  readonly laneEndIx: Int32Array;
  readonly laneEndSide: Int8Array;
  /** Per link: direction of travel entering its first tile (selects the box movement). */
  readonly linkEntryDir: Int8Array;
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
   * Stop lines per intersection: entries `[lineStart[ix], lineStart[ix + 1])` of `lineLane`, the
   * approach lanes and pockets whose last cell is one of its stop-line cells.
   */
  readonly lineStart: Int32Array;
  readonly lineLane: Int32Array;
  /**
   * Vehicles whose head is on a stop-line cell (`atLine` set), per intersection, for `grant`:
   * `headAt[lineStart[ix] .. lineStart[ix] + headCount[ix])`, unordered (grants do not depend on
   * order). `headSlot[i]` is vehicle `i`'s index in that range.
   */
  readonly headAt: Int32Array;
  readonly headCount: Int32Array;
  readonly headSlot: Int32Array;
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
  /**
   * Per demand event: origin and destination edge indices. A trip with no route to its
   * destination has `demandDest` replaced by the exit it diverts to (ADR-035).
   */
  readonly demandOrigin: Int32Array;
  readonly demandDest: Int32Array;
  /** Per demand event: 1 when the trip was diverted to another exit (ADR-035). */
  readonly demandDiverted: Uint8Array;
  /** Trips that spawned diverted to another exit this round (ADR-035). */
  diverted: number;
  /**
   * Per edge: trips that came due but can never enter, because no exit is reachable from the edge
   * for their type (ADR-035). They wait off the map for the rest of the round and do not hold up
   * the trips behind them.
   */
  readonly stuck: Int32Array;
  /** Per (type, origin): the route to the nearest reachable exit, once looked up (ADR-035). */
  readonly divertRoutes: Map<number, Route | null>;
  /** Per demand event: its route once looked up (`undefined` before), so a queued head is routed once. */
  readonly demandRoute: (Route | null | undefined)[];
  /** Per edge: demand indices waiting to spawn, FIFO. */
  readonly pending: number[][];
  readonly pendingHead: Int32Array;
  demandNext: number;
  spawned: number;
  exited: number;
  throughput: number;
  /** Sum of speeds after the last tick (the gridlock detector's input, P1-SIM-04). */
  speedSum: number;
  /**
   * Rule 3: per-mille chance that a moving vehicle slows by 1 this tick (NaSch p_slow), drawn
   * from `prng`, the round's PRNG. 0 draws nothing. Set by the sim from `DistrictRules` (P1-SIM-04);
   * `setPSlow` cards add to it from P1-SIM-05.
   */
  pSlowPermille: number;
  prng: PrngState | null;
  /**
   * Links closed for the round (`RoundInput.closedSegments`), or null. Routes avoid them; with
   * closures, BFS routes are cached here per round instead of in the shared world.
   */
  closed: Uint8Array | null;
  readonly closedRoutes: Map<number, Route | null>;
  // Card effects (P1-SIM-05, effects.ts, ADR-023). Null when no card needs them, so a round
  // without those cards pays nothing.
  /**
   * Links each vehicle type may not use (`[type]`): closures plus `banType` and the reserved lane
   * of a 1-lane link. Null entries fall back to `closed`.
   */
  readonly routeMask: (Uint8Array | null)[];
  /** Effective vmax per flat lane cell and type: `[flat * VEHICLE_TYPE_COUNT + type]`. */
  speedCap: Uint8Array | null;
  /** Bus dwell per flat lane cell (stop cells only). */
  dwellAt: Uint8Array | null;
  /** Per lane: bitmask of vehicle types allowed (`1 << type`); 0 = every type. */
  laneAllowed: Uint8Array | null;
  /** Per intersection: bitmask of preferred vehicle types (`preferType`, Bus Priority). */
  preferMask: Uint8Array | null;
  /** Score change per vehicle type on exit (`scoreModifier`). */
  readonly scoreDelta: Int32Array;
  /** Per link: toll index (`fundsModifier` with `per` on a segment), or -1. */
  tollOf: Int16Array | null;
  /** Vehicles that entered each toll's links. */
  tollCount: Int32Array | null;
}

/** Per-lane and stop-line tables: a pure function of the world, shared by every round on it. */
interface LaneTables {
  readonly laneCells: Int32Array;
  readonly laneLink: Int32Array;
  readonly laneTurn: Int32Array;
  readonly laneKind: Uint8Array;
  readonly laneIx: Int32Array;
  readonly laneEndIx: Int32Array;
  readonly laneEndSide: Int8Array;
  readonly linkEntryDir: Int8Array;
  readonly lineStart: Int32Array;
  readonly lineLane: Int32Array;
}

/** Cached per world (worlds are immutable and cached per map, sim.ts), never written by a round. */
const laneTablesCache = new WeakMap<World, LaneTables>();

function laneTables(world: World): LaneTables {
  const cached = laneTablesCache.get(world);
  if (cached) return cached;
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
  const laneEndIx = new Int32Array(lanes).fill(NONE);
  const laneEndSide = new Int8Array(lanes).fill(NONE);
  for (let i = 0; i < lanes; i++) {
    if (laneKind[i] === BOX) continue;
    const link = world.links[laneLink[i]!]!;
    if (link.to.kind !== 'intersection') continue;
    laneEndIx[i] = link.to.index;
    laneEndSide[i] = opposite(link.exitDirs[link.exitDirs.length - 1]!);
  }
  const linkEntryDir = Int8Array.from(world.links, (l) => l.entryDirs[0]!);
  const ixCount = world.intersections.length;
  const lineStart = new Int32Array(ixCount + 1);
  const lineLaneList: number[] = [];
  for (const node of world.intersections) {
    for (let s = 0; s < 4; s++) {
      const inLink = node.inLinks[s]!;
      if (inLink === NONE) continue;
      for (const lane of [...world.links[inLink]!.lanes, world.pocketLane[node.index * 4 + s]!]) {
        lineLaneList.push(lane);
      }
    }
    lineStart[node.index + 1] = lineLaneList.length;
  }
  const lineLane = Int32Array.from(lineLaneList);
  const tables: LaneTables = {
    laneCells,
    laneLink,
    laneTurn,
    laneKind,
    laneIx,
    laneEndIx,
    laneEndSide,
    linkEntryDir,
    lineStart,
    lineLane,
  };
  laneTablesCache.set(world, tables);
  return tables;
}

/**
 * Carves a round's typed arrays out of one ArrayBuffer. Each typed array over 64 bytes is a
 * separate off-heap allocation in V8 (about 1 µs each); one buffer for the ~35 per-round arrays
 * keeps that out of the per-round cost (P1-SIM-06). Views start 8-byte aligned.
 */
class Arena {
  private readonly buf: ArrayBuffer;
  private off = 0;
  constructor(bytes: number) {
    this.buf = new ArrayBuffer(bytes);
  }
  i32(n: number): Int32Array {
    const a = new Int32Array(this.buf, this.off, n);
    this.off += arenaBytes(n, 4);
    return a;
  }
  u8(n: number): Uint8Array {
    const a = new Uint8Array(this.buf, this.off, n);
    this.off += arenaBytes(n, 1);
    return a;
  }
}

function arenaBytes(n: number, size: number): number {
  return (n * size + 7) & ~7;
}

export function createTraffic(world: World, demand: DemandProfile): Traffic {
  const cap = demand.length;
  const ixCount = world.intersections.length;
  const links = world.links.length;
  const edges = world.edges.length;
  const tables = laneTables(world);
  // Must list exactly the arrays allocated from `a` below.
  const a = new Arena(
    arenaBytes(world.physCells, 4) +
      arenaBytes(links, 4) +
      5 * arenaBytes(ixCount, 4) +
      arenaBytes(tables.lineLane.length, 4) +
      8 * arenaBytes(ixCount, 1) +
      arenaBytes(ixCount * 4, 1) +
      11 * arenaBytes(cap, 4) +
      arenaBytes(cap * MAX_VEHICLE_LENGTH, 4) +
      4 * arenaBytes(cap, 1) +
      arenaBytes(edges, 4) +
      arenaBytes(VEHICLE_TYPE_COUNT, 4),
  );
  const demandOrigin = a.i32(cap);
  const demandDest = a.i32(cap);
  for (let d = 0; d < cap; d++) {
    demandOrigin[d] = world.edgeIndexById.get(demand[d]!.edge)!;
    demandDest[d] = world.edgeIndexById.get(demand[d]!.destinationEdge)!;
  }
  return {
    world,
    demand,
    occ: a.i32(world.physCells),
    linkLoad: a.i32(links),
    laneCells: tables.laneCells,
    laneLink: tables.laneLink,
    laneTurn: tables.laneTurn,
    laneKind: tables.laneKind,
    laneIx: tables.laneIx,
    laneEndIx: tables.laneEndIx,
    laneEndSide: tables.laneEndSide,
    linkEntryDir: tables.linkEntryDir,
    boxBase: world.laneCellBase[world.roadLanes]!,
    tick: 0,
    entryLog: null,
    ctrlKind: a.u8(ixCount),
    ctrlCapacity: a.u8(ixCount).fill(ROUNDABOUT_CAPACITY),
    ctrlAxis: a.u8(ixCount),
    sigPhase: a.u8(ixCount),
    sigTimer: a.i32(ixCount),
    sigClearing: a.u8(ixCount),
    sigAdaptive: a.u8(ixCount),
    sigSwitchTicks: a.u8(ixCount).fill(DEFAULT_SWITCH_TICKS),
    resolveTicks: a.u8(ixCount).fill(UNCONTROLLED_RESOLVE_TICKS),
    pocketMode: a.u8(ixCount * 4),
    granted: a.i32(ixCount).fill(NONE),
    boxCount: a.i32(ixCount),
    truckTurning: a.i32(ixCount),
    lineStart: tables.lineStart,
    lineLane: tables.lineLane,
    headAt: a.i32(tables.lineLane.length),
    headCount: a.i32(ixCount),
    headSlot: a.i32(cap),
    type: a.u8(cap),
    lane: a.i32(cap),
    cell: a.i32(cap),
    speed: a.u8(cap),
    laneIdx: a.u8(cap),
    step: a.i32(cap),
    routes: new Array<readonly number[]>(cap),
    dest: a.i32(cap),
    tail: a.i32(cap * MAX_VEHICLE_LENGTH).fill(NONE),
    dwell: a.u8(cap),
    served: a.i32(cap).fill(NONE),
    atLine: a.i32(cap).fill(NONE),
    count: 0,
    order: a.i32(cap),
    keys: a.i32(cap),
    orderLen: 0,
    demandOrigin,
    demandDest,
    demandDiverted: new Uint8Array(cap),
    diverted: 0,
    stuck: new Int32Array(edges),
    divertRoutes: new Map(),
    demandRoute: new Array<Route | null | undefined>(cap),
    pending: world.edges.map(() => []),
    pendingHead: a.i32(edges),
    demandNext: 0,
    spawned: 0,
    exited: 0,
    throughput: 0,
    speedSum: 0,
    pSlowPermille: 0,
    prng: null,
    closed: null,
    closedRoutes: new Map(),
    routeMask: new Array<Uint8Array | null>(VEHICLE_TYPE_COUNT).fill(null),
    speedCap: null,
    dwellAt: null,
    laneAllowed: null,
    preferMask: null,
    scoreDelta: a.i32(VEHICLE_TYPE_COUNT),
    tollOf: null,
    tollCount: null,
  };
}

/** True when vehicle type `vt` may drive in `lane` (reserved lanes, `reserveLane`). */
function laneOk(t: Traffic, lane: number, vt: number): boolean {
  const a = t.laneAllowed ? t.laneAllowed[lane]! : 0;
  return a === 0 || (a & (1 << vt)) !== 0;
}

/** Lane index on `lanes` closest to `idx` that type `vt` may use (searching outward), or -1. */
function allowedIndex(t: Traffic, lanes: readonly number[], idx: number, vt: number): number {
  if (laneOk(t, lanes[idx]!, vt)) return idx;
  for (let d = 1; d < lanes.length; d++) {
    if (idx + d < lanes.length && laneOk(t, lanes[idx + d]!, vt)) return idx + d;
    if (idx - d >= 0 && laneOk(t, lanes[idx - d]!, vt)) return idx - d;
  }
  return NONE;
}

/** Counts a vehicle entering link `link` for its toll, if any. */
function countToll(t: Traffic, link: number): void {
  const k = t.tollOf![link]!;
  if (k !== NONE) t.tollCount![k]!++;
}

// Walk cursor (module scratch; the sim is single-threaded and never re-enters a walk).
let wLane = 0;
let wCell = 0;
let wStep = 0;
let wIdx = 0;

/**
 * Advances the cursor past the last cell of its lane along vehicle `i`'s route `rt` (`gapAhead`
 * handles moves within a lane). Returns MOVED, EXIT (the next cell is the sink) or BLOCKED (the
 * stop line, and the controller says stop).
 */
function walk(t: Traffic, i: number, rt: readonly number[]): number {
  const w = t.world;
  const kind = t.laneKind[wLane]!;
  if (kind === BOX) {
    const next = w.links[rt[wStep + 1]!]!;
    const n = next.lanes.length;
    const turn = t.laneTurn[wLane]!;
    let idx = turn === Turn.Right ? 0 : turn === Turn.Left ? n - 1 : wIdx < n ? wIdx : n - 1;
    // Routes avoid links this type cannot use at all, so an allowed lane exists.
    if (t.laneAllowed) idx = allowedIndex(t, next.lanes, idx, t.type[i]!);
    wLane = next.lanes[idx]!;
    wCell = 0;
    wStep++;
    wIdx = idx;
    return MOVED;
  }
  // At the end of an approach lane or a turn pocket: the stop line.
  if (kind === ROAD && wStep + 1 >= rt.length) return EXIT;
  const ix = t.laneEndIx[wLane]!;
  const inSide = t.laneEndSide[wLane]!;
  const box = w.movementLane[ix * 16 + inSide * 4 + t.linkEntryDir[rt[wStep + 1]!]!]!;
  if (kind === ROAD) {
    const mode = t.pocketMode[ix * 4 + inSide]!;
    if (mode !== PocketMode.None) {
      const turn = t.laneTurn[box]!;
      if (turn === Turn.Left || (mode === PocketMode.Both && turn === Turn.Right)) {
        wLane = w.pocketLane[ix * 4 + inSide]!;
        wCell = 0;
        return MOVED;
      }
    }
  }
  if (!mayEnter(t, i, ix, inSide, box)) return BLOCKED;
  wLane = box;
  wCell = 0;
  return MOVED;
}

// The path `gapAhead` walked, replayed by `move` (module scratch; speed caps keep vmax <= 15):
// cursor state after each step, and the step at which the vehicle reaches the sink (or 0).
const pLane = new Int32Array(16);
const pCell = new Int32Array(16);
const pStep = new Int32Array(16);
const pIdx = new Int32Array(16);
const pPhys = new Int32Array(16);
let pExitAt = 0;

/** Rule 2: free cells ahead of vehicle `i`, up to `v`; records the path for `move`. */
function gapAhead(t: Traffic, i: number, v: number): number {
  const w = t.world;
  const rt = t.routes[i]!;
  const vt = t.type[i]!;
  const isBus = vt === VehicleType.Bus;
  const cap = t.speedCap;
  const { laneCells, occ } = t;
  const { laneCellBase, cellPhys } = w;
  // Cursor in locals; `walk` (link and box ends) works on the module cursor.
  let lane = t.lane[i]!;
  let cell = t.cell[i]!;
  let step = t.step[i]!;
  let idx = t.laneIdx[i]!;
  pExitAt = 0;
  for (let k = 1; k <= v; k++) {
    if (cell + 1 < laneCells[lane]!) {
      cell++;
    } else {
      wLane = lane;
      wCell = cell;
      wStep = step;
      wIdx = idx;
      const r = walk(t, i, rt);
      if (r === EXIT) {
        pExitAt = k;
        return k;
      }
      if (r === BLOCKED) return k - 1;
      lane = wLane;
      cell = wCell;
      step = wStep;
      idx = wIdx;
    }
    const flat = laneCellBase[lane]! + cell;
    const phys = cellPhys[flat]!;
    if (occ[phys] !== 0) return k - 1;
    // Speed limits: a vehicle never enters a cell whose limit for its type is below the number of
    // cells it has moved this tick, so it crosses a limited zone at that speed (ADR-023).
    if (cap && cap[flat * VEHICLE_TYPE_COUNT + vt]! < k) return k - 1;
    pLane[k] = lane;
    pCell[k] = cell;
    pStep[k] = step;
    pIdx[k] = idx;
    pPhys[k] = phys;
    if (isBus && w.stopCell[flat] === 1 && t.served[i] !== flat) return k;
  }
  return v;
}

function occupy(t: Traffic, i: number, phys: number): void {
  const tail = t.tail;
  const len = VEHICLE_LENGTH[t.type[i]!]!;
  const base = i * MAX_VEHICLE_LENGTH;
  const last = tail[base + len - 1]!;
  if (last !== NONE) release(t, last);
  for (let j = base + len - 1; j > base; j--) tail[j] = tail[j - 1]!;
  tail[base] = phys;
  t.occ[phys] = i + 1;
  const link = t.world.physLink[phys]!;
  if (link !== NONE) t.linkLoad[link]!++;
}

function release(t: Traffic, phys: number): void {
  t.occ[phys] = 0;
  const link = t.world.physLink[phys]!;
  if (link !== NONE) t.linkLoad[link]!--;
}

/** Vehicle `i`'s head arrived on a stop-line cell of intersection `ix`. */
function addHead(t: Traffic, i: number, ix: number): void {
  const slot = t.lineStart[ix]! + t.headCount[ix]!++;
  t.headAt[slot] = i;
  t.headSlot[i] = slot;
}

/** Vehicle `i`'s head left the stop-line cell of intersection `ix` (swap-remove). */
function removeHead(t: Traffic, i: number, ix: number): void {
  const last = t.lineStart[ix]! + --t.headCount[ix]!;
  const slot = t.headSlot[i]!;
  const moved = t.headAt[last]!;
  t.headAt[slot] = moved;
  t.headSlot[moved] = slot;
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
    maskFor(t, VehicleType.Taxi),
  );
  return rest ? [linkId, ...rest] : null;
}

/** Rules 4 and 6: moves vehicle `i` by `v` cells along the path `gapAhead` recorded. Returns false if it exited. */
function move(t: Traffic, i: number, v: number): boolean {
  const w = t.world;
  if (v === 0) {
    // Standing still changes nothing: `atLine` already matches the cell (it is reset whenever the
    // vehicle moves onto a cell that is not a stop line), except a bus spawned on a stop cell.
    if (t.type[i] === VehicleType.Bus) serveStop(t, i, w.laneCellBase[t.lane[i]!]! + t.cell[i]!);
    return true;
  }
  const isTaxi = t.type[i] === VehicleType.Taxi;
  let lane = t.lane[i]!;
  // Moving always leaves a stop-line cell (it is the last cell of its lane).
  if (t.atLine[i] !== NONE) removeHead(t, i, t.laneEndIx[lane]!);
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
      else if (t.tollOf && t.laneKind[next] === ROAD && t.laneLink[next] !== t.laneLink[lane])
        countToll(t, t.laneLink[next]!);
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
  const cell = pCell[v]!;
  t.lane[i] = lane;
  t.cell[i] = cell;
  t.step[i] = step;
  t.laneIdx[i] = pIdx[v]!;
  const flat = w.laneCellBase[lane]! + cell;
  if (w.lineCell[flat] === 0) {
    t.atLine[i] = NONE;
  } else {
    t.atLine[i] = t.tick;
    addHead(t, i, t.laneEndIx[lane]!);
  }
  if (t.type[i] === VehicleType.Bus) serveStop(t, i, flat);
  return true;
}

/** A bus on a stop cell it has not served yet starts its dwell there. */
function serveStop(t: Traffic, i: number, flat: number): void {
  if (t.world.stopCell[flat] === 1 && t.served[i] !== flat) {
    t.served[i] = flat;
    t.dwell[i] = t.dwellAt ? t.dwellAt[flat]! : BUS_DWELL_TICKS;
  }
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
  const vt = t.type[i]!;
  const score = VEHICLE_SPECS[vt]!.score + t.scoreDelta[vt]!;
  t.throughput += score > 0 ? score : 0;
}

/** Links vehicle type `vt` may not use this round, or null. */
function maskFor(t: Traffic, vt: number): Uint8Array | null {
  return t.routeMask[vt] ?? t.closed;
}

/** BFS route for a new trip of type `vt`, avoiding this round's closed and banned links. */
function routeFor(t: Traffic, vt: number, origin: number, destination: number): Route | null {
  const mask = maskFor(t, vt);
  if (!mask) return route(t.world, origin, destination);
  const e = t.world.edges.length;
  const key = (vt * e + origin) * e + destination;
  let r = t.closedRoutes.get(key);
  if (r === undefined) {
    r = route(t.world, origin, destination, mask);
    t.closedRoutes.set(key, r);
  }
  return r;
}

/**
 * ADR-035: the route from `origin` to the nearest exit type `vt` can reach this round (fewest
 * tiles, ties to the lower map edge id), for a trip whose own destination is unreachable. Null
 * when no exit is reachable, i.e. the trip cannot enter at all.
 */
function divertRoute(t: Traffic, vt: number, origin: number): Route | null {
  const edges = t.world.edges;
  const key = vt * edges.length + origin;
  let best = t.divertRoutes.get(key);
  if (best !== undefined) return best;
  best = null;
  for (let e = 0; e < edges.length; e++) {
    if (e === origin) continue;
    const r = routeFor(t, vt, origin, e);
    if (!r) continue;
    if (
      !best ||
      r.tiles < best.tiles ||
      (r.tiles === best.tiles && edges[e]!.id < edges[best.destination]!.id)
    )
      best = r;
  }
  t.divertRoutes.set(key, best);
  return best;
}

/** Spawns the head of each edge's queue while its spawn link has a free entry cell. */
function spawn(t: Traffic, tick: number): void {
  const w = t.world;
  while (t.demandNext < t.demand.length && t.demand[t.demandNext]!.tick <= tick) {
    t.pending[t.demandOrigin[t.demandNext]!]!.push(t.demandNext);
    t.demandNext++;
  }
  for (let edge = 0; edge < w.edges.length; edge++) {
    const queue = t.pending[edge]!;
    if (t.pendingHead[edge]! >= queue.length) continue;
    const spawnLink = w.links[w.edges[edge]!.spawnLink]!;
    while (t.pendingHead[edge]! < queue.length) {
      const d = queue[t.pendingHead[edge]!]!;
      const e = t.demand[d]!;
      let r = t.demandRoute[d];
      if (r === undefined) {
        r = routeFor(t, e.vehicleType, edge, t.demandDest[d]!);
        if (!r) {
          // ADR-035: no route to its destination (a one-way, a closure or a ban). The trip
          // diverts to the nearest exit it can reach, or, when none is, waits off the map.
          r = divertRoute(t, e.vehicleType, edge);
          if (r) {
            t.demandDest[d] = r.destination;
            t.demandDiverted[d] = 1;
          }
        }
        t.demandRoute[d] = r;
      }
      if (!r) {
        t.stuck[edge]!++;
        t.pendingHead[edge]!++;
        continue;
      }
      const dest = t.demandDest[d]!;
      let laneIdx = NONE;
      for (let k = 0; k < spawnLink.lanes.length; k++) {
        const l = spawnLink.lanes[k]!;
        if (t.occ[w.cellPhys[w.laneCellBase[l]!]!] === 0 && laneOk(t, l, e.vehicleType)) {
          laneIdx = k;
          break;
        }
      }
      if (laneIdx === NONE) break;
      t.pendingHead[edge]!++;
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
      if (t.tollOf) countToll(t, spawnLink.id);
      t.order[t.orderLen++] = i;
      t.spawned++;
      if (t.demandDiverted[d] === 1) t.diverted++;
    }
  }
}

/**
 * Per edge (in `world.edges` order, which is the map's edge order): trips that came due but have
 * not spawned, either queued behind an occupied entry cell or unable to enter at all (ADR-035).
 */
export function waitingPerEdge(t: Traffic): number[] {
  return t.pending.map((q, e) => q.length - t.pendingHead[e]! + t.stuck[e]!);
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
  const { order, speed, dwell, type, prng, atLine } = t;
  const movementLane = t.world.movementLane;
  const pSlow = prng ? t.pSlowPermille : 0;
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
    // Fast path for a vehicle waiting at a stop line (most vehicle-ticks in queues): its only way
    // forward is into the box, so when the controller says stop it stays put, exactly as
    // gapAhead/walk would decide. Approaches with a turn pocket take the full path.
    if (atLine[i] !== NONE) {
      const lane = t.lane[i]!;
      const ix = t.laneEndIx[lane]!;
      const side = t.laneEndSide[lane]!;
      if (t.laneKind[lane] === POCKET || t.pocketMode[ix * 4 + side] === PocketMode.None) {
        const next = t.routes[i]![t.step[i]! + 1]!;
        const box = movementLane[ix * 16 + side * 4 + t.linkEntryDir[next]!]!;
        if (!mayEnter(t, i, ix, side, box)) {
          speed[i] = 0;
          order[alive++] = i;
          continue;
        }
      }
    }
    const vt = type[i]!;
    const vmax = t.speedCap
      ? t.speedCap[(t.world.laneCellBase[t.lane[i]!]! + t.cell[i]!) * VEHICLE_TYPE_COUNT + vt]!
      : VMAX[vt]!;
    let v = speed[i]! + 1;
    if (v > vmax) v = vmax;
    v = gapAhead(t, i, v);
    // Rule 3: randomization. Only a vehicle that would move draws, so p_slow 0 (or a stopped
    // queue) consumes no randomness.
    if (v > 0 && pSlow > 0 && chancePermille(prng!, pSlow)) v--;
    if (move(t, i, v)) {
      speed[i] = v;
      speedSum += v;
      order[alive++] = i;
    }
  }
  t.orderLen = alive;
  t.speedSum = speedSum;
}
