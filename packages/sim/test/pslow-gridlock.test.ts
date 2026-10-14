import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  GRID_WIDTH,
  GRIDLOCK_TICKS,
  ROUND_TICKS,
  Sim,
  buildWorld,
  createPrng,
  denseInput,
  emptyMap,
  sampleInput,
  type DemandEvent,
  type RoundInput,
} from '../src/index.js';
import { createTraffic, tickTraffic } from '../src/traffic.js';

/** A plus-map round with the given demand and p_slow. */
function round(demand: DemandEvent[], pSlowPermille: number, seed = 1): RoundInput {
  const base = sampleInput(seed);
  return {
    ...base,
    seed,
    demandProfile: demand,
    districtRules: { ...base.districtRules, pSlowPermille },
  };
}
const car = (tick: number, edge = 0, destinationEdge = 2): DemandEvent => ({
  tick,
  edge,
  destinationEdge,
  vehicleType: 0,
});

/** Head speed of vehicle 0 after each tick, until it exits or the round ends. */
function speeds(input: RoundInput): number[] {
  let s = Sim.init(input);
  const out: number[] = [];
  while (!s.done) {
    s = Sim.step(s);
    const f = Sim.snapshot(s);
    if (f[1] === 0) break;
    out.push(f[2 + 3]!);
  }
  return out;
}

describe('rule 3: p_slow from the round PRNG', () => {
  it('p_slow 0 draws nothing from the PRNG', () => {
    const t = createTraffic(buildWorld(emptyMap()), [car(0), car(3, 1, 3)]);
    const prng = createPrng(9);
    const before = Array.from(prng.s);
    t.prng = prng;
    t.pSlowPermille = 0;
    for (let tick = 0; tick < ROUND_TICKS; tick++) tickTraffic(t, tick);
    expect(Array.from(prng.s)).toEqual(before);
    expect(t.exited).toBe(2);
  });

  it('p_slow 1000 slows every moving vehicle by 1, so a car starting at rest never moves', () => {
    expect(speeds(round([car(0)], 1000)).slice(0, 10)).toEqual(Array<number>(10).fill(0));
  });

  it('p_slow 500 slows a lone car on some ticks, reproducibly per seed', () => {
    const free = speeds(round([car(0)], 0));
    const a = speeds(round([car(0)], 500, 7));
    expect(speeds(round([car(0)], 500, 7))).toEqual(a);
    expect(a.length).toBeGreaterThan(free.length);
    for (let k = 1; k < a.length; k++) expect(a[k]!).toBeLessThanOrEqual(a[k - 1]! + 1);
    const seeds = [1, 2, 3, 4, 5].map((seed) => speeds(round([car(0)], 500, seed)).join());
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  it('rejects p_slow outside 0..1000 or not an integer', () => {
    for (const bad of [-1, 1001, 0.5]) expect(() => Sim.init(round([], bad))).toThrow(RangeError);
  });

  it('property: dense rounds with any p_slow are deterministic and never exit more than spawned', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 32 - 1 }),
        fc.integer({ min: 0, max: 1000 }),
        (seed, pSlow) => {
          const d = denseInput(seed);
          const input = { ...d, districtRules: { ...d.districtRules, pSlowPermille: pSlow } };
          const a = Sim.simulate(input);
          expect(Sim.simulate(input)).toEqual(a);
          expect(a.exited).toBeLessThanOrEqual(a.spawned);
          if (a.gridlocked) {
            expect(a.ticks).toBeGreaterThanOrEqual(GRIDLOCK_TICKS);
            expect(a.ticks).toBeLessThanOrEqual(ROUND_TICKS);
          } else expect(a.ticks).toBe(ROUND_TICKS);
        },
      ),
      { numRuns: 30 },
    );
  });
});

