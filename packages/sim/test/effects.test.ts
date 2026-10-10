import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ControllerCode,
  PocketMode,
  ROUND_TICKS,
  Sim,
  VehicleType,
  buildWorld,
  controllerSnapshot,
  denseInput,
  PHASE1_CARDS,
  latticeMap,
  resolvePlacements,
  roundWorld,
  sampleInput,
  type DemandEvent,
  type Effect,
  type Placement,
  type RoundInput,
  type Target,
} from '../src/index.js';
import { configureTraffic, laneOverrides, transformDemand } from '../src/effects.js';
import { createTraffic, tickTraffic, type Traffic } from '../src/traffic.js';
import { VEHICLE_TYPE_COUNT } from '../src/vehicles.js';

// Lattice: columns 1 and 5, rows 2 and 6; intersections at (1,2), (5,2), (1,6), (5,6) = 0..3.
// Edges: 0 n col 1, 1 s col 1, 2 n col 5, 3 s col 5, 4 w row 2, 5 e row 2, 6 w row 6, 7 e row 6.
// Bus stop at (1,4). Clockwise edge order: 0, 2, 5, 7, 3, 1, 6, 4.
const map = latticeMap('fx', [1, 5], [2, 6]);
const { Car, Taxi, Bus, Truck, Bike } = VehicleType;

const ix = (x: number, y: number): Target => ({ kind: 'intersection', tile: { x, y } });
const seg = (x1: number, y1: number, x2: number, y2: number): Target => ({
  kind: 'segment',
  from: { x: x1, y: y1 },
  to: { x: x2, y: y2 },
});
const edge = (e: number): Target => ({ kind: 'edge', edge: e });
const district: Target = { kind: 'district' };
let nextOrder = 0;
const place = (
  cardId: string,
  target: Target,
  effects: readonly Effect[],
  extra: Partial<Placement> = {},
): Placement => ({
  cardId,
  tier: 1,
  target,
  effects,
  order: nextOrder++,
  ...extra,
});
const ev = (tick: number, e: number, d: number, vehicleType: VehicleType = Car): DemandEvent => ({
  tick,
  edge: e,
  destinationEdge: d,
  vehicleType,
});
const sortDemand = (d: readonly DemandEvent[]): DemandEvent[] =>
  [...d].sort((a, b) => a.tick - b.tick || a.edge - b.edge);

function input(
  demand: DemandEvent[],
  placements: Placement[] = [],
  extra: Partial<RoundInput> = {},
): RoundInput {
  return {
    ...sampleInput(1),
    map,
    mapId: map.id,
    demandProfile: sortDemand(demand),
    placements,
    ...extra,
  };
}

/** A traffic state configured with `placements` (no ticks run yet). */
function configured(placements: Placement[], demand: DemandEvent[] = []): Traffic {
  const { applied } = resolvePlacements([], placements);
  const t = createTraffic(buildWorld(map, laneOverrides(map, applied)), sortDemand(demand));
  configureTraffic(t, map, applied, 0);
  return t;
}

/** Runs `inp` and returns, per vehicle id, the (lane, speed) of its head at every tick. */
function trace(inp: RoundInput): Map<number, { lane: number; cell: number; speed: number }[]> {
  const out = new Map<number, { lane: number; cell: number; speed: number }[]>();
  let s = Sim.init(inp);
  while (!s.done) {
    s = Sim.step(s);
    const f = Sim.snapshot(s);
    for (let k = 0; k < f[1]!; k++) {
      const b = 2 + k * 5;
      const id = f[b]!;
      if (!out.has(id)) out.set(id, []);
      out.get(id)!.push({ lane: f[b + 1]!, cell: f[b + 2]!, speed: f[b + 3]! });
    }
  }
  return out;
}

