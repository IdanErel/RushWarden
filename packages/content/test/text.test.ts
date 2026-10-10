import type { Effect, EffectKind } from '@rushwarden/sim';
import { VehicleType } from '@rushwarden/sim';
import { describe, expect, it } from 'vitest';
import { cardText, EFFECT_SCHEMAS, effectText, parseCard, type TargetKind } from '../src/index.js';
import { validCardJson } from './fixtures.js';

const { Car, Taxi, Bus, Truck, Emergency, Bike } = VehicleType;

// One row per template branch. The text must state exactly what the fields say.
const CASES: [Effect, TargetKind, string][] = [
  [{ kind: 'setController', controller: 'signal' }, 'intersection', 'Becomes a signal.'],
  [
    { kind: 'setController', controller: 'roundabout', capacity: 6 },
    'intersection',
    'Becomes a roundabout holding up to 6 vehicles.',
  ],
  [
    { kind: 'setController', controller: 'priority', direction: 'w' },
    'intersection',
    'Becomes a priority junction with right of way from the west.',
  ],
  [
    { kind: 'setController', controller: 'uncontrolled' },
    'intersection',
    'Becomes an uncontrolled junction.',
  ],
  [
    { kind: 'setController', controller: 'stop-all' },
    'district',
    'Every intersection becomes an all-way stop.',
  ],
  [
    { kind: 'setSignalPhase', mode: 'adaptive' },
    'intersection',
    'Signal is adaptive: the longest queue gets green.',
  ],
  [
    { kind: 'setSignalPhase', mode: 'adaptive', switchTicks: 1 },
    'intersection',
    'Signal is adaptive: the longest queue gets green. Phases switch in 1 tick.',
  ],
  [
    { kind: 'setSignalPhase', mode: 'wave' },
    'segment',
    'Signals along this segment share a green wave timed to the speed limit.',
  ],
  [
    { kind: 'setSignalPhase', mode: 'district-cycle' },
    'district',
    'All signals share one district-wide cycle.',
  ],
  [{ kind: 'setLaneCount', lanes: 2 }, 'segment', '2 lanes each way on this segment.'],
  [
    { kind: 'setLaneCount', lanes: 1, scope: 'ring' },
    'district',
    '1 lane each way on the ring road.',
  ],
  [
    { kind: 'setSpeedLimit', delta: 1 },
    'segment',
    '+1 top speed on this segment for all vehicles.',
  ],
  [
    { kind: 'setSpeedLimit', delta: 1, types: [Car, Taxi, Bus, Emergency, Bike] },
    'segment',
    '+1 top speed on this segment for all vehicles except trucks.',
  ],
  [
    { kind: 'setSpeedLimit', delta: -1, types: [Car] },
    'intersection',
    '−1 top speed on this intersection for cars.',
  ],
  [
    { kind: 'setSpeedLimit', delta: 2, types: [Bus, Bike] },
    'segment',
    '+2 top speed on this segment for buses and bikes.',
  ],
  [
    { kind: 'banType', vehicleType: Truck },
    'segment',
    'Trucks are banned from this segment and route around it.',
  ],
  [
    { kind: 'preferType', vehicleType: Bus },
    'intersection',
    'Buses get green on approach to this intersection.',
  ],
  [
    { kind: 'preferType', vehicleType: Bus, alsoTypes: [Taxi] },
    'district',
    'Buses and taxis get green on approach to every intersection.',
  ],
  [
    { kind: 'addBusStop', dwellTicks: 2 },
    'segment',
    'Bus stop on this segment: buses dwell 2 ticks.',
  ],
  [
    { kind: 'addBikeLane', bikeVmax: 3, carVmaxDelta: -1 },
    'segment',
    'Adds a bike lane on this segment: bikes top speed 3; cars −1 top speed.',
  ],
  [
    { kind: 'addBikeLane', bikeVmax: 3, carVmaxDelta: 0 },
    'segment',
    'Adds a bike lane on this segment: bikes top speed 3.',
  ],
  [
    { kind: 'setOneWay', direction: 'n', doubleLanes: true },
    'segment',
    'This segment becomes one-way heading north, with its lanes doubled that way.',
  ],
  [
    { kind: 'setOneWay', direction: 'e', doubleLanes: false },
    'segment',
    'This segment becomes one-way heading east.',
  ],
  [
    { kind: 'reroute', percent: 50, toEdge: 3 },
    'edge',
    '50% of spawns from this edge reroute to edge 3.',
  ],
  [
    { kind: 'reroute', percent: 25, vehicleTypes: [Car] },
    'district',
    '25% of cars from the district reroute to another route.',
  ],
  [{ kind: 'spawnModifier', vehicleType: Bus, percent: 40 }, 'district', '+40% bus spawns.'],
  [
    { kind: 'spawnModifier', vehicleType: Car, percent: -30 },
    'edge',
    '−30% car spawns at this edge.',
  ],
  [{ kind: 'scoreModifier', vehicleType: Truck, delta: 1 }, 'district', 'Trucks score +1.'],
  [{ kind: 'scoreModifier', delta: 2 }, 'district', 'Vehicles score +2.'],
  [
    { kind: 'scoreModifier', delta: 3, condition: 'above-quota' },
    'district',
    'Each vehicle exited above quota scores +3.',
  ],
  [
    { kind: 'scoreModifier', delta: 2, condition: 'same-tick-window' },
    'district',
    'Vehicles exiting in the same tick window score +2.',
  ],
  [
    { kind: 'scoreModifier', vehicleType: Bus, delta: 3, condition: 'on-arrival' },
    'intersection',
    'Buses score +3 on arrival at this intersection.',
  ],
  [
    { kind: 'setPSlow', deltaPermille: 100 },
    'district',
    '+10% chance to slow down for everyone on the district.',
  ],
  [
    { kind: 'setPSlow', deltaPermille: -25 },
    'segment',
    '−2.5% chance to slow down for everyone on this segment.',
  ],
  [
    { kind: 'yieldRule', fasterTicks: 1 },
    'district',
    'Uncontrolled intersections resolve 1 tick faster.',
  ],
  [
    { kind: 'yieldRule', fasterTicks: 2 },
    'intersection',
    'This intersection resolves 2 ticks faster while uncontrolled.',
  ],
  [{ kind: 'drawModifier', delta: 2 }, 'district', 'Draw 2 extra cards next round.'],
  [{ kind: 'drawModifier', delta: -1 }, 'district', 'Draw 1 fewer card next round.'],
  [{ kind: 'energyModifier', delta: 1 }, 'district', '+1 energy.'],
  [{ kind: 'energyModifier', delta: 1, perRound: true }, 'district', '+1 energy every round.'],
  [{ kind: 'fundsModifier', delta: 5 }, 'district', '+5 funds.'],
  [
    { kind: 'fundsModifier', delta: 1, per: 4 },
    'segment',
    '+1 funds per 4 vehicles through this segment.',
  ],
];

