/**
 * Fake traffic for the renderer's tests and dev page while the real sim has no vehicles
 * (Phase 1, before P1-SIM-06). It mirrors the `Sim` tick API (`init`/`step`/`snapshot`) and emits
 * snapshots in the exact `Sim.snapshot` format, using the provisional `tileLaneId` numbering.
 *
 * It is NOT the GDD §3 model: just enough NaSch-style motion (accelerate, stop behind the next
 * vehicle, one vehicle per intersection at a time) to look like traffic. Deterministic from the
 * seed via the sim's PRNG, so screenshots and tests are reproducible. Delete when the sim spawns
 * vehicles.
 */
import {
  CELLS_PER_TILE,
  GRID_WIDTH,
  ROUND_TICKS,
  SNAPSHOT_HEADER,
  SNAPSHOT_STRIDE,
  VehicleType,
  createPrng,
  nextInt,
  type GridMap,
  type MapEdge,
  type PrngState,
  type Side,
} from '@rushwarden/sim';
import { OPPOSITE, SIDES, SIDE_VEC, isIntersection, isRoad, tileIndex } from './geometry.js';
import { tileLaneId } from './lanes.js';
import { VEHICLE_LENGTH } from './shapes.js';

/** Max speed in cells per tick, GDD §3. */
const VMAX: Readonly<Record<VehicleType, number>> = {
  [VehicleType.Car]: 3,
  [VehicleType.Taxi]: 3,
  [VehicleType.Bus]: 2,
  [VehicleType.Truck]: 2,
  [VehicleType.Emergency]: 4,
  [VehicleType.Bike]: 2,
};

/** Spawn mix in percent: District 1's (§5) plus taxis and emergency so every type shows. */
const MIX: readonly (readonly [VehicleType, number])[] = [
  [VehicleType.Car, 55],
  [VehicleType.Taxi, 10],
  [VehicleType.Bus, 12],
  [VehicleType.Truck, 10],
  [VehicleType.Bike, 8],
  [VehicleType.Emergency, 5],
];

export interface FakeTrafficOptions {
  /** Chance per edge per tick of trying to spawn, in per-mille. Default 150. */
  readonly spawnPermille?: number;
  /** Ticks before the round ends. Default ROUND_TICKS. */
  readonly ticks?: number;
}

interface RouteStep {
  readonly lane: number;
  readonly cell: number;
  /** Tile index, to lock intersections. */
  readonly tile: number;
  readonly inIntersection: boolean;
}

interface Vehicle {
  readonly id: number;
  readonly type: VehicleType;
  readonly len: number;
  readonly route: readonly RouteStep[];
  /** Index of the head in `route`. */
  pos: number;
  v: number;
}

export interface FakeTrafficState {
  tick: number;
  done: boolean;
  spawned: number;
  exited: number;
  readonly vehicles: Vehicle[];
  /** Route-step key → vehicle id. */
  readonly occupied: Map<number, number>;
  /** Intersection tile → vehicle id holding it. */
  readonly locks: Map<number, number>;
  readonly routes: ReadonlyMap<number, readonly (readonly RouteStep[])[]>;
  readonly prng: PrngState;
  readonly spawnPermille: number;
  readonly endTick: number;
  nextId: number;
}

const key = (s: RouteStep): number => s.lane * CELLS_PER_TILE + s.cell;

function dirBetween(ax: number, ay: number, bx: number, by: number): Side {
  if (bx > ax) return 'e';
  if (bx < ax) return 'w';
  return by > ay ? 's' : 'n';
}

/** BFS over road tiles from one edge tile to another; returns the tile path or null. */
function bfs(map: GridMap, from: MapEdge, to: MapEdge): { x: number; y: number }[] | null {
  const start = tileIndex(from.tile.x, from.tile.y);
  const goal = tileIndex(to.tile.x, to.tile.y);
  const prev = new Map<number, number>([[start, -1]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift() ?? -1;
    if (cur === goal) break;
    const cx = cur % GRID_WIDTH;
    const cy = Math.floor(cur / GRID_WIDTH);
    for (const side of SIDES) {
      const [dx, dy] = SIDE_VEC[side];
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isRoad(map, nx, ny)) continue;
      const n = tileIndex(nx, ny);
      if (prev.has(n)) continue;
      prev.set(n, cur);
      queue.push(n);
    }
  }
  if (!prev.has(goal)) return null;
  const path: { x: number; y: number }[] = [];
  for (let t = goal; t !== -1; t = prev.get(t) ?? -1)
    path.push({ x: t % GRID_WIDTH, y: Math.floor(t / GRID_WIDTH) });
  return path.reverse();
}