describe('resolvePlacements: stacking and controller conflicts (GDD §4)', () => {
  it('the same card on the same target does not stack; different cards do', () => {
    const a = place('speed-limit-up', seg(1, 3, 1, 5), [{ kind: 'setSpeedLimit', delta: 1 }]);
    const b = place('speed-limit-up', seg(1, 5, 1, 3), [{ kind: 'setSpeedLimit', delta: 1 }]);
    const c = place('toll-booth', seg(1, 3, 1, 5), [{ kind: 'setSpeedLimit', delta: 0, max: 1 }]);
    const r = resolvePlacements([], [a, b, c]);
    expect(r.applied).toEqual([a, c]);
    expect(r.ignored).toEqual([b]);
  });

  it('the last controller played wins and the earlier card is refunded', () => {
    const smart = place('smart-signal', ix(1, 2), [
      { kind: 'setController', controller: 'signal' },
      { kind: 'setSignalPhase', mode: 'adaptive' },
    ]);
    const round = place('roundabout', ix(1, 2), [
      { kind: 'setController', controller: 'roundabout' },
    ]);
    const other = place('roundabout', ix(5, 2), [
      { kind: 'setController', controller: 'roundabout' },
    ]);
    // Play order decides, not array order.
    const r = resolvePlacements(
      [],
      [round, smart, other].map((p, i) => ({ ...p, order: [5, 1, 9][i]! })),
    );
    expect(r.applied.map((p) => p.cardId)).toEqual(['roundabout', 'roundabout']);
    expect(r.refunded.map((p) => p.cardId)).toEqual(['smart-signal']);
    const s = Sim.init(
      input(
        [],
        [round, smart].map((p, i) => ({ ...p, order: [5, 1][i]! })),
      ),
    );
    expect(controllerSnapshot(s)[0]).toBe(ControllerCode.Roundabout);
  });

  it('replacedController reports the controller before this round (Remove Signal refund)', () => {
    const signal = place('smart-signal', ix(1, 2), [
      { kind: 'setController', controller: 'signal' },
    ]);
    const remove = place('remove-signal', ix(1, 2), [
      { kind: 'setController', controller: 'uncontrolled' },
    ]);
    expect(resolvePlacements([signal], [remove]).replacedController.get(remove)).toBe('signal');
    // A signal played and refunded this round never stood, so nothing was replaced.
    const r = resolvePlacements([], [signal, remove]);
    expect(r.replacedController.get(remove)).toBe('uncontrolled');
    expect(r.refunded).toEqual([signal]);
  });
});

describe('controller primitives', () => {
  it('setController sets kind, capacity and priority axis; setSignalPhase adaptive with delta', () => {
    const t = configured([
      place('roundabout', ix(1, 2), [
        { kind: 'setController', controller: 'roundabout', capacity: 6 },
      ]),
      place('smart-signal', ix(5, 2), [
        { kind: 'setController', controller: 'signal' },
        { kind: 'setSignalPhase', mode: 'adaptive', switchTicksDelta: -2 },
      ]),
      place('priority', ix(1, 6), [
        { kind: 'setController', controller: 'priority', direction: 'e' },
      ]),
    ]);
    expect([...t.ctrlKind]).toEqual([
      ControllerCode.Roundabout,
      ControllerCode.Signal,
      ControllerCode.Priority,
      0,
    ]);
    expect(t.ctrlCapacity[0]).toBe(6);
    expect(t.sigAdaptive[1]).toBe(1);
    expect(t.sigSwitchTicks[1]).toBe(4);
    expect(t.ctrlAxis[2]).toBe(1);
  });

  it('addTurnLane sets pockets; yieldRule shortens the uncontrolled wait; setPSlow adds and caps', () => {
    const t = configured([
      place('turn-lane', ix(1, 2), [{ kind: 'addTurnLane', turns: 'left' }]),
      place('turn-lane+', ix(5, 2), [{ kind: 'addTurnLane', turns: 'both' }]),
      place('yield-culture', district, [{ kind: 'yieldRule', fasterTicks: 2 }]),
      place('fog', district, [{ kind: 'setPSlow', deltaPermille: 700 }]),
      place('fog2', district, [{ kind: 'setPSlow', deltaPermille: 700 }]),
    ]);
    expect(t.pocketMode[0]).toBe(PocketMode.Left);
    expect(t.pocketMode[4]).toBe(PocketMode.Both);
    expect([...t.resolveTicks]).toEqual([1, 1, 1, 1]);
    expect(t.pSlowPermille).toBe(1000);
  });

  it('preferType: a bus enters on red at its intersection; a car waits for green', () => {
    // Fixed signal at (1,6): n-s green for 40 ticks, then all-red. Row 6 traffic from the west is on red.
    const signal = place('signal', ix(1, 6), [{ kind: 'setController', controller: 'signal' }]);
    const prefer = place('bus-priority', ix(1, 6), [{ kind: 'preferType', vehicleType: Bus }]);
    const firstEntry = (placements: Placement[], vt: VehicleType): number => {
      const { applied } = resolvePlacements([], placements);
      const t = createTraffic(buildWorld(map), [ev(0, 6, 7, vt)]);
      configureTraffic(t, map, applied, 0);
      t.entryLog = [];
      for (let tick = 0; tick < 100 && t.entryLog.length === 0; tick++) tickTraffic(t, tick);
      return t.entryLog[2]!;
    };
    expect(firstEntry([signal], Bus)).toBeGreaterThan(40);
    expect(firstEntry([signal, prefer], Bus)).toBeLessThan(40);
    expect(firstEntry([signal, prefer], Car)).toBeGreaterThan(40);
  });
});

