import { describe, expect, it } from 'vitest';
import {
  ROUND_TICKS,
  Sim,
  VehicleType,
  buildWorld,
  closedLinkMask,
  emptyMap,
  latticeMap,
  route,
  sampleInput,
  type DemandEvent,
  type GridMap,
  type RoundInput,
  type SegmentId,
} from '../src/index.js';

const seg = (x1: number, y1: number, x2: number, y2: number): SegmentId => ({
  from: { x: x1, y: y1 },
  to: { x: x2, y: y2 },
});
const trip = (
  tick: number,
  edge: number,
  destinationEdge: number,
  vehicleType: VehicleType = VehicleType.Car,
): DemandEvent => ({ tick, edge, destinationEdge, vehicleType });

function input(map: GridMap, demand: DemandEvent[], closed?: SegmentId[]): RoundInput {
  const base = sampleInput(1);
  return {
    ...base,
    map,
    mapId: map.id,
    demandProfile: demand,
    ...(closed ? { closedSegments: closed } : {}),
  };
}

/** Runs the round and checks every tick that no vehicle is on a closed link. */
function runChecked(inp: RoundInput) {
  const world = buildWorld(inp.map);
  const mask = closedLinkMask(world, inp.closedSegments ?? []);
  let s = Sim.init(inp);
  while (!s.done) {
    s = Sim.step(s);
    const f = Sim.snapshot(s);
    for (let k = 0; k < f[1]!; k++) {
      const link = world.lanes[f[2 + k * 5 + 1]!]!.link;
      if (mask && world.lanes[f[2 + k * 5 + 1]!]!.kind === 'road' && mask[link]) {
        throw new Error(`vehicle on closed link ${link}`);
      }
    }
  }
  return Sim.result(s);
}

// Lattice edges: 0 = n of col 1, 1 = s of col 1, 2 = n of col 5, 3 = s of col 5,
// 4 = w of row 2, 5 = e of row 2, 6 = w of row 6, 7 = e of row 6.
const lattice = latticeMap('closed-lattice', [1, 5], [2, 6]);

describe('closedSegments (Parade boss)', () => {
  it('closes every link holding a closed tile, in both directions', () => {
    const w = buildWorld(lattice);
    const mask = closedLinkMask(w, [seg(1, 3, 1, 5)])!;
    const closed = w.links.filter((l) => mask[l.id]);
    expect(closed).toHaveLength(2);
    expect(closed[0]!.reverse).toBe(closed[1]!.id);
    expect(closedLinkMask(w, [])).toBeNull();
  });

  it('routes around a closure and the trip still exits', () => {
    const w = buildWorld(lattice);
    const mask = closedLinkMask(w, [seg(1, 3, 1, 5)])!;
    const open = route(w, 0, 1)!;
    const around = route(w, 0, 1, mask)!;
    expect(around.links.some((l) => mask[l])).toBe(false);
    expect(around.tiles).toBeGreaterThan(open.tiles);
    const demand = [trip(0, 0, 1), trip(5, 0, 1, VehicleType.Taxi), trip(10, 1, 0)];
    const before = runChecked(input(lattice, demand));
    const after = runChecked(input(lattice, demand, [seg(1, 3, 1, 5)]));
    expect(after.exited).toBe(3);
    expect(after.finalHash).not.toBe(before.finalHash);
  });

  it('a trip cut off from its destination diverts; one that cannot enter waits (ADR-035)', () => {
    // Plus map: closing the north arm cuts edge 0 (n) off entirely.
    const plus = emptyMap();
    const demand = [trip(0, 0, 2), trip(0, 1, 3), trip(1, 3, 0), trip(2, 2, 1)];
    const r = runChecked(input(plus, demand, [seg(3, 1, 3, 2)]));
    // 0 -> 2 cannot enter at all and waits at edge 0; 3 -> 0 diverts to another exit and scores.
    expect(r.spawned).toBe(3);
    expect(r.exited).toBe(3);
    expect(r.diverted).toBe(1);
    expect(r.waiting).toEqual([1, 0, 0, 0]);
    expect(r.ticks).toBe(ROUND_TICKS);
  });

  it('dense rounds with a closure keep every vehicle off it', () => {
    for (let seed = 0; seed < 10; seed++) {
      const d = sampleInput(seed);
      const inp = { ...input(lattice, [], [seg(5, 3, 5, 5)]), seed: d.seed };
      const demand: DemandEvent[] = [];
      for (let k = 0; k < 60; k++) {
        const e = (seed + k) % 8;
        demand.push(trip((k * 5) % ROUND_TICKS, e, (e + 1 + (k % 7)) % 8, (k % 6) as VehicleType));
      }
      demand.sort((a, b) => a.tick - b.tick || a.edge - b.edge);
      const r = runChecked({ ...inp, demandProfile: demand });
      expect(r.exited).toBeLessThanOrEqual(r.spawned);
    }
  });

  it('rejects closures on intersections, blocks, diagonals or out of bounds', () => {
    for (const bad of [seg(1, 2, 1, 3), seg(0, 0, 0, 1), seg(1, 3, 2, 4), seg(1, 7, 1, 9)]) {
      expect(() => Sim.init(input(lattice, [], [bad]))).toThrow(RangeError);
    }
  });

  it('an empty list hashes like no field; a closure changes the input digest', () => {
    const a = Sim.simulate(input(lattice, []));
    expect(Sim.simulate(input(lattice, [], [])).finalHash).toBe(a.finalHash);
    expect(Sim.simulate(input(lattice, [], [seg(1, 3, 1, 5)])).finalHash).not.toBe(a.finalHash);
  });
});
