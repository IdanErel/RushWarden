import { GRID_HEIGHT, GRID_WIDTH, type GridMap, type MapTile, type RoundInput } from './types.js';

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
