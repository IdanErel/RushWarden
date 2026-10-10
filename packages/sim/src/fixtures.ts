import { createPrng, nextInt } from './prng.js';
import {
  GRID_HEIGHT,
  GRID_WIDTH,
  ROUND_TICKS,
  VehicleType,
  type DemandEvent,
  type GridMap,
  type MapEdge,
  type MapTile,
  type RoundInput,
} from './types.js';

/**
 * A plus-shaped map with one intersection in the middle, used by tests and the golden suite
 * until content provides real templates.
 */
export function emptyMap(id = 'test-plus'): GridMap {
  const cx = 3;
  const cy = 4;
  const tiles: MapTile[] = [];
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      tiles.push(x === cx || y === cy ? { kind: 'road', lanes: 1 } : { kind: 'block' });
    }
  }
  return {
    id,
    tiles,
    edges: [
      { id: 0, tile: { x: cx, y: 0 }, side: 'n' },
      { id: 1, tile: { x: GRID_WIDTH - 1, y: cy }, side: 'e' },
      { id: 2, tile: { x: cx, y: GRID_HEIGHT - 1 }, side: 's' },
      { id: 3, tile: { x: 0, y: cy }, side: 'w' },
    ],
  };
}

/** A minimal valid round input derived deterministically from `seed`. */
export function sampleInput(seed: number): RoundInput {
  const map = emptyMap();
  const n = seed % 7;
  const demandProfile = Array.from({ length: n }, (_, i) => ({
    tick: (seed + i * 37) % 300,
    edge: i % 4,
    vehicleType: ((seed >>> i) % 6) as 0 | 1 | 2 | 3 | 4 | 5,
    destinationEdge: (i + 2) % 4,
  })).sort((a, b) => a.tick - b.tick || a.edge - b.edge);
  return {
    seed: seed >>> 0,
    mapId: map.id,
    map,
    demandProfile,
    placements: [],
    cardState: { runEffects: [] },
    districtRules: {
      district: 1,
      round: 1 + (seed % 12),
      rush: seed % 4 === 3,
      boss: null,
      quota: 26,
      pSlowPermille: 0,
    },
  };
}

/**
 * A lattice map: roads along the given columns and rows, crossing in intersections, with an edge
 * at both ends of every road. `rowLanes` sets the lanes per direction on the rows (2 makes them
 * arterials); columns have 1 lane. One bus stop on the first column. Used by the golden suite and
 * the benchmark until content provides real templates.
 */
export function latticeMap(
  id: string,
  cols: readonly number[],
  rows: readonly number[],
  rowLanes: 1 | 2 = 1,
): GridMap {
  const tiles: MapTile[] = [];
  const stopY = rows.includes(GRID_HEIGHT >> 1) ? (GRID_HEIGHT >> 1) - 1 : GRID_HEIGHT >> 1;
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      if (cols.includes(x))
        tiles.push({ kind: 'road', lanes: 1, busStop: x === cols[0] && y === stopY });
      else if (rows.includes(y)) tiles.push({ kind: 'road', lanes: rowLanes });
      else tiles.push({ kind: 'block' });
    }
  }
  const edges: MapEdge[] = [];
  for (const x of cols) {
    edges.push({ id: edges.length, tile: { x, y: 0 }, side: 'n' });
    edges.push({ id: edges.length, tile: { x, y: GRID_HEIGHT - 1 }, side: 's' });
  }
  for (const y of rows) {
    edges.push({ id: edges.length, tile: { x: 0, y }, side: 'w' });
    edges.push({ id: edges.length, tile: { x: GRID_WIDTH - 1, y }, side: 'e' });
  }
  return { id, tiles, edges };
}

/** The lattices `denseInput` picks from: 4, 6, 9 and 12 intersections; 1- and 2-lane rows. */
const DENSE_LAYOUTS: readonly (readonly [readonly number[], readonly number[], 1 | 2])[] = [
  [[1, 5], [2, 6], 1],
  [[1, 5], [1, 4, 7], 2],
  [[1, 3, 5], [2, 4, 6], 1],
  [[1, 3, 5], [1, 3, 5, 7], 2],
];
/** Vehicle-type weights out of 20: 11 car, 2 taxi, 3 bus, 2 truck, 2 bike (+1 emergency on rush). */
const DENSE_MIX: readonly VehicleType[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 5, 5,
];

/** p_slow per-mille values `denseInput` picks from. */
const DENSE_PSLOW: readonly number[] = [0, 0, 0, 0, 100, 200];

/**
 * A heavier round derived deterministically from `seed`: a lattice map and 50–150 vehicles of
 * every type spread over the round, so queues, contended boxes, taxi re-routes and multi-lane
 * spawns all occur, and a third of rounds use p_slow (100 or 200 per mille). Placements are
 * empty, so every intersection is uncontrolled.
 */
export function denseInput(seed: number): RoundInput {
  const base = sampleInput(seed);
  const p = createPrng(seed);
  const [cols, rows, rowLanes] = DENSE_LAYOUTS[nextInt(p, DENSE_LAYOUTS.length)]!;
  const map = latticeMap(`lattice-${cols.length}x${rows.length}-${rowLanes}`, cols, rows, rowLanes);
  const vehicles = 50 + nextInt(p, 101);
  const edgeCount = map.edges.length;
  const rush = base.districtRules.rush;
  const demandProfile: DemandEvent[] = [];
  for (let i = 0; i < vehicles; i++) {
    const edge = nextInt(p, edgeCount);
    let destinationEdge = nextInt(p, edgeCount - 1);
    if (destinationEdge >= edge) destinationEdge++;
    const roll = nextInt(p, rush ? DENSE_MIX.length + 1 : DENSE_MIX.length);
    const vehicleType = roll === DENSE_MIX.length ? VehicleType.Emergency : DENSE_MIX[roll]!;
    demandProfile.push({ tick: nextInt(p, ROUND_TICKS), edge, destinationEdge, vehicleType });
  }
  demandProfile.sort((a, b) => a.tick - b.tick || a.edge - b.edge);
  // Rule 3: a third of the rounds run with p_slow (Fog is +100, the Blackout boss +200).
  const pSlowPermille = DENSE_PSLOW[nextInt(p, DENSE_PSLOW.length)]!;
  return {
    ...base,
    mapId: map.id,
    map,
    demandProfile,
    districtRules: { ...base.districtRules, pSlowPermille },
  };
}
