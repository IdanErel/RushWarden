import { createPrng, nextInt } from './prng.js';
import {
  GRID_HEIGHT,
  GRID_WIDTH,
  ROUND_TICKS,
  VehicleType,
  type DemandEvent,
  type Effect,
  type Placement,
  type Target,
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

const ix = (x: number, y: number): Target => ({ kind: 'intersection', tile: { x, y } });
const seg = (x1: number, y1: number, x2: number, y2: number): Target => ({
  kind: 'segment',
  from: { x: x1, y: y1 },
  to: { x: x2, y: y2 },
});
const edge = (e: number): Target => ({ kind: 'edge', edge: e });
const district: Target = { kind: 'district' };
const { Car, Taxi, Bus, Truck, Bike } = VehicleType;

/**
 * The 20 Phase 1 cards (docs/tasks/phase-1.md) at tier 1 and tier 2 as the sim sees them, each
 * with a valid target on `latticeMap('...', [1, 5], [2, 6])`. Mirrors packages/content/cards;
 * used by tests and the golden suite (Detour tier 2 picks edge 6).
 */
export const PHASE1_CARDS: readonly (readonly [
  string,
  Target,
  readonly Effect[],
  readonly Effect[],
])[] = [
  [
    'smart-signal',
    ix(1, 2),
    [
      { kind: 'setController', controller: 'signal' },
      { kind: 'setSignalPhase', mode: 'adaptive' },
    ],
    [
      { kind: 'setController', controller: 'signal' },
      { kind: 'setSignalPhase', mode: 'adaptive', switchTicksDelta: -2 },
    ],
  ],
  [
    'one-way',
    seg(5, 3, 5, 5),
    [{ kind: 'setOneWay', doubleLanes: true }],
    [{ kind: 'setOneWay', doubleLanes: true }],
  ],
  [
    'turn-lane',
    ix(5, 2),
    [{ kind: 'addTurnLane', turns: 'left' }],
    [{ kind: 'addTurnLane', turns: 'both' }],
  ],
  [
    'speed-limit-up',
    seg(2, 6, 4, 6),
    [{ kind: 'setSpeedLimit', delta: 1, types: [Car, Taxi, Bus, VehicleType.Emergency, Bike] }],
    [{ kind: 'setSpeedLimit', delta: 1 }],
  ],
  [
    'bus-priority',
    ix(1, 6),
    [{ kind: 'preferType', vehicleType: Bus }],
    [{ kind: 'preferType', vehicleType: Bus, alsoTypes: [Taxi] }],
  ],
  [
    'express-stop',
    seg(1, 3, 1, 5),
    [{ kind: 'setBusStopDwell', dwellTicks: 2 }],
    [{ kind: 'setBusStopDwell', dwellTicks: 1 }],
  ],
  [
    'bus-lane',
    seg(2, 2, 4, 2),
    [{ kind: 'reserveLane', vehicleTypes: [Bus, Bike] }],
    [
      { kind: 'reserveLane', vehicleTypes: [Bus, Bike] },
      { kind: 'setSpeedLimit', delta: 1, max: 2, types: [Bike] },
    ],
  ],
  [
    'fare-holiday',
    district,
    [
      { kind: 'spawnModifier', vehicleType: Bus, percent: 40 },
      { kind: 'spawnModifier', vehicleType: Bike, percent: 40 },
      { kind: 'spawnModifier', vehicleType: Car, percent: -20 },
    ],
    [
      { kind: 'spawnModifier', vehicleType: Bus, percent: 60 },
      { kind: 'spawnModifier', vehicleType: Bike, percent: 60 },
      { kind: 'spawnModifier', vehicleType: Car, percent: -30 },
    ],
  ],
  [
    'detour',
    edge(4),
    [{ kind: 'reroute', percent: 50, to: 'adjacent' }],
    [{ kind: 'reroute', percent: 50, to: 'secondary' }],
  ],
  [
    'toll-booth',
    seg(5, 7, 5, 7),
    [
      { kind: 'setSpeedLimit', delta: 0, max: 1, cells: 2 },
      { kind: 'fundsModifier', delta: 1, per: 4 },
    ],
    [{ kind: 'fundsModifier', delta: 1, per: 4 }],
  ],
  [
    'staggered-hours',
    district,
    [{ kind: 'smoothDemand', peakPermille: 300 }],
    [{ kind: 'smoothDemand', peakPermille: 400 }],
  ],
  [
    'delivery-window',
    district,
    [{ kind: 'spawnWindow', vehicleType: Truck, fromTick: 0, toTick: 100 }],
    [
      { kind: 'spawnWindow', vehicleType: Truck, fromTick: 0, toTick: 100 },
      { kind: 'scoreModifier', vehicleType: Truck, delta: 1 },
    ],
  ],
  [
    'roundabout',
    ix(5, 6),
    [{ kind: 'setController', controller: 'roundabout', capacity: 4 }],
    [{ kind: 'setController', controller: 'roundabout', capacity: 6 }],
  ],
  [
    'yield-culture',
    district,
    [{ kind: 'yieldRule', fasterTicks: 1 }],
    [{ kind: 'yieldRule', fasterTicks: 2 }],
  ],
  [
    'no-heavy',
    seg(5, 3, 5, 5),
    [{ kind: 'banType', vehicleType: Truck }],
    [{ kind: 'banType', vehicleType: Truck, scope: 'target-class' }],
  ],
  [
    'remove-signal',
    ix(5, 2),
    [
      { kind: 'setController', controller: 'uncontrolled' },
      { kind: 'energyModifier', delta: 1, when: 'now', condition: 'replaced-signal' },
    ],
    [
      { kind: 'setController', controller: 'uncontrolled' },
      { kind: 'energyModifier', delta: 2, when: 'now', condition: 'replaced-signal' },
    ],
  ],
  [
    'overtime',
    district,
    [{ kind: 'energyModifier', delta: 1, when: 'next-round' }],
    [{ kind: 'energyModifier', delta: 2, when: 'next-round' }],
  ],
  [
    'second-shift',
    district,
    [{ kind: 'drawModifier', delta: 2 }],
    [
      { kind: 'drawModifier', delta: 2 },
      { kind: 'energyModifier', delta: 1, when: 'next-round' },
    ],
  ],
  [
    'pilot-program',
    district,
    [{ kind: 'costModifier', cards: 'all', next: 1, cost: 0 }],
    [{ kind: 'costModifier', cards: 'all', next: 2, cost: 0 }],
  ],
  ['recount', district, [{ kind: 'redraw', keep: 0 }], [{ kind: 'redraw', keep: 1 }]],
];

/** The map `PHASE1_CARDS` targets: 4 intersections at (1,2), (5,2), (1,6), (5,6), 8 edges. */
export const CARD_MAP = latticeMap('cards-4x', [1, 5], [2, 6]);

/**
 * A dense round on `CARD_MAP` with 1–4 Phase 1 cards (either tier) placed, derived from `seed`,
 * so the golden suite covers card effects, every controller kind and topology changes.
 */
export function cardInput(seed: number): RoundInput {
  const base = denseInput(seed);
  const p = createPrng(seed ^ 0x5eed);
  const demandProfile = base.demandProfile
    .map((d) => {
      const edge = d.edge % 8;
      return { ...d, edge, destinationEdge: (edge + 1 + nextInt(p, 7)) % 8 };
    })
    .sort((a, b) => a.tick - b.tick || a.edge - b.edge);
  const count = 1 + nextInt(p, 4);
  const placements: Placement[] = [];
  for (let k = 0; k < count; k++) {
    const [cardId, target, t1, t2] = PHASE1_CARDS[nextInt(p, PHASE1_CARDS.length)]!;
    const tier = nextInt(p, 2) === 0 ? 1 : 2;
    placements.push({
      cardId,
      tier,
      target,
      effects: tier === 1 ? t1 : t2,
      order: k,
      ...(cardId === 'detour' ? { secondaryTarget: edge(6) } : {}),
    });
  }
  return { ...base, map: CARD_MAP, mapId: CARD_MAP.id, demandProfile, placements };
}
