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
    { kind: 'setSignalPhase', mode: 'adaptive', switchTicksDelta: -2 },
    'intersection',
    'Signal is adaptive: the longest queue gets green. Phases switch 2 ticks faster (4 ticks).',
  ],
  [
    { kind: 'setSignalPhase', mode: 'district-cycle', switchTicksDelta: 1 },
    'district',
    'All signals share one district-wide cycle. Phases switch 1 tick slower (7 ticks).',
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
    { kind: 'banType', vehicleType: Truck, scope: 'target' },
    'segment',
    'Trucks are banned from this segment and route around it.',
  ],
  [
    { kind: 'banType', vehicleType: Truck, scope: 'target-class' },
    'segment',
    'Trucks are banned from every road in the district of the same class (local or arterial) as this segment and route around them.',
  ],
  [
    { kind: 'banType', vehicleType: Truck, scope: { roadClass: 'local' } },
    'segment',
    'Trucks are banned from every local (1-lane) road in the district and route around them.',
  ],
  [
    { kind: 'setSpeedLimit', delta: 0, max: 1, cells: 2 },
    'segment',
    'Top speed at most 1 on the first 2 cells of this segment for all vehicles.',
  ],
  [
    { kind: 'setSpeedLimit', delta: 1, max: 2, types: [Bike] },
    'segment',
    '+1 top speed, up to 2, on this segment for bikes.',
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
    { kind: 'setBusStopDwell', dwellTicks: 2 },
    'segment',
    'Buses dwell 2 ticks at the bus stop on this segment.',
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
    { kind: 'setOneWay', doubleLanes: true },
    'segment',
    'This segment becomes one-way in the direction you place it, with its lanes doubled that way.',
  ],
  [
    { kind: 'setOneWay', direction: 'e', doubleLanes: false },
    'segment',
    'This segment becomes one-way heading east.',
  ],
  [
    { kind: 'reroute', percent: 50, to: 'adjacent' },
    'edge',
    '50% of spawns from this edge move to the next edge clockwise.',
  ],
  [
    { kind: 'reroute', percent: 25, to: 'secondary', vehicleTypes: [Car] },
    'edge',
    '25% of cars from this edge move to an edge you choose.',
  ],
  [
    { kind: 'addTurnLane', turns: 'left' },
    'intersection',
    'Left turns get their own lane and stop blocking through traffic.',
  ],
  [
    { kind: 'addTurnLane', turns: 'both' },
    'intersection',
    'Left and right turns get their own lanes and stop blocking through traffic.',
  ],
  [
    { kind: 'reserveLane', vehicleTypes: [Bus, Bike] },
    'segment',
    'One lane of this segment is reserved for buses and bikes.',
  ],
  [
    { kind: 'smoothDemand', peakPermille: 300 },
    'district',
    'Rush hour spreads out: peak demand 30% lower, spread over the round.',
  ],
  [
    { kind: 'spawnWindow', vehicleType: Truck, fromTick: 0, toTick: 100 },
    'district',
    'Trucks spawn only in the first 5 seconds.',
  ],
  [
    { kind: 'spawnWindow', vehicleType: Bus, fromTick: 20, toTick: 45 },
    'edge',
    'Buses spawn at this edge only between 1 second and 45 ticks in.',
  ],
  [{ kind: 'costModifier', cards: 'all', delta: -1 }, 'district', 'All cards cost \u22121 energy.'],
  [
    { kind: 'costModifier', cards: ['one-way', 'detour'], delta: 1 },
    'district',
    'one-way and detour cost +1 energy.',
  ],
  [
    { kind: 'costModifier', cards: 'all', next: 1, cost: 0 },
    'district',
    'The next card you play this round costs 0.',
  ],
  [
    { kind: 'costModifier', cards: 'all', next: 2, cost: 0 },
    'district',
    'The next 2 cards you play this round cost 0.',
  ],
  [
    { kind: 'costModifier', cards: ['detour'], next: 1, cost: 1 },
    'district',
    'The next card of detour you play this round costs 1.',
  ],
  [{ kind: 'redraw', keep: 0 }, 'district', 'Redraw your hand.'],
  [{ kind: 'redraw', keep: 1 }, 'district', 'Keep 1 card, then redraw the rest of your hand.'],
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
  [{ kind: 'energyModifier', delta: 1, when: 'next-round' }, 'district', '+1 energy next round.'],
  [
    { kind: 'energyModifier', delta: 1, when: 'now', condition: 'replaced-signal' },
    'intersection',
    '+1 energy this round if it replaced a signal.',
  ],
  [
    { kind: 'energyModifier', delta: 1, when: 'next-round', perRound: true },
    'district',
    '+1 energy every round, starting next round.',
  ],
  [
    { kind: 'energyModifier', delta: -1, when: 'now', perRound: true },
    'district',
    '\u22121 energy every round, starting this round.',
  ],
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
