import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SWITCH_TICKS,
  Sim,
  emptyMap,
  placementError,
  sampleInput,
  segmentTiles,
  type Effect,
  type GridMap,
  type MapTile,
  type Placement,
  type Target,
} from '../src/index.js';

const seg = (x1: number, y1: number, x2: number, y2: number): Target => ({
  kind: 'segment',
  from: { x: x1, y: y1 },
  to: { x: x2, y: y2 },
});
const place = (
  effects: Effect[],
  target: Target = { kind: 'district' },
  extra = {},
): Placement => ({
  cardId: 'test',
  tier: 1,
  target,
  effects,
  order: 0,
  ...extra,
});

/** The plus map with a bus stop on (3,1). */
function withStop(): GridMap {
  const map = emptyMap();
  const tiles: MapTile[] = [...map.tiles];
  tiles[1 * 7 + 3] = { kind: 'road', lanes: 1, busStop: true };
  return { ...map, tiles };
}

describe('Effect union v2 validation (ADR-014)', () => {
  const map = withStop();

  it('publishes the default signal switch time', () => {
    expect(DEFAULT_SWITCH_TICKS).toBe(6);
  });

  it('accepts every new primitive with valid parameters', () => {
    const ok: [Effect, Target?, object?][] = [
      [
        { kind: 'setSignalPhase', mode: 'adaptive', switchTicksDelta: -2 },
        { kind: 'intersection', tile: { x: 3, y: 4 } },
      ],
      [{ kind: 'setOneWay', doubleLanes: true }, seg(3, 0, 3, 3)],
      [{ kind: 'setOneWay', direction: 's', doubleLanes: true }, seg(3, 0, 3, 0)],
      [
        { kind: 'addTurnLane', turns: 'both' },
        { kind: 'intersection', tile: { x: 3, y: 4 } },
      ],
      [{ kind: 'reserveLane', vehicleTypes: [2, 5] }, seg(3, 0, 3, 3)],
      [
        { kind: 'reroute', percent: 50, to: 'adjacent' },
        { kind: 'edge', edge: 0 },
      ],
      [
        { kind: 'reroute', percent: 50, to: 'secondary' },
        { kind: 'edge', edge: 0 },
        { secondaryTarget: { kind: 'edge', edge: 2 } },
      ],
      [{ kind: 'setSpeedLimit', delta: 0, max: 1, cells: 2 }, seg(3, 0, 3, 3)],
      [{ kind: 'smoothDemand', peakPermille: 300 }],
      [{ kind: 'spawnWindow', vehicleType: 3, fromTick: 0, toTick: 100 }],
      [{ kind: 'banType', vehicleType: 3, scope: { roadClass: 'local' } }],
      [{ kind: 'banType', vehicleType: 3, scope: 'target' }, seg(3, 0, 3, 3)],
      [
        { kind: 'energyModifier', delta: 1, when: 'now', condition: 'replaced-signal' },
        { kind: 'intersection', tile: { x: 3, y: 4 } },
      ],
      [{ kind: 'energyModifier', delta: 1, when: 'next-round' }],
      [{ kind: 'costModifier', cards: 'all', delta: -1 }],
      [{ kind: 'costModifier', cards: ['one-way'], delta: -1 }],
      [{ kind: 'redraw', keep: 1 }],
      [{ kind: 'drawModifier', delta: 2 }],
      [{ kind: 'addBusStop', dwellTicks: 2 }, seg(3, 0, 3, 3)],
    ];
    for (const [effect, target, extra] of ok) {
      expect(placementError(map, place([effect], target, extra)), effect.kind).toBeNull();
    }
  });

  it.each<[string, Placement]>([
    [
      'Express Stop without a stop',
      place([{ kind: 'addBusStop', dwellTicks: 2 }], seg(3, 5, 3, 8)),
    ],
    ['addBusStop off a segment', place([{ kind: 'addBusStop', dwellTicks: 2 }])],
    ['dwell out of range', place([{ kind: 'addBusStop', dwellTicks: -1 }], seg(3, 0, 3, 3))],
    ['one-way with no direction off a segment', place([{ kind: 'setOneWay', doubleLanes: false }])],
    [
      'one-way with no direction on one tile',
      place([{ kind: 'setOneWay', doubleLanes: false }], seg(3, 1, 3, 1)),
    ],
    [
      'reroute percent',
      place([{ kind: 'reroute', percent: 120, to: 'adjacent' }], { kind: 'edge', edge: 0 }),
    ],
    [
      'reroute secondary missing',
      place([{ kind: 'reroute', percent: 50, to: 'secondary' }], { kind: 'edge', edge: 0 }),
    ],
    [
      'reroute secondary unknown edge',
      place(
        [{ kind: 'reroute', percent: 50, to: 'secondary' }],
        { kind: 'edge', edge: 0 },
        { secondaryTarget: { kind: 'edge', edge: 9 } },
      ),
    ],
    ['smoothDemand range', place([{ kind: 'smoothDemand', peakPermille: 1001 }])],
    [
      'spawnWindow order',
      place([{ kind: 'spawnWindow', vehicleType: 3, fromTick: 100, toTick: 100 }]),
    ],
    [
      'spawnWindow range',
      place([{ kind: 'spawnWindow', vehicleType: 3, fromTick: 0, toTick: 301 }]),
    ],
    ['speed max', place([{ kind: 'setSpeedLimit', delta: 0, max: -1 }], seg(3, 0, 3, 3))],
    ['speed cells', place([{ kind: 'setSpeedLimit', delta: 0, cells: 0 }], seg(3, 0, 3, 3))],
    ['unknown edge target', place([], { kind: 'edge', edge: 42 })],
    ['intersection out of bounds', place([], { kind: 'intersection', tile: { x: 7, y: 0 } })],
    ['diagonal segment', place([], seg(0, 0, 1, 1))],
    ['segment out of bounds', place([], seg(0, 0, 0, 9))],
    ['segment over a block tile', place([], seg(2, 4, 2, 5))],
    [
      'addBusStop on a segment crossing blocks',
      place([{ kind: 'addBusStop', dwellTicks: 2 }], seg(2, 1, 3, 1)),
    ],
  ])('rejects: %s', (_name, p) => {
    expect(placementError(map, p)).not.toBeNull();
  });

  it('segmentTiles checks road tiles when given the map', () => {
    const s = seg(3, 0, 3, 3) as Extract<Target, { kind: 'segment' }>;
    expect(segmentTiles(s, map)).toHaveLength(4);
    expect(segmentTiles(seg(2, 4, 3, 4) as Extract<Target, { kind: 'segment' }>, map)).toHaveLength(
      2,
    );
    expect(segmentTiles(seg(1, 0, 3, 0) as Extract<Target, { kind: 'segment' }>, map)).toBeNull();
    expect(segmentTiles(seg(1, 0, 3, 0) as Extract<Target, { kind: 'segment' }>)).toHaveLength(3);
  });

  it('walks segments in either direction', () => {
    expect(segmentTiles(seg(3, 3, 3, 1) as Extract<Target, { kind: 'segment' }>)).toEqual([
      { x: 3, y: 3 },
      { x: 3, y: 2 },
      { x: 3, y: 1 },
    ]);
  });

  it('Sim.init rejects invalid placements and run effects, and accepts valid ones', () => {
    const base = { ...sampleInput(1), map, mapId: map.id };
    const bad = place([{ kind: 'addBusStop', dwellTicks: 2 }], seg(3, 5, 3, 8));
    expect(() => Sim.init({ ...base, placements: [bad] })).toThrow(/already has a bus stop/);
    expect(() => Sim.init({ ...base, cardState: { runEffects: [bad] } })).toThrow(RangeError);
    const good = place([{ kind: 'addBusStop', dwellTicks: 2 }], seg(3, 0, 3, 3));
    expect(Sim.init({ ...base, placements: [good] }).tick).toBe(0);
  });
});
