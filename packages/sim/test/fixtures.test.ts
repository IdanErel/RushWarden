import { describe, expect, it } from 'vitest';
import { Sim, VehicleType, buildWorld, denseInput, latticeMap } from '../src/index.js';

describe('fixtures: latticeMap and denseInput', () => {
  it('latticeMap builds a valid world with one intersection per crossing', () => {
    const w = buildWorld(latticeMap('l', [1, 3, 5], [1, 3, 5, 7], 2));
    expect(w.intersections).toHaveLength(12);
    expect(w.edges).toHaveLength(14);
  });

  it('denseInput is deterministic, valid and dense, with emergencies only on rush rounds', () => {
    let rushEmergency = 0;
    for (let seed = 0; seed < 40; seed++) {
      const a = denseInput(seed);
      expect(denseInput(seed)).toEqual(a);
      expect(a.demandProfile.length).toBeGreaterThanOrEqual(50);
      expect(a.demandProfile.length).toBeLessThanOrEqual(150);
      const emergencies = a.demandProfile.filter((d) => d.vehicleType === VehicleType.Emergency);
      if (!a.districtRules.rush) expect(emergencies).toHaveLength(0);
      rushEmergency += emergencies.length;
      const r = Sim.simulate(a);
      expect(r.spawned).toBeGreaterThan(0);
      expect(r.exited).toBeLessThanOrEqual(r.spawned);
    }
    expect(rushEmergency).toBeGreaterThan(0);
  });
});
