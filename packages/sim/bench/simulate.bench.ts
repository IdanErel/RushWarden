/**
 * Headless throughput benchmark for the GDD §3 / §6 budget: at least 2,000 full 300-tick rounds
 * per second on one core, with up to 150 vehicles. Run with `pnpm --filter @rushwarden/sim bench`.
 * Each bench is one `Sim.simulate` call on a prebuilt input, so `hz` is rounds per second.
 *
 * Two demand mixes: "sim-02" is the mix quoted in PR #23 (64% car, 9% taxi, 14% bus, 9% truck,
 * 5% bike); "reviewer" is the heavier mix the Reviewer measured (54/8/15/15/8). "cache miss"
 * gives every input its own GridMap object, as a worker `start` or a verifier request does, so
 * the per-map world cache never hits. SIM-06 owns the formal target and CI gate.
 */
import { bench, describe } from 'vitest';
import {
  Sim,
  createPrng,
  nextInt,
  sampleInput,
  type DemandEvent,
  type GridMap,
  type MapEdge,
  type MapTile,
  type RoundInput,
} from '../src/index.js';

const GRID_W = 7;
const GRID_H = 9;

/** A lattice of 1-lane roads along the given columns and rows, with one bus stop. */
function lattice(id: string, cols: number[], rows: number[]): GridMap {
  const tiles: MapTile[] = [];
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++)
      tiles.push(
        cols.includes(x) || rows.includes(y)
          ? { kind: 'road', lanes: 1, busStop: x === cols[0] && y === GRID_H >> 1 }
          : { kind: 'block' },
      );
  const edges: MapEdge[] = [];
  for (const x of cols) {
    edges.push({ id: edges.length, tile: { x, y: 0 }, side: 'n' });
    edges.push({ id: edges.length, tile: { x, y: GRID_H - 1 }, side: 's' });
  }
  for (const y of rows) {
    edges.push({ id: edges.length, tile: { x: 0, y }, side: 'w' });
    edges.push({ id: edges.length, tile: { x: GRID_W - 1, y }, side: 'e' });
  }
  return { id, tiles, edges };
}

/** Vehicle types by weight: 0 car, 1 taxi, 2 bus, 3 truck, 5 bike (no emergency off rush). */
const MIXES = {
  'sim-02': [
    ...Array<number>(64).fill(0),
    ...Array<number>(9).fill(1),
    ...Array<number>(14).fill(2),
    ...Array<number>(9).fill(3),
    ...Array<number>(5).fill(5),
  ],
  reviewer: [
    ...Array<number>(54).fill(0),
    ...Array<number>(8).fill(1),
    ...Array<number>(15).fill(2),
    ...Array<number>(15).fill(3),
    ...Array<number>(8).fill(5),
  ],
} as const;

function heavyInput(
  map: GridMap,
  seed: number,
  vehicles: number,
  mix: readonly number[],
  lastTick = 280,
): RoundInput {
  const p = createPrng(seed);
  const n = map.edges.length;
  const demand: DemandEvent[] = [];
  for (let i = 0; i < vehicles; i++) {
    const edge = nextInt(p, n);
    let to = nextInt(p, n - 1);
    if (to >= edge) to++;
    const vehicleType = mix[nextInt(p, mix.length)] as DemandEvent['vehicleType'];
    demand.push({ tick: nextInt(p, lastTick + 1), edge, destinationEdge: to, vehicleType });
  }
  demand.sort((a, b) => a.tick - b.tick || a.edge - b.edge);
  return { ...sampleInput(seed), seed, map, mapId: map.id, demandProfile: demand };
}

const MAPS = {
  'D1-like, 4 intersections': lattice('bench-d1', [1, 5], [2, 6]),
  'lattice, 12 intersections': lattice('bench-12', [1, 3, 5], [1, 3, 5, 7]),
};
const INPUTS = 64;

for (const [mixName, mix] of Object.entries(MIXES)) {
  describe(`mix ${mixName}`, () => {
    for (const [mapName, map] of Object.entries(MAPS)) {
      for (const vehicles of [60, 150]) {
        const hit = Array.from({ length: INPUTS }, (_, i) => heavyInput(map, i, vehicles, mix));
        let k = 0;
        bench(`${mapName}, ${vehicles} vehicles`, () => {
          Sim.simulate(hit[k++ % INPUTS]!);
        });
      }
      const miss = Array.from({ length: INPUTS }, (_, i) => heavyInput(map, i, 150, mix));
      let m = 0;
      bench(`${mapName}, 150 vehicles, cache miss (includes a map clone)`, () => {
        const input = miss[m++ % INPUTS]!;
        Sim.simulate({ ...input, map: structuredClone(input.map) });
      });
    }
  });
}