describe('segment primitives', () => {
  it('setSpeedLimit raises vmax on the segment for the listed types only', () => {
    const up = place('speed-limit-up', seg(1, 3, 1, 5), [
      { kind: 'setSpeedLimit', delta: 1, types: [Car, Taxi, Bus, VehicleType.Emergency, Bike] },
    ]);
    const car = trace(input([ev(0, 0, 1)], [up])).get(0)!;
    expect(Math.max(...car.map((c) => c.speed))).toBe(4);
    const truck = trace(input([ev(0, 0, 1, Truck)], [up])).get(0)!;
    expect(Math.max(...truck.map((c) => c.speed))).toBe(2);
    const plain = trace(input([ev(0, 0, 1)])).get(0)!;
    expect(Math.max(...plain.map((c) => c.speed))).toBe(3);
  });

  it('Toll Booth: vehicles slow to 1 for 2 cells, and pay +1 funds per 4', () => {
    const toll = place('toll-booth', seg(1, 3, 1, 5), [
      { kind: 'setSpeedLimit', delta: 0, max: 1, cells: 2 },
      { kind: 'fundsModifier', delta: 1, per: 4 },
    ]);
    const t = configured([toll]);
    const w = t.world;
    const southbound = w.links.find((l) => l.tiles.includes(3 * 7 + 1) && l.entryDirs[0] === 2)!;
    const base = w.laneCellBase[southbound.lanes[0]!]!;
    const capAt = (c: number): number => t.speedCap![(base + c) * VEHICLE_TYPE_COUNT + Car]!;
    expect([0, 1, 2].map(capAt)).toEqual([1, 1, 3]);
    const car = trace(input([ev(0, 0, 1)], [toll])).get(0)!;
    const inToll = car.filter((c) => c.lane === southbound.lanes[0] && c.cell < 2);
    expect(inToll.length).toBeGreaterThanOrEqual(2);
    expect(inToll.every((c) => c.speed <= 1)).toBe(true);
    const nine = Array.from({ length: 9 }, (_, k) => ev(k * 10, 0, 1));
    expect(Sim.simulate(input(nine, [toll])).fundsDelta).toBe(2);
    expect(Sim.simulate(input(nine)).fundsDelta).toBe(0);
  });

  it('setBusStopDwell changes the dwell at the stop on the segment', () => {
    const stopTicks = (placements: Placement[]): number => {
      const bus = trace(input([ev(0, 0, 1, Bus)], placements)).get(0)!;
      return bus.filter((c) => c.speed === 0).length;
    };
    const express = place('express-stop', seg(1, 3, 1, 5), [
      { kind: 'setBusStopDwell', dwellTicks: 1 },
    ]);
    expect(stopTicks([])).toBeGreaterThan(stopTicks([express]));
    const t = configured([express]);
    const stops = [...t.world.stopCell.keys()].filter((f) => t.world.stopCell[f] === 1);
    expect(stops.every((f) => t.dwellAt![f] === 1)).toBe(true);
  });

  it('reserveLane on a 1-lane road: other types route around it, buses and bikes use it', () => {
    const busLane = place('bus-lane', seg(1, 3, 1, 5), [
      { kind: 'reserveLane', vehicleTypes: [Bus, Bike] },
    ]);
    const world = buildWorld(map);
    const closedIds = world.links
      .filter((l) => l.tiles.includes(4 * 7 + 1))
      .flatMap((l) => l.lanes);
    const lanesUsed = (vt: VehicleType): Set<number> =>
      new Set(
        trace(input([ev(0, 0, 1, vt)], [busLane]))
          .get(0)!
          .map((c) => c.lane),
      );
    expect([...lanesUsed(Car)].some((l) => closedIds.includes(l))).toBe(false);
    expect([...lanesUsed(Bus)].some((l) => closedIds.includes(l))).toBe(true);
    // Lead's ruling (ADR-023 point 19): cars, taxis and trucks lose it; emergency keeps its override.
    for (const vt of [Taxi, Truck])
      expect([...lanesUsed(vt)].some((l) => closedIds.includes(l))).toBe(false);
    expect([...lanesUsed(VehicleType.Emergency)].some((l) => closedIds.includes(l))).toBe(true);
    expect(Sim.simulate(input([ev(0, 0, 1, Car)], [busLane])).exited).toBe(1);
  });

  it('reserveLane on a 2-lane road reserves the kerb lane; cars keep the other lane', () => {
    const wide = latticeMap('fx2', [1, 5], [2, 6], 2);
    const lane = place('bus-lane', seg(2, 2, 4, 2), [
      { kind: 'reserveLane', vehicleTypes: [Bus, Bike] },
    ]);
    const inp: RoundInput = { ...input([]), map: wide, mapId: wide.id, placements: [lane] };
    const w = buildWorld(wide);
    const kerbs = w.links.filter((l) => l.tiles.includes(2 * 7 + 3)).map((l) => l.lanes[0]!);
    const demand = sortDemand(
      Array.from({ length: 12 }, (_, k) => ev(k * 3, 4, 5, k % 3 === 0 ? Bus : Car)),
    );
    const tr = trace({ ...inp, demandProfile: demand });
    const types = demand.map((d) => d.vehicleType);
    for (const [id, steps] of tr) {
      if (types[id] === Car) expect(steps.some((c) => kerbs.includes(c.lane))).toBe(false);
    }
    expect(
      [...tr].some(([id, steps]) => types[id] === Bus && steps.some((c) => kerbs.includes(c.lane))),
    ).toBe(true);
  });

  it('banType: trucks avoid the segment, its road class, or a named class', () => {
    const w = buildWorld(map);
    const segLanes = w.links.filter((l) => l.tiles.includes(4 * 7 + 1)).flatMap((l) => l.lanes);
    const noHeavy = place('no-heavy', seg(1, 3, 1, 5), [{ kind: 'banType', vehicleType: Truck }]);
    const truck = trace(input([ev(0, 0, 1, Truck)], [noHeavy])).get(0)!;
    expect(truck.some((c) => segLanes.includes(c.lane))).toBe(false);
    const car = trace(input([ev(0, 0, 1, Car)], [noHeavy])).get(0)!;
    expect(car.some((c) => segLanes.includes(c.lane))).toBe(true);
    // Every road on this map is local: a class-wide ban leaves trucks no route at all.
    const classWide = place('no-heavy+', seg(1, 3, 1, 5), [
      { kind: 'banType', vehicleType: Truck, scope: 'target-class' },
    ]);
    expect(Sim.simulate(input([ev(0, 0, 1, Truck), ev(0, 2, 3)], [classWide])).spawned).toBe(1);
    const arterial = place('ban-arterial', district, [
      { kind: 'banType', vehicleType: Truck, scope: { roadClass: 'arterial' } },
    ]);
    expect(Sim.simulate(input([ev(0, 0, 1, Truck)], [arterial])).spawned).toBe(1);
  });

  it('setOneWay doubles lanes one way and closes the other; roundWorld exposes the round world', () => {
    const oneWay = place('one-way', seg(1, 3, 1, 5), [{ kind: 'setOneWay', doubleLanes: true }]);
    const inp = input([ev(0, 1, 0), ev(0, 0, 1)], [oneWay]);
    const w = roundWorld(inp);
    const links = w.links.filter((l) => l.tiles.includes(4 * 7 + 1));
    const south = links.find((l) => l.entryDirs[0] === 2)!;
    const north = links.find((l) => l.entryDirs[0] === 0)!;
    expect(south.lanes).toHaveLength(2);
    expect(north.lanes).toHaveLength(0);
    // The northbound trip goes around via column 5 and still exits.
    expect(Sim.simulate(inp).exited).toBe(2);
    expect(roundWorld(input([]))).not.toBe(w);
    expect(() =>
      Sim.init(
        input(
          [],
          [
            place('bad', seg(1, 3, 1, 5), [
              { kind: 'setOneWay', direction: 'e', doubleLanes: false },
            ]),
          ],
        ),
      ),
    ).toThrow(RangeError);
  });

  it('setLaneCount sets the lanes per direction on the segment', () => {
    const wide = place('widen', seg(1, 3, 1, 5), [{ kind: 'setLaneCount', lanes: 2 }]);
    const w = roundWorld(input([], [wide]));
    expect(w.links.filter((l) => l.tiles.includes(4 * 7 + 1)).map((l) => l.lanes.length)).toEqual([
      2, 2,
    ]);
  });

  it('setLaneCount with ring scope widens every ring tile; one-way from to back to from runs north', () => {
    const ringMap = {
      ...map,
      id: 'fx-ring',
      tiles: map.tiles.map((t, i) => (t.kind === 'road' && i % 7 === 1 ? { ...t, ring: true } : t)),
    };
    const ring = place('ring-road', district, [{ kind: 'setLaneCount', lanes: 2, scope: 'ring' }]);
    const base = sampleInput(1);
    const w = roundWorld({
      ...base,
      map: ringMap,
      mapId: ringMap.id,
      demandProfile: [],
      placements: [ring],
    });
    const col1 = w.links.filter((l) => l.tiles.every((t) => t % 7 === 1));
    expect(col1.length).toBeGreaterThan(0);
    expect(col1.every((l) => l.lanes.length === 2)).toBe(true);
    const north = place('one-way-n', seg(1, 5, 1, 3), [{ kind: 'setOneWay', doubleLanes: false }]);
    const nw = roundWorld(input([], [north]));
    const links = nw.links.filter((l) => l.tiles.includes(4 * 7 + 1));
    expect(links.find((l) => l.entryDirs[0] === 0)!.lanes).toHaveLength(1);
    expect(links.find((l) => l.entryDirs[0] === 2)!.lanes).toHaveLength(0);
    const westEast = place('one-way-w', seg(4, 2, 2, 2), [
      { kind: 'setOneWay', doubleLanes: false },
    ]);
    expect(
      roundWorld(input([], [westEast]))
        .links.filter((l) => l.tiles.includes(2 * 7 + 3))
        .map((l) => l.lanes.length)
        .sort(),
    ).toEqual([0, 1]);
    const single = place('one-way-1', seg(1, 4, 1, 4), [{ kind: 'setOneWay', doubleLanes: false }]);
    expect(() => roundWorld(input([], [single]))).toThrow(RangeError);
    expect(() =>
      roundWorld(input([], [place('lanes-ix', ix(1, 2), [{ kind: 'setLaneCount', lanes: 2 }])])),
    ).toThrow(RangeError);
  });

  it('spawnModifier on an edge changes only that edge', () => {
    const demand = sortDemand([
      ...Array.from({ length: 10 }, (_, k) => ev(k * 9, 4, 5)),
      ...Array.from({ length: 10 }, (_, k) => ev(k * 9, 6, 7)),
    ]);
    const out = transformDemand(map, demand, [
      place('edge-boost', edge(4), [{ kind: 'spawnModifier', vehicleType: Car, percent: 100 }]),
    ]);
    expect(out.filter((d) => d.edge === 4)).toHaveLength(20);
    expect(out.filter((d) => d.edge === 6)).toHaveLength(10);
  });

  it('addBikeLane sets bike vmax and lowers cars on the segment', () => {
    const t = configured([
      place('bike-boulevard', seg(1, 3, 1, 5), [
        { kind: 'addBikeLane', bikeVmax: 3, carVmaxDelta: -1 },
      ]),
    ]);
    const f =
      t.world.laneCellBase[t.world.links.find((l) => l.tiles.includes(4 * 7 + 1))!.lanes[0]!]!;
    expect(t.speedCap![f * VEHICLE_TYPE_COUNT + Bike]).toBe(3);
    expect(t.speedCap![f * VEHICLE_TYPE_COUNT + Car]).toBe(2);
  });
});

