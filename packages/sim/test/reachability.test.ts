import { describe, expect, it } from 'vitest';
import {
  VehicleType,
  cutRoutes,
  emptyMap,
  sampleInput,
  type Placement,
  type RoundInput,
} from '../src/index.js';

function plus(placements: Placement[] = []): RoundInput {
  const map = emptyMap();
  return { ...sampleInput(1), map, mapId: map.id, demandProfile: [], placements };
}
const card = (target: Placement['target'], effects: Placement['effects']): Placement => ({
  cardId: 'test',
  tier: 1,
  order: 0,
  target,
  effects,
});
const NORTH_ARM = { kind: 'segment', from: { x: 3, y: 3 }, to: { x: 3, y: 0 } } as const;
const TYPES = [0, 1, 2, 3, 4, 5];

describe('cutRoutes (ADR-035)', () => {
  it('a One-Way pointing out of the map on an entry road cuts every trip from that edge', () => {
    const r = cutRoutes(plus(), card(NORTH_ARM, [{ kind: 'setOneWay', doubleLanes: true }]))!;
    expect(r.entries).toEqual([0]);
    expect(r.exits).toEqual([1, 2, 3]);
    // Every type loses 0 -> 1, 2, 3; trips into edge 0 keep their route.
    expect(r.cuts).toHaveLength(TYPES.length * 3);
    expect(r.cuts.every((c) => c.from === 0)).toBe(true);
  });

  it('No Heavy on the only road cuts trucks only', () => {
    const ban = card({ kind: 'segment', from: { x: 3, y: 0 }, to: { x: 3, y: 3 } }, [
      { kind: 'banType', vehicleType: VehicleType.Truck },
    ]);
    const r = cutRoutes(plus(), ban)!;
    expect(new Set(r.cuts.map((c) => c.vehicleType))).toEqual(new Set([VehicleType.Truck]));
    expect(r.entries).toEqual([0]);
    expect(r.exits).toEqual([0, 1, 2, 3]);
  });

  it('counts only what the candidate adds to the placements already made', () => {
    const oneWay = card(NORTH_ARM, [{ kind: 'setOneWay', doubleLanes: true }]);
    const again = cutRoutes(plus([{ ...oneWay, order: 0 }]), { ...oneWay, order: 1 })!;
    expect(again.cuts).toEqual([]);
    // A placement that cuts nothing, such as a signal, reports nothing.
    const signal = card({ kind: 'intersection', tile: { x: 3, y: 4 } }, [
      { kind: 'setController', controller: 'signal' },
    ]);
    expect(cutRoutes(plus(), signal)).toEqual({ cuts: [], exits: [], entries: [] });
  });

  it('returns null for a placement that is not valid on the map', () => {
    const bad = card({ kind: 'intersection', tile: { x: 0, y: 0 } }, [
      { kind: 'setController', controller: 'signal' },
    ]);
    expect(cutRoutes(plus(), bad)).toBeNull();
  });
});
