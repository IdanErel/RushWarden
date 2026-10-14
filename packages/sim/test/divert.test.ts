import { describe, expect, it } from 'vitest';
import {
  Sim,
  VehicleType,
  emptyMap,
  sampleInput,
  type DemandEvent,
  type Placement,
  type RoundInput,
  type SegmentId,
} from '../src/index.js';
import type { Traffic } from '../src/traffic.js';

// ADR-035: a trip with no route to its destination diverts to the nearest reachable exit; a trip
// that can reach no exit at all waits off the map without holding up the trips behind it.

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

/** Plus map (edges 0 n, 1 e, 2 s, 3 w) with the given demand, closures and placements. */
function plus(demand: DemandEvent[], closed: SegmentId[] = [], placements: Placement[] = []) {
  const map = emptyMap();
  const input: RoundInput = {
    ...sampleInput(1),
    map,
    mapId: map.id,
    demandProfile: demand,
    placements,
    ...(closed.length > 0 ? { closedSegments: closed } : {}),
  };
  return input;
}

/** Runs the round and returns the result plus each trip's final destination edge index. */
function run(input: RoundInput) {
  let s = Sim.init(input);
  while (!s.done) s = Sim.step(s);
  const t = (s as unknown as { traffic: Traffic }).traffic;
  return { result: Sim.result(s), dest: Array.from(t.demandDest) };
}

/** The north arm of the plus map, closed: edge 0 can be neither entered nor reached. */
const NORTH = seg(3, 1, 3, 2);

describe('trips without a route (ADR-035)', () => {
  it('diverts to the nearest reachable exit and scores there', () => {
    // From the west, the east exit is 7 tiles away and the south one 8: east wins.
    const { result, dest } = run(plus([trip(0, 3, 0)], [NORTH]));
    expect(dest).toEqual([1]);
    expect(result).toMatchObject({ spawned: 1, exited: 1, diverted: 1, waiting: [0, 0, 0, 0] });
    expect(result.throughput).toBeGreaterThan(0);
  });

  it('breaks a tie between equally near exits by the lower edge id', () => {
    // From the south, east and west are equally near: east (id 1) wins over west (id 3).
    const { dest } = run(plus([trip(0, 2, 0)], [NORTH]));
    expect(dest).toEqual([1]);
  });

  it('a trip that cannot enter waits at its edge and does not block the queue behind it', () => {
    // Trucks are banned from the north arm, so a truck from edge 0 can reach no exit. The car
    // queued behind it on the same edge still spawns and arrives.
    const ban: Placement = {
      cardId: 'test-ban',
      tier: 1,
      order: 0,
      target: { kind: 'segment', from: { x: 3, y: 0 }, to: { x: 3, y: 3 } },
      effects: [{ kind: 'banType', vehicleType: VehicleType.Truck }],
    };
    const { result } = run(plus([trip(0, 0, 2, VehicleType.Truck), trip(1, 0, 2)], [], [ban]));
    expect(result).toMatchObject({ spawned: 1, exited: 1, diverted: 0, waiting: [1, 0, 0, 0] });
  });

  it('counts trips still queued behind an occupied entry cell as waiting', () => {
    // p_slow 1000 holds the first car on the entry cell, so the nine due after it stay queued.
    const input = plus(Array.from({ length: 10 }, (_, k) => trip(290 + k, 3, 1)));
    const r = Sim.simulate({
      ...input,
      districtRules: { ...input.districtRules, pSlowPermille: 1000 },
    });
    expect(r).toMatchObject({ spawned: 1, diverted: 0, waiting: [0, 0, 0, 9] });
  });

  it('leaves rounds where every trip has a route exactly as before', () => {
    const input = plus([trip(0, 3, 1), trip(5, 0, 2)]);
    const r = Sim.simulate(input);
    expect(r).toMatchObject({ diverted: 0, waiting: [0, 0, 0, 0], exited: 2 });
  });
});