describe('demand primitives', () => {
  const ofEdge = (d: readonly DemandEvent[], e: number): number =>
    d.filter((x) => x.edge === e).length;

  it('reroute moves exactly percent of an edge’s spawns to the next edge clockwise, or the chosen one', () => {
    const demand = sortDemand(Array.from({ length: 10 }, (_, k) => ev(k * 7, 0, 1)));
    const detour = place('detour', edge(0), [{ kind: 'reroute', percent: 50, to: 'adjacent' }]);
    const out = transformDemand(map, demand, [detour]);
    expect(ofEdge(out, 0)).toBe(5);
    expect(ofEdge(out, 2)).toBe(5);
    const picked = place('detour+', edge(0), [{ kind: 'reroute', percent: 50, to: 'secondary' }], {
      secondaryTarget: edge(6),
    });
    expect(ofEdge(transformDemand(map, demand, [picked]), 6)).toBe(5);
    // A spawn rerouted onto its own destination stays where it was.
    const toTwo = demand.map((d) => ({ ...d, destinationEdge: 2 }));
    expect(ofEdge(transformDemand(map, toTwo, [detour]), 0)).toBe(10);
  });

  it('spawnModifier adds and removes exact shares of a type (Fare Holiday)', () => {
    const demand = sortDemand([
      ...Array.from({ length: 10 }, (_, k) => ev(k * 9, 4, 5, Bus)),
      ...Array.from({ length: 10 }, (_, k) => ev(k * 9 + 1, 6, 7, Car)),
    ]);
    const fare = place('fare-holiday', district, [
      { kind: 'spawnModifier', vehicleType: Bus, percent: 40 },
      { kind: 'spawnModifier', vehicleType: Car, percent: -20 },
    ]);
    const out = transformDemand(map, demand, [fare]);
    expect(out.filter((d) => d.vehicleType === Bus)).toHaveLength(14);
    expect(out.filter((d) => d.vehicleType === Car)).toHaveLength(8);
    expect(out).toEqual(sortDemand(out));
  });

  it('spawnWindow compresses a type into its window (Delivery Window)', () => {
    const demand = sortDemand(
      Array.from({ length: 12 }, (_, k) => ev(k * 25, k % 8, (k + 1) % 8, k % 2 ? Truck : Car)),
    );
    const window = place('delivery-window', district, [
      { kind: 'spawnWindow', vehicleType: Truck, fromTick: 0, toTick: 100 },
    ]);
    const out = transformDemand(map, demand, [window]);
    expect(out.filter((d) => d.vehicleType === Truck).every((d) => d.tick < 100)).toBe(true);
    expect(out.filter((d) => d.vehicleType === Truck)).toHaveLength(6);
    expect(out.filter((d) => d.vehicleType === Car)).toEqual(
      demand.filter((d) => d.vehicleType === Car),
    );
  });

  it('smoothDemand lowers the peak second by peakPermille and keeps every spawn (Staggered Hours)', () => {
    const peaked = sortDemand([
      ...Array.from({ length: 20 }, (_, k) => ev(100 + (k % 20), k % 8, (k + 3) % 8)),
      ...Array.from({ length: 10 }, (_, k) => ev(k * 30, k % 8, (k + 1) % 8)),
    ]);
    const perSecond = (d: readonly DemandEvent[]): number[] => {
      const bins = new Array<number>(15).fill(0);
      for (const x of d) bins[Math.min(14, Math.trunc(x.tick / 20))]!++;
      return bins;
    };
    const peak = Math.max(...perSecond(peaked));
    const out = transformDemand(map, peaked, [
      place('staggered-hours', district, [{ kind: 'smoothDemand', peakPermille: 300 }]),
    ]);
    expect(out).toHaveLength(peaked.length);
    expect(Math.max(...perSecond(out))).toBeLessThanOrEqual(peak - Math.trunc((peak * 3) / 10));
    expect(out.every((d) => d.tick >= 0 && d.tick < ROUND_TICKS)).toBe(true);
  });
});

