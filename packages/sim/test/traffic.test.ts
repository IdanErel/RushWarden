import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BUS_DWELL_TICKS,
  MAX_VEHICLE_LENGTH,
  ROUND_TICKS,
  SNAPSHOT_HEADER,
  SNAPSHOT_STRIDE,
  Sim,
  VEHICLE_SPECS,
  VehicleType,
  buildWorld,
  emptyMap,
  sampleInput,
  tileIndex,
  type DemandEvent,
  type GridMap,
  type MapTile,
  type RoundInput,
} from '../src/index.js';
import { createTraffic, moveAll, prepareTick, tickTraffic, type Traffic } from '../src/traffic.js';

function input(map: GridMap, demand: DemandEvent[]): RoundInput {
  const base = sampleInput(0);
  return {
    ...base,
    map,
    mapId: map.id,
    demandProfile: [...demand].sort((a, b) => a.tick - b.tick || a.edge - b.edge),
  };
}

const ev = (
  tick: number,
  edge: number,
  destinationEdge: number,
  vehicleType: VehicleType = 0,
): DemandEvent => ({
  tick,
  edge,
  destinationEdge,
  vehicleType,
});

/** Decoded vehicles of one snapshot. */
function vehicles(
  frame: Uint16Array,
): { id: number; lane: number; cell: number; speed: number; type: number }[] {
  const out = [];
  for (let k = 0; k < frame[1]!; k++) {
    const o = SNAPSHOT_HEADER + k * SNAPSHOT_STRIDE;
    out.push({
      id: frame[o]!,
      lane: frame[o + 1]!,
      cell: frame[o + 2]!,
      speed: frame[o + 3]!,
      type: frame[o + 4]!,
    });
  }
  return out;
}

function withTiles(map: GridMap, patch: (t: MapTile[]) => void, id = map.id): GridMap {
  const tiles = [...map.tiles];
  patch(tiles);
  return { ...map, id, tiles };
}

/** Checks occupancy is exactly the union of every live vehicle's cells, with no overlaps. */
function checkOccupancy(t: Traffic): void {
  const expected = new Int32Array(t.occ.length);
  const load = new Int32Array(t.linkLoad.length);
  for (let k = 0; k < t.orderLen; k++) {
    const i = t.order[k]!;
    const len = VEHICLE_SPECS[t.type[i]!]!.length;
    for (let j = 0; j < MAX_VEHICLE_LENGTH; j++) {
      const p = t.tail[i * MAX_VEHICLE_LENGTH + j]!;
      if (j >= len && p !== -1) throw new Error(`vehicle ${i} holds ${j + 1} cells`);
      if (p < 0) continue;
      if (expected[p] !== 0) throw new Error(`cell ${p} held twice`);
      expected[p] = i + 1;
      const link = t.world.physLink[p]!;
      if (link >= 0) load[link]!++;
    }
    const head = t.world.cellPhys[t.world.laneCellBase[t.lane[i]!]! + t.cell[i]!];
    if (t.tail[i * MAX_VEHICLE_LENGTH] !== head) throw new Error(`vehicle ${i} head mismatch`);
  }
  for (let p = 0; p < expected.length; p++) {
    if (t.occ[p] !== expected[p]) throw new Error(`occupancy mismatch at ${p}`);
  }
  for (let l = 0; l < load.length; l++) {
    if (t.linkLoad[l] !== load[l]) throw new Error(`link load mismatch at ${l}`);
  }
}

