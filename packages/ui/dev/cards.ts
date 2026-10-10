/**
 * DEV-ONLY stand-ins for the 20 Phase 1 cards, so the dev page, its e2e and the unit tests can
 * drive the real run controller before content's cards land (P1-CON-01 #12, P1-CON-02 #14).
 * Names and costs follow GDD §4; texts are short paraphrases, not content's generated text; the
 * effects are close to §4 but are not the tuned content data. Not shipped: platform-web passes
 * content's cards and `cardText` instead.
 */
import type { RunCard, RunEnv } from '@rushwarden/app';
import { emptyMap, type Effect } from '@rushwarden/sim';
import { fakeDemand } from '@rushwarden/render/core';
import type { CardCatalog } from '../src/run/controller-run.js';

type Spec = [
  id: string,
  name: string,
  cost: number,
  target: RunCard['target'],
  rarity: RunCard['rarity'],
  tag: RunCard['tags'][number],
  text: string,
  effects: Effect[],
];

const SPECS: readonly Spec[] = [
  // FLOW
  [
    'smart-signal',
    'Smart Signal',
    1,
    'intersection',
    'common',
    'FLOW',
    'Signal: longest queue gets green.',
    [
      { kind: 'setController', controller: 'signal' },
      { kind: 'setSignalPhase', mode: 'adaptive' },
    ],
  ],
  [
    'one-way',
    'One-Way',
    1,
    'segment',
    'common',
    'FLOW',
    'One-way, lanes doubled that way.',
    [{ kind: 'setOneWay', doubleLanes: true }],
  ],
  [
    'turn-lane',
    'Turn Lane',
    1,
    'intersection',
    'common',
    'FLOW',
    'Turns no longer block through traffic.',
    [{ kind: 'addTurnLane', turns: 'left' }],
  ],
  [
    'speed-limit-up',
    'Speed Limit Up',
    1,
    'segment',
    'common',
    'FLOW',
    'Max speed +1 on this segment.',
    [{ kind: 'setSpeedLimit', delta: 1 }],
  ],
  // MASS
  [
    'bus-priority',
    'Bus Priority',
    1,
    'intersection',
    'common',
    'MASS',
    'Buses get green on approach.',
    [{ kind: 'preferType', vehicleType: 2 }],
  ],
  [
    'bus-lane',
    'Bus Lane',
    2,
    'segment',
    'uncommon',
    'MASS',
    'One lane for buses and bikes only.',
    [{ kind: 'reserveLane', vehicleTypes: [2, 5] }],
  ],
  [
    'fare-holiday',
    'Fare Holiday',
    1,
    'district',
    'common',
    'MASS',
    '+40% buses this round.',
    [{ kind: 'spawnModifier', vehicleType: 2, percent: 40 }],
  ],
  // TOLL
  [
    'detour',
    'Detour',
    1,
    'edge',
    'common',
    'TOLL',
    'Half of this edge’s spawns go next door.',
    [{ kind: 'reroute', percent: 50, to: 'adjacent' }],
  ],
  [
    'staggered-hours',
    'Staggered Hours',
    2,
    'district',
    'uncommon',
    'TOLL',
    'Peak demand −30%, spread out.',
    [{ kind: 'smoothDemand', peakPermille: 300 }],
  ],
  [
    'delivery-window',
    'Delivery Window',
    1,
    'district',
    'common',
    'TOLL',
    'Trucks spawn only in the first 5 s.',
    [{ kind: 'spawnWindow', vehicleType: 3, fromTick: 0, toTick: 100 }],
  ],
  // CHAOS
  [
    'roundabout',
    'Roundabout',
    1,
    'intersection',
    'common',
    'CHAOS',
    'Roundabout: inside has priority.',
    [{ kind: 'setController', controller: 'roundabout' }],
  ],
  [
    'yield-culture',
    'Yield Culture',
    2,
    'district',
    'uncommon',
    'CHAOS',
    'Uncontrolled junctions clear 1 tick faster.',
    [{ kind: 'yieldRule', fasterTicks: 1 }],
  ],
  [
    'no-heavy',
    'No Heavy',
    1,
    'segment',
    'common',
    'CHAOS',
    'Trucks banned from this segment.',
    [{ kind: 'banType', vehicleType: 3 }],
  ],
  // TEMPO
  [
    'overtime',
    'Overtime',
    1,
    'district',
    'common',
    'TEMPO',
    '+1 energy next round.',
    [{ kind: 'energyModifier', delta: 1, when: 'next-round' }],
  ],
  [
    'second-shift',
    'Second Shift',
    2,
    'district',
    'uncommon',
    'TEMPO',
    'Draw 2 more cards next round.',
    [{ kind: 'drawModifier', delta: 2 }],
  ],
  [
    'pilot-program',
    'Pilot Program',
    1,
    'district',
    'common',
    'TEMPO',
    'Your next card this round costs 0.',
    [{ kind: 'costModifier', cards: 'all', next: 1, cost: 0 }],
  ],
  [
    'recount',
    'Recount',
    1,
    'district',
    'common',
    'TEMPO',
    'Redraw your hand.',
    [{ kind: 'redraw', keep: 0 }],
  ],
];

export const DEV_CARDS: readonly RunCard[] = SPECS.map(
  ([id, , cost, target, rarity, tag, , effects]) => ({
    id,
    cost,
    target,
    duration: 'round',
    rarity,
    tags: [tag],
    effects,
    upgrade: {},
  }),
);

const INFO = new Map(SPECS.map(([id, name, , , , , text]) => [id, { name, text }]));

export const devCatalog: CardCatalog = (id) => INFO.get(id) ?? { name: id, text: '' };

/** Round setup for the dev page: the plus map with the renderer's seeded fake demand. */
export const devEnv: RunEnv = {
  setupRound: ({ seed }) => {
    const map = emptyMap();
    return { map, demandProfile: fakeDemand(map, seed) };
  },
};