describe('score and ignored effects', () => {
  it('scoreModifier adds to a type’s score on exit', () => {
    const plus = place('delivery-window+', district, [
      { kind: 'scoreModifier', vehicleType: Truck, delta: 1 },
    ]);
    expect(Sim.simulate(input([ev(0, 0, 1, Truck)], [plus])).throughput).toBe(3);
    expect(Sim.simulate(input([ev(0, 0, 1, Car)], [plus])).throughput).toBe(1);
  });

  it('run-controller effects do not change the traffic', () => {
    const demand = [ev(0, 0, 1), ev(5, 4, 5)];
    const tempo = place('tempo', district, [
      { kind: 'drawModifier', delta: 2 },
      { kind: 'energyModifier', delta: 1, when: 'next-round' },
      { kind: 'costModifier', cards: 'all', next: 1, cost: 0 },
      { kind: 'redraw', keep: 1 },
      { kind: 'fundsModifier', delta: 5 },
    ]);
    const a = Sim.simulate(input(demand));
    const b = Sim.simulate(input(demand, [tempo]));
    expect({ ...b, finalHash: '' }).toEqual({ ...a, finalHash: '' });
  });

  it('rejects forms no Phase 1 card uses', () => {
    for (const bad of [
      place('wave', ix(1, 2), [{ kind: 'setSignalPhase', mode: 'wave' }]),
      place('fog', district, [{ kind: 'scoreModifier', delta: 3, condition: 'above-quota' }]),
      place('ring', district, [{ kind: 'setController', controller: 'roundabout' }]),
      place('hub', seg(1, 3, 1, 5), [{ kind: 'preferType', vehicleType: Bus }]),
      place('nowhere', ix(1, 4), [{ kind: 'setController', controller: 'roundabout' }]),
    ]) {
      expect(() => Sim.init(input([], [bad]))).toThrow(RangeError);
    }
  });
});