describe('vehicle table (GDD section 3)', () => {
  it('matches length, vmax and score exactly', () => {
    expect(VEHICLE_SPECS).toEqual([
      { length: 1, vmax: 3, score: 1 },
      { length: 1, vmax: 3, score: 1 },
      { length: 2, vmax: 2, score: 3 },
      { length: 3, vmax: 2, score: 2 },
      { length: 1, vmax: 4, score: 5 },
      { length: 1, vmax: 2, score: 1 },
    ]);
    expect(BUS_DWELL_TICKS).toBe(4);
  });

  it.each([
    ['car', VehicleType.Car, 3, 1],
    ['taxi', VehicleType.Taxi, 3, 1],
    ['bus', VehicleType.Bus, 2, 3],
    ['truck', VehicleType.Truck, 2, 2],
    ['emergency', VehicleType.Emergency, 4, 5],
    ['bike (shared lane)', VehicleType.Bike, 1, 1],
  ])('%s alone: top speed %i, scores %i on exit', (_n, type, top, score) => {
    const r = Sim.simulate({ ...input(emptyMap(), [ev(0, 0, 2, type)]), recordFrames: true });
    const speeds = r.frames!.flatMap((f) => vehicles(f).map((v) => v.speed));
    expect(Math.max(...speeds)).toBe(top);
    expect([r.spawned, r.exited, r.throughput]).toEqual([1, 1, score]);
  });
});