describe('gridlock detector', () => {
  it(`ends the round after ${GRIDLOCK_TICKS} ticks with no exit and no junction entry`, () => {
    const r = Sim.simulate(round([car(0)], 1000));
    expect(r.gridlocked).toBe(true);
    expect(r.ticks).toBe(GRIDLOCK_TICKS);
    expect(r.exited).toBe(0);
  });

  it('counts only ticks with vehicles on the map', () => {
    // No vehicle until tick 100: the empty ticks before it do not count toward gridlock.
    const r = Sim.simulate(round([car(100)], 1000));
    expect(r.gridlocked).toBe(true);
    expect(r.ticks).toBe(100 + GRIDLOCK_TICKS);
    const empty = Sim.simulate(round([], 0));
    expect(empty.gridlocked).toBe(false);
    expect(empty.ticks).toBe(ROUND_TICKS);
  });

  it('a vehicle spawning during a stall does not reset the window; free traffic never stalls', () => {
    // p_slow 1000 holds every vehicle at 0. A second car spawned before the window closes is held
    // too and makes no progress, so the window is counted per tick, not per vehicle.
    const r = Sim.simulate(round([car(0), car(30, 1, 3)], 1000));
    expect(r.ticks).toBe(GRIDLOCK_TICKS);
    // Free-flowing traffic never stalls.
    const free = Sim.simulate(round([car(0), car(30, 1, 3)], 0));
    expect(free.gridlocked).toBe(false);
    expect(free.exited).toBe(2);
  });

  /**
   * The plus map with a bus stop on the north arm, before the junction, and a bus that dwells
   * `dwellTicks` there; cars follow from the same edge every 20 ticks and queue behind it.
   */
  function busStopQueue(dwellTicks: number): RoundInput {
    const base = emptyMap();
    const tiles = base.tiles.slice();
    tiles[1 * GRID_WIDTH + 3] = { kind: 'road', lanes: 1, busStop: true };
    const demand: DemandEvent[] = [{ tick: 0, edge: 0, destinationEdge: 2, vehicleType: 2 }];
    for (let k = 1; k <= 8; k++) demand.push(car(k * 20));
    return {
      ...round(demand, 0),
      map: { ...base, tiles },
      placements: [
        {
          cardId: 'test-dwell',
          tier: 1,
          order: 0,
          target: { kind: 'segment', from: { x: 3, y: 0 }, to: { x: 3, y: 3 } },
          effects: [{ kind: 'setBusStopDwell', dwellTicks }],
        },
      ],
    };
  }

  it('movement on a spawn road does not reset the window (ADR-033)', () => {
    // The bus blocks the arm for 255 ticks. Each new car drives up the spawn road to the queue, so
    // the sum of v is above 0 on some ticks, but nothing exits or enters the junction.
    let s = Sim.init(busStopQueue(255));
    const moving: number[] = [];
    while (!s.done) {
      s = Sim.step(s);
      const f = Sim.snapshot(s);
      let sum = 0;
      for (let o = 2 + 3; o < f.length; o += 5) sum += f[o]!;
      if (sum > 0) moving.push(f[0]!);
    }
    const r = Sim.result(s);
    expect(r.gridlocked).toBe(true);
    expect(r.ticks).toBe(GRIDLOCK_TICKS);
    expect(r.exited).toBe(0);
    // Under the pre-ADR-033 rule (sum of v is 0) these ticks reset the window.
    expect(moving.filter((k) => k > 20).length).toBeGreaterThan(0);
  });

  it('a junction entry resets the window', () => {
    // The same queue with a 40-tick dwell: the bus enters the junction before the window closes,
    // the cars follow it, and the round runs to the end with every vehicle out.
    const r = Sim.simulate(busStopQueue(40));
    expect(r.gridlocked).toBe(false);
    expect(r.ticks).toBe(ROUND_TICKS);
    expect(r.exited).toBe(9);
  });

  it('stepping stops at gridlock, the result reports it, and simulate gives the same hash', () => {
    let s = Sim.init(round([car(0)], 1000));
    let n = 0;
    while (!s.done) {
      s = Sim.step(s);
      n++;
    }
    expect(n).toBe(GRIDLOCK_TICKS);
    expect(Sim.step(s)).toBe(s);
    expect(Sim.result(s).gridlocked).toBe(true);
    expect(Sim.result(s).finalHash).toBe(Sim.simulate(round([car(0)], 1000)).finalHash);
  });
});