const PHASE1 = PHASE1_CARDS;

describe('the 20 Phase 1 cards', () => {
  const base = denseInput(42);
  const dense: RoundInput = {
    ...base,
    map,
    mapId: map.id,
    demandProfile: base.demandProfile
      .map((d) => ({
        ...d,
        edge: d.edge % 8,
        destinationEdge: ((d.edge % 8) + 1 + (d.destinationEdge % 7)) % 8,
      }))
      .sort((a, b) => a.tick - b.tick || a.edge - b.edge),
  };

  it.each(
    PHASE1.flatMap(
      ([id, target, t1, t2]) =>
        [
          [`${id} tier 1`, id, target, t1, 1],
          [`${id} tier 2`, id, target, t2, 2],
        ] as const,
    ),
  )('%s runs and is deterministic', (_name, id, target, effects, tier) => {
    const p = place(id, target, effects, {
      tier,
      ...(id === 'detour' ? { secondaryTarget: edge(6) } : {}),
    });
    const inp = { ...dense, placements: [p] };
    const a = Sim.simulate(inp);
    expect(Sim.simulate(inp)).toEqual(a);
    expect(a.exited).toBeLessThanOrEqual(a.spawned);
  });

  it('property: any set of Phase 1 cards keeps the round deterministic and consistent', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: PHASE1.length * 2 - 1 }), { maxLength: 5 }),
        fc.integer({ min: 0, max: 1000 }),
        (picks, seed) => {
          const placements = picks.map((k, i) => {
            const [id, target, t1, t2] = PHASE1[k >> 1]!;
            return place(id, target, k & 1 ? t2 : t1, {
              order: i,
              tier: k & 1 ? 2 : 1,
              ...(id === 'detour' ? { secondaryTarget: edge(6) } : {}),
            });
          });
          const inp = { ...dense, seed, placements };
          const a = Sim.simulate(inp);
          expect(Sim.simulate(inp)).toEqual(a);
          expect(a.exited).toBeLessThanOrEqual(a.spawned);
          expect(a.fundsDelta).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 40 },
    );
  });
});