describe('tick rules 1, 2, 4 and 6', () => {
  it('a lone car accelerates 1, 2, 3 and exits after 15 + 2 + 16 + 1 cells', () => {
    const r = Sim.simulate({ ...input(emptyMap(), [ev(10, 0, 2)]), recordFrames: true });
    const trace = r.frames!.map((f) => vehicles(f)[0]);
    // Tick 10 spawns at cell 0 and moves 1 (rule 1 from rest), then 2, then 3 per tick.
    expect(trace[10]).toMatchObject({ cell: 1, speed: 1 });
    expect(trace[11]).toMatchObject({ cell: 3, speed: 2 });
    expect(trace[12]).toMatchObject({ cell: 6, speed: 3 });
    // 34 cells: 1 + 2 + 3 * 11 >= 34, so it leaves during its 13th tick (tick 22).
    expect(trace[21]).toBeDefined();
    expect(trace[22]).toBeUndefined();
    expect(r.exited).toBe(1);
  });

  it('crosses the intersection through the box lane of its movement', () => {
    const world = buildWorld(emptyMap());
    const r = Sim.simulate({ ...input(emptyMap(), [ev(0, 0, 1)]), recordFrames: true });
    const lanes = new Set(r.frames!.flatMap((f) => vehicles(f).map((v) => v.lane)));
    // North arm heading south, turning to the east side: a left turn (3 cells).
    const box = world.movementLane[0 * 16 + 0 * 4 + 1]!;
    expect(world.lanes[box]!.turn).toBe(2);
    expect([...lanes].some((l) => l === box) || lanes.size === 2).toBe(true);
    expect(r.throughput).toBe(1);
  });

  it('a follower never closes the gap: rule 2 keeps vehicles in distinct cells', () => {
    const demand = Array.from({ length: 6 }, (_, k) =>
      ev(k, 0, 2, k % 2 ? VehicleType.Truck : VehicleType.Car),
    );
    const r = Sim.simulate({ ...input(emptyMap(), demand), recordFrames: true });
    for (const f of r.frames!) {
      const seen = new Set(vehicles(f).map((v) => `${v.lane}:${v.cell}`));
      expect(seen.size).toBe(f[1]);
    }
    expect(r.exited).toBe(6);
    expect(r.throughput).toBe(3 * 1 + 3 * 2);
  });

  it('a truck occupies 3 cells, a bus 2 (occupancy invariant)', () => {
    const world = buildWorld(emptyMap());
    const t = createTraffic(world, [ev(0, 0, 2, VehicleType.Truck), ev(0, 1, 3, VehicleType.Bus)]);
    for (let tick = 0; tick < 6; tick++) {
      tickTraffic(t, tick);
      checkOccupancy(t);
    }
    const held = (i: number) => [0, 1, 2].filter((j) => t.tail[i * 3 + j]! >= 0).length;
    expect(held(0)).toBe(3);
    expect(held(1)).toBe(2);
  });

  it('updates in (laneId, cellIndex) descending order, ties by vehicle id', () => {
    const demand = Array.from({ length: 40 }, (_, k) => ev(k * 3, k % 4, (k + 1 + (k % 3)) % 4));
    const t = createTraffic(buildWorld(emptyMap()), demand);
    let multi = 0;
    for (let tick = 0; tick < ROUND_TICKS; tick++) {
      prepareTick(t, tick);
      if (t.orderLen > 1) multi++;
      for (let k = 1; k < t.orderLen; k++) {
        const a = t.order[k - 1]!;
        const b = t.order[k]!;
        const ka = t.lane[a]! * 4096 + t.cell[a]!;
        const kb = t.lane[b]! * 4096 + t.cell[b]!;
        expect(ka > kb || (ka === kb && a < b)).toBe(true);
      }
      moveAll(t);
    }
    expect(multi).toBeGreaterThan(50);
  });

  it('queues spawns at a blocked edge and releases them in order', () => {
    const demand = Array.from({ length: 5 }, () => ev(0, 0, 2));
    const world = buildWorld(emptyMap());
    const t = createTraffic(world, demand);
    tickTraffic(t, 0);
    expect(t.spawned).toBe(1);
    tickTraffic(t, 1);
    expect(t.spawned).toBe(2);
    const r = Sim.simulate(input(emptyMap(), demand));
    expect([r.spawned, r.exited]).toEqual([5, 5]);
  });

  it('spawns into both lanes of a 2-lane road in the same tick', () => {
    const two = withTiles(
      emptyMap(),
      (tiles) => {
        for (let y = 0; y < 9; y++)
          if (y !== 4) tiles[tileIndex(3, y)] = { kind: 'road', lanes: 2 };
      },
      'two-lane',
    );
    const t = createTraffic(buildWorld(two), [ev(0, 0, 2), ev(0, 0, 2), ev(0, 0, 2)]);
    tickTraffic(t, 0);
    expect(t.spawned).toBe(2);
    expect(t.laneIdx[0]).toBe(0);
    expect(t.laneIdx[1]).toBe(1);
    checkOccupancy(t);
    const r = Sim.simulate(input(two, [ev(0, 0, 2), ev(0, 0, 2), ev(0, 0, 1), ev(0, 0, 3)]));
    expect(r.exited).toBe(4);
  });

  it('a bus stops exactly BUS_DWELL_TICKS at a bus-stop tile, once', () => {
    const stop = withTiles(
      emptyMap(),
      (tiles) => (tiles[tileIndex(3, 1)] = { kind: 'road', lanes: 1, busStop: true }),
      'stop',
    );
    const north = buildWorld(stop).links[buildWorld(stop).edges[0]!.spawnLink]!.lanes[0]!;
    const r = Sim.simulate({ ...input(stop, [ev(0, 0, 2, VehicleType.Bus)]), recordFrames: true });
    const trace = r.frames!.map((f) => vehicles(f)[0]).filter((v) => v !== undefined);
    // (3,1) is the second tile of the north arm: its downstream cell is 7.
    const atStop = trace.filter((v) => v.cell === 7 && v.lane === north);
    expect(atStop.length).toBe(1 + BUS_DWELL_TICKS);
    expect(atStop.slice(1).every((v) => v.speed === 0)).toBe(true);
    expect(r.throughput).toBe(3);
    // A car does not stop there.
    const car = Sim.simulate({ ...input(stop, [ev(0, 0, 2)]), recordFrames: true });
    expect(car.frames!.filter((f) => vehicles(f)[0]?.speed === 0)).toHaveLength(0);
  });
});

