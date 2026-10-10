import { describe, expect, it } from 'vitest';
import {
  CARD_MAP,
  Sim,
  VehicleType,
  buildWorld,
  cardInput,
  denseInput,
  latticeMap,
} from '../src/index.js';

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

describe('fixtures: cardInput', () => {
  it('places 1–4 Phase 1 cards on CARD_MAP, deterministically, and the round runs', () => {
    for (let seed = 0; seed < 20; seed++) {
      const a = cardInput(seed);
      expect(cardInput(seed)).toEqual(a);
      expect(a.map).toBe(CARD_MAP);
      expect(a.placements.length).toBeGreaterThanOrEqual(1);
      expect(a.placements.length).toBeLessThanOrEqual(4);
      expect(a.demandProfile.every((d) => d.edge !== d.destinationEdge)).toBe(true);
      const r = Sim.simulate(a);
      expect(r.exited).toBeLessThanOrEqual(r.spawned);
    }
  });
});
