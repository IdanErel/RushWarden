import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ROUND_TICKS, SNAPSHOT_HEADER, Sim, sampleInput } from '../src/index.js';

describe('Sim contract', () => {
  it('runs a full round of 300 ticks', () => {
    const r = Sim.simulate(sampleInput(1));
    expect(r.ticks).toBe(ROUND_TICKS);
    expect(r.finalHash).toMatch(/^[0-9a-f]{16}$/);
    expect(r.frames).toBeUndefined();
  });

  it('simulate equals stepping init to the end', () => {
    const input = sampleInput(5);
    let s = Sim.init(input);
    while (!s.done) s = Sim.step(s);
    expect(Sim.result(s)).toEqual(Sim.simulate(input));
    expect(Sim.step(s).tick).toBe(ROUND_TICKS);
  });

  it('records one snapshot per tick when asked', () => {
    const r = Sim.simulate({ ...sampleInput(3), recordFrames: true });
    expect(r.frames).toHaveLength(ROUND_TICKS);
    expect(r.frames![0]![0]).toBe(1);
    expect(r.frames![0]!.length).toBe(SNAPSHOT_HEADER);
    // Recording frames must not change the outcome.
    expect(r.finalHash).toBe(Sim.simulate(sampleInput(3)).finalHash);
  });

  it('rejects invalid input', () => {
    expect(() => Sim.simulate({ ...sampleInput(1), seed: -1 })).toThrow(RangeError);
    expect(() => Sim.simulate({ ...sampleInput(1), mapId: 'other' })).toThrow(RangeError);
    const bad = {
      ...sampleInput(1),
      demandProfile: [{ tick: 300, edge: 0, vehicleType: 0 as const, destinationEdge: 1 }],
    };
    expect(() => Sim.simulate(bad)).toThrow(RangeError);
  });

  it('property: same input, same hash; throughput never exceeds spawned score', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
        const a = Sim.simulate(sampleInput(seed));
        const b = Sim.simulate(sampleInput(seed));
        expect(a.finalHash).toBe(b.finalHash);
        expect(a.exited).toBeLessThanOrEqual(a.spawned);
      }),
      { numRuns: 200 },
    );
  });

  it('different seeds give different hashes', () => {
    const hashes = new Set(
      Array.from({ length: 50 }, (_, i) => Sim.simulate(sampleInput(i)).finalHash),
    );
    expect(hashes.size).toBe(50);
  });

  it('stateHash changes as the round advances', () => {
    let s = Sim.init(sampleInput(2));
    const h0 = Sim.stateHash(s);
    s = Sim.step(s);
    expect(Sim.stateHash(s)).not.toBe(h0);
  });
});