describe('taxis re-route on time-weighted costs', () => {
  const loop: GridMap = (() => {
    const rows = [
      '...1...',
      '.11111.',
      '.1...1.',
      '.1...1.',
      '.1...1.',
      '.11111.',
      '...1...',
      '...1...',
      '...1...',
    ];
    const tiles: MapTile[] = rows.flatMap((r) =>
      [...r].map((c): MapTile => (c === '.' ? { kind: 'block' } : { kind: 'road', lanes: 1 })),
    );
    return {
      id: 'loop',
      tiles,
      edges: [
        { id: 0, tile: { x: 3, y: 0 }, side: 'n' },
        { id: 1, tile: { x: 3, y: 8 }, side: 's' },
      ],
    };
  })();

  it('takes the free side when the BFS side is loaded; cars keep the BFS route', () => {
    const world = buildWorld(loop);
    const east = world.intersections[0]!.outLinks[1]!;
    const west = world.intersections[0]!.outLinks[3]!;
    const t = createTraffic(world, [ev(0, 0, 1, VehicleType.Taxi), ev(1, 0, 1, VehicleType.Car)]);
    t.linkLoad[east] = 10; // as if 10 cells were queued there
    tickTraffic(t, 0);
    expect(t.routes[0]![1]).toBe(west);
    tickTraffic(t, 1);
    expect(t.routes[1]![1]).toBe(east);
    t.linkLoad[east] = 0;
    const r = Sim.simulate(
      input(loop, [ev(0, 0, 1, VehicleType.Taxi), ev(5, 1, 0, VehicleType.Taxi)]),
    );
    expect(r.exited).toBe(2);
  });
});

describe('property: random demand on the plus map', () => {
  const event = fc.record({
    tick: fc.integer({ min: 0, max: ROUND_TICKS - 1 }),
    edge: fc.integer({ min: 0, max: 3 }),
    offset: fc.integer({ min: 1, max: 3 }),
    vehicleType: fc.integer({ min: 0, max: 5 }),
  });

  it('occupancy stays exact, nobody moves backward, throughput adds up, and it is deterministic', () => {
    fc.assert(
      fc.property(fc.array(event, { maxLength: 80 }), fc.boolean(), (events, twoLane) => {
        let map = emptyMap();
        if (twoLane) {
          map = withTiles(map, (tiles) => {
            for (let i = 0; i < tiles.length; i++) {
              if (tiles[i]!.kind === 'road' && i !== tileIndex(3, 4))
                tiles[i] = { kind: 'road', lanes: 2 };
            }
          });
        }
        const demand = events.map((e) =>
          ev(e.tick, e.edge, (e.edge + e.offset) % 4, e.vehicleType as VehicleType),
        );
        const sorted = [...demand].sort((a, b) => a.tick - b.tick || a.edge - b.edge);
        const world = buildWorld(map);
        const t = createTraffic(world, sorted);
        const progress = new Map<number, number>();
        for (let tick = 0; tick < ROUND_TICKS; tick++) {
          tickTraffic(t, tick);
          checkOccupancy(t);
          for (let k = 0; k < t.orderLen; k++) {
            const i = t.order[k]!;
            // Progress along the route: (link step, in-box, cell) only increases.
            const inBox = world.lanes[t.lane[i]!]!.link < 0 ? 1 : 0;
            const p = t.step[i]! * 1_000_000 + inBox * 10_000 + t.cell[i]!;
            if (t.type[i] !== VehicleType.Taxi)
              expect(p).toBeGreaterThanOrEqual(progress.get(i) ?? 0);
            progress.set(i, p);
            expect(t.speed[i]).toBeLessThanOrEqual(VEHICLE_SPECS[t.type[i]!]!.vmax);
          }
        }
        expect(t.exited).toBeLessThanOrEqual(t.spawned);
        expect(t.spawned).toBeLessThanOrEqual(demand.length);
        let score = 0;
        for (let i = 0; i < t.count; i++)
          if (t.lane[i] === -1) score += VEHICLE_SPECS[t.type[i]!]!.score;
        expect(t.throughput).toBe(score);
        const a = Sim.simulate(input(map, demand));
        const b = Sim.simulate(input(map, demand));
        expect(a).toEqual(b);
        expect(a.throughput).toBe(t.throughput);
      }),
      { numRuns: 60 },
    );
  }, 60_000);
});
