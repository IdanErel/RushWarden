import { emptyMap, type Effect, type RoundInput, type RoundResult } from '@rushwarden/sim';
import type { RunCard, RunEnv } from '../src/run/index.js';

const card = (
  id: string,
  cost: number,
  target: RunCard['target'],
  rarity: RunCard['rarity'],
  tags: RunCard['tags'],
  effects: Effect[],
  extra: Partial<RunCard> = {},
): RunCard => ({
  id,
  cost,
  target,
  duration: 'round',
  rarity,
  tags,
  effects,
  upgrade: {},
  ...extra,
});

/** Pilot Program uses costModifier next/cost from P1-SIM-01c (#21); typed loosely until it lands. */
const pilot = { kind: 'costModifier', cards: 'all', next: 1, cost: 0 } as unknown as Effect;
const pilot2 = { kind: 'costModifier', cards: 'all', next: 2, cost: 0 } as unknown as Effect;

/** A stand-in for the Phase 1 cards with the controller-relevant effects of GDD §4. */
export const CARDS: RunCard[] = [
  card(
    'smart-signal',
    1,
    'intersection',
    'common',
    ['FLOW'],
    [{ kind: 'setController', controller: 'signal' }],
  ),
  card('one-way', 1, 'segment', 'common', ['FLOW'], [{ kind: 'setOneWay', doubleLanes: true }], {
    upgrade: { cost: 0 },
  }),
  card(
    'turn-lane',
    1,
    'intersection',
    'common',
    ['FLOW'],
    [{ kind: 'addTurnLane', turns: 'left' }],
  ),
  card('speed-limit-up', 1, 'segment', 'common', ['FLOW'], [{ kind: 'setSpeedLimit', delta: 1 }]),
  card(
    'bus-priority',
    1,
    'intersection',
    'common',
    ['MASS'],
    [{ kind: 'preferType', vehicleType: 2 }],
  ),
  card(
    'bus-lane',
    2,
    'segment',
    'uncommon',
    ['MASS'],
    [{ kind: 'reserveLane', vehicleTypes: [2, 5] }],
  ),
  card(
    'fare-holiday',
    1,
    'district',
    'common',
    ['MASS'],
    [{ kind: 'spawnModifier', vehicleType: 2, percent: 40 }],
  ),
  card('detour', 1, 'edge', 'common', ['TOLL'], [{ kind: 'reroute', percent: 50, to: 'adjacent' }]),
  card(
    'staggered-hours',
    2,
    'district',
    'uncommon',
    ['TOLL'],
    [{ kind: 'smoothDemand', peakPermille: 300 }],
  ),
  card(
    'roundabout',
    1,
    'intersection',
    'common',
    ['CHAOS'],
    [{ kind: 'setController', controller: 'roundabout' }],
  ),
  card(
    'remove-signal',
    1,
    'intersection',
    'common',
    ['CHAOS'],
    [
      { kind: 'setController', controller: 'uncontrolled' },
      { kind: 'energyModifier', delta: 1, when: 'now', condition: 'replaced-signal' },
    ],
  ),
  card(
    'yield-culture',
    2,
    'district',
    'uncommon',
    ['CHAOS'],
    [{ kind: 'yieldRule', fasterTicks: 1 }],
  ),
  card(
    'overtime',
    1,
    'district',
    'common',
    ['TEMPO'],
    [{ kind: 'energyModifier', delta: 1, when: 'next-round' }],
  ),
  card('second-shift', 2, 'district', 'uncommon', ['TEMPO'], [{ kind: 'drawModifier', delta: 2 }]),
  card('pilot-program', 1, 'district', 'common', ['TEMPO'], [pilot], {
    upgrade: { effects: [pilot2] },
  }),
  card('recount', 1, 'district', 'common', ['TEMPO'], [{ kind: 'redraw', keep: 0 }], {
    upgrade: { effects: [{ kind: 'redraw', keep: 1 }] },
  }),
  card(
    'discount',
    2,
    'district',
    'rare',
    ['TEMPO'],
    [{ kind: 'costModifier', cards: 'all', delta: -1 }],
  ),
  card(
    'ring-bond',
    3,
    'district',
    'rare',
    ['TOLL'],
    [{ kind: 'energyModifier', delta: 1, when: 'next-round', perRound: true }],
    {
      duration: 'run',
    },
  ),
];

export interface FakeEnv extends RunEnv {
  readonly inputs: RoundInput[];
  readonly setups: { round: number; rush: boolean; boss: string | null; seed: number }[];
}

/**
 * Placeholder map/demand and a scripted sim: the sim is still a stub, so the tests check the
 * controller's own rules. `throughput(input)` decides each round's score.
 */
export function fakeEnv(
  throughput: (input: RoundInput) => number = (i) => i.districtRules.quota,
): FakeEnv {
  const inputs: RoundInput[] = [];
  const setups: FakeEnv['setups'] = [];
  return {
    inputs,
    setups,
    setupRound: ({ round, rush, boss, seed }) => {
      setups.push({ round, rush, boss, seed });
      return { map: emptyMap(), demandProfile: [] };
    },
    simulate: (input): RoundResult => {
      inputs.push(input);
      return {
        throughput: throughput(input),
        spawned: 0,
        exited: 0,
        ticks: 300,
        gridlocked: false,
        fundsDelta: 0,
        finalHash: '0000000000000000',
      };
    },
  };
}

export const CENTER = { kind: 'intersection', tile: { x: 3, y: 4 } } as const;
export const DISTRICT = { kind: 'district' } as const;
export const SEGMENT = { kind: 'segment', from: { x: 3, y: 0 }, to: { x: 3, y: 3 } } as const;
export const EDGE = { kind: 'edge', edge: 0 } as const;