describe('effectText', () => {
  it.each(CASES)('%j on %s', (effect, target, expected) => {
    expect(effectText(effect, target)).toBe(expected);
  });

  it('has a test row for every primitive', () => {
    const covered = new Set(CASES.map(([e]) => e.kind));
    expect([...covered].sort()).toEqual(Object.keys(EFFECT_SCHEMAS).sort() as EffectKind[]);
  });
});

describe('cardText', () => {
  it('joins one sentence per effect and reflects the tier-2 upgrade', () => {
    const r = parseCard({
      ...validCardJson(),
      id: 'test-fare-holiday',
      target: 'district',
      effects: [
        { kind: 'spawnModifier', vehicleType: 'bus', percent: 40 },
        { kind: 'spawnModifier', vehicleType: 'bike', percent: 40 },
        { kind: 'spawnModifier', vehicleType: 'car', percent: -20 },
      ],
      upgrade: {
        effects: [
          { kind: 'spawnModifier', vehicleType: 'bus', percent: 60 },
          { kind: 'spawnModifier', vehicleType: 'bike', percent: 60 },
          { kind: 'spawnModifier', vehicleType: 'car', percent: -30 },
        ],
      },
    });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(cardText(r.card)).toBe('+40% bus spawns. +40% bike spawns. −20% car spawns.');
    expect(cardText(r.card, 2)).toBe('+60% bus spawns. +60% bike spawns. −30% car spawns.');
  });
});