/** Route from `from` to `to` as lane cells, kerb lane, right-hand traffic. */
export function buildRoute(map: GridMap, from: MapEdge, to: MapEdge): RouteStep[] | null {
  if (from.id === to.id) return null;
  const path = bfs(map, from, to);
  if (!path) return null;
  const steps: RouteStep[] = [];
  for (let i = 0; i < path.length; i++) {
    const t = path[i];
    if (!t) continue;
    const prevT = path[i - 1];
    const nextT = path[i + 1];
    const dIn: Side = prevT ? dirBetween(prevT.x, prevT.y, t.x, t.y) : OPPOSITE[from.side];
    const dOut: Side = nextT ? dirBetween(t.x, t.y, nextT.x, nextT.y) : to.side;
    const tile = tileIndex(t.x, t.y);
    const inIntersection = isIntersection(map, t.x, t.y);
    for (let c = 0; c < CELLS_PER_TILE; c++) {
      // Turning tiles: first half on the entry lane, second half on the exit lane.
      const dir = dIn === dOut || c < CELLS_PER_TILE / 2 ? dIn : dOut;
      steps.push({ lane: tileLaneId(t.x, t.y, dir, 0), cell: c, tile, inIntersection });
    }
  }
  return steps;
}

function pickType(prng: PrngState): VehicleType {
  let r = nextInt(prng, 100);
  for (const [type, pct] of MIX) {
    if (r < pct) return type;
    r -= pct;
  }
  return VehicleType.Car;
}

export function init(map: GridMap, seed: number, opts: FakeTrafficOptions = {}): FakeTrafficState {
  const routes = new Map<number, RouteStep[][]>();
  for (const from of map.edges) {
    const list: RouteStep[][] = [];
    for (const to of map.edges) {
      const r = buildRoute(map, from, to);
      if (r) list.push(r);
    }
    routes.set(from.id, list);
  }
  return {
    tick: 0,
    done: false,
    spawned: 0,
    exited: 0,
    vehicles: [],
    occupied: new Map(),
    locks: new Map(),
    routes,
    prng: createPrng(seed >>> 0),
    spawnPermille: opts.spawnPermille ?? 150,
    endTick: opts.ticks ?? ROUND_TICKS,
    nextId: 1,
  };
}

function occupy(st: FakeTrafficState, v: Vehicle, set: boolean): void {
  for (let i = Math.max(0, v.pos - v.len + 1); i <= v.pos; i++) {
    const s = v.route[i];
    if (!s) continue;
    if (set) {
      st.occupied.set(key(s), v.id);
      if (s.inIntersection) st.locks.set(s.tile, v.id);
    } else {
      if (st.occupied.get(key(s)) === v.id) st.occupied.delete(key(s));
      if (st.locks.get(s.tile) === v.id) st.locks.delete(s.tile);
    }
  }
}

/** Advances one tick. Mutates and returns `st` (same ownership rule as `Sim.step`, ADR-002). */
export function step(st: FakeTrafficState): FakeTrafficState {
  if (st.done) return st;
  // Downstream first: furthest along its route moves first.
  st.vehicles.sort((a, b) => b.pos - a.pos || a.id - b.id);
  const keep: Vehicle[] = [];
  for (const v of st.vehicles) {
    occupy(st, v, false);
    v.v = Math.min(v.v + 1, VMAX[v.type]);
    let move = 0;
    let exits = false;
    while (move < v.v) {
      const next = v.route[v.pos + move + 1];
      if (!next) {
        exits = true;
        break;
      }
      const holder = st.occupied.get(key(next));
      if (holder !== undefined && holder !== v.id) break;
      const lock = st.locks.get(next.tile);
      if (next.inIntersection && lock !== undefined && lock !== v.id) break;
      move++;
    }
    if (exits) {
      st.exited++;
      continue;
    }
    v.v = move;
    v.pos += move;
    occupy(st, v, true);
    keep.push(v);
  }
  st.vehicles.length = 0;
  st.vehicles.push(...keep);
  // Spawns, in edge order.
  for (const edge of [...st.routes.keys()].sort((a, b) => a - b)) {
    if (nextInt(st.prng, 1000) >= st.spawnPermille) continue;
    const list = st.routes.get(edge) ?? [];
    if (list.length === 0) continue;
    const route = list[nextInt(st.prng, list.length)];
    const type = pickType(st.prng);
    const first = route?.[0];
    if (!route || !first || st.occupied.has(key(first))) continue;
    const v: Vehicle = { id: st.nextId, type, len: VEHICLE_LENGTH[type], route, pos: 0, v: 0 };
    st.nextId = st.nextId >= 0xffff ? 1 : st.nextId + 1;
    occupy(st, v, true);
    st.vehicles.push(v);
    st.spawned++;
  }
  st.tick++;
  if (st.tick >= st.endTick) st.done = true;
  return st;
}

/** Snapshot in the `Sim.snapshot` format: `[tick, count, ...(id, lane, cell, speed, type)]`. */
export function snapshot(st: FakeTrafficState): Uint16Array {
  const out = new Uint16Array(SNAPSHOT_HEADER + st.vehicles.length * SNAPSHOT_STRIDE);
  out[0] = st.tick;
  out[1] = st.vehicles.length;
  let o = SNAPSHOT_HEADER;
  for (const v of st.vehicles) {
    const s = v.route[v.pos];
    out[o] = v.id;
    out[o + 1] = s?.lane ?? 0;
    out[o + 2] = s?.cell ?? 0;
    out[o + 3] = v.v;
    out[o + 4] = v.type;
    o += SNAPSHOT_STRIDE;
  }
  return out;
}

export const FakeTraffic = { init, step, snapshot } as const;
