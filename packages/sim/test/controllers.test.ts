import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ADAPTIVE_MIN_GREEN_TICKS,
  ControllerCode,
  DEFAULT_SWITCH_TICKS,
  MAX_VEHICLE_LENGTH,
  PocketMode,
  ROUND_TICKS,
  SIGNAL_GREEN_TICKS,
  Sim,
  UNCONTROLLED_RESOLVE_TICKS,
  VEHICLE_SPECS,
  VehicleType,
  buildWorld,
  controllerSnapshot,
  emptyMap,
  sampleInput,
  type ControllerKind,
  type DemandEvent,
  type GridMap,
  type MapEdge,
  type MapTile,
  type Side,
} from '../src/index.js';
import {
  configureSignal,
  controllerFrame,
  mayEnter,
  setController,
  setResolveTicks,
  setTurnPockets,
} from '../src/controllers.js';
import { createTraffic, tickTraffic, type Traffic } from '../src/traffic.js';

// Plus map edges: 0 = n, 1 = e, 2 = s, 3 = w. North arm 16 cells, west arm 12, east 12, south 16.
const ev = (
  tick: number,
  edge: number,
  destinationEdge: number,
  vehicleType: VehicleType = 0,
): DemandEvent => ({
  tick,
  edge,
  destinationEdge,
  vehicleType,
});
const sorted = (d: DemandEvent[]): DemandEvent[] =>
  [...d].sort((a, b) => a.tick - b.tick || a.edge - b.edge);

/** Runs a traffic scenario on `map`; returns the tick each vehicle's head first entered the box. */
function run(
  map: GridMap,
  demand: DemandEvent[],
  setup: (t: Traffic) => void,
  ticks = ROUND_TICKS,
  each?: (t: Traffic, tick: number) => void,
): { t: Traffic; entered: Map<number, number> } {
  const t = createTraffic(buildWorld(map), sorted(demand));
  t.entryLog = [];
  setup(t);
  for (let tick = 0; tick < ticks; tick++) {
    tickTraffic(t, tick);
    each?.(t, tick);
  }
  // First box entry per vehicle (on multi-intersection maps vehicles enter several boxes).
  const entered = new Map<number, number>();
  for (let k = 0; k < t.entryLog.length; k += 3) {
    if (!entered.has(t.entryLog[k]!)) entered.set(t.entryLog[k]!, t.entryLog[k + 2]!);
  }
  return { t, entered };
}

describe('uncontrolled: first at line, then rightmost', () => {
  it('a vehicle waits UNCONTROLLED_RESOLVE_TICKS at the line; setResolveTicks shortens it', () => {
    const slow = run(emptyMap(), [ev(0, 0, 2)], () => {});
    expect(slow.entered.get(0)).toBe(5 + UNCONTROLLED_RESOLVE_TICKS);
    const fast = run(emptyMap(), [ev(0, 0, 2)], (t) => setResolveTicks(t, 0, 0));
    expect(fast.entered.get(0)).toBe(6); // minimum 1: enters the tick after reaching the line
  });

  it('the first vehicle at the line goes first', () => {
    // East arm is 12 cells: a car spawned at tick k is at the line at k + 4; north at k + 5.
    const { entered, t } = run(emptyMap(), [ev(0, 1, 3), ev(0, 0, 2)], () => {});
    const east = [0, 1].find((i) => t.dest[i] === 3)!;
    const north = 1 - east;
    expect(entered.get(east)!).toBeLessThan(entered.get(north)!);
  });

  it('on a tie, the approach with nobody on its right goes first (north yields to west)', () => {
    // West spawned one tick after north: both reach the line at tick 5.
    const { entered, t } = run(emptyMap(), [ev(0, 0, 2), ev(1, 3, 1)], () => {});
    const north = [0, 1].find((i) => t.dest[i] === 2)!;
    const west = 1 - north;
    expect(entered.get(west)).toBe(5 + UNCONTROLLED_RESOLVE_TICKS);
    expect(entered.get(north)!).toBeGreaterThan(entered.get(west)!);
  });

  it('with all four approaches tied, the lowest side goes first (no deadlock)', () => {
    // North and south arms are 16 cells, east and west 12: stagger spawns so all arrive at tick 5.
    const { entered, t } = run(
      emptyMap(),
      [ev(0, 0, 2), ev(0, 2, 0), ev(1, 1, 3), ev(1, 3, 1)],
      () => {},
    );
    const north = [0, 1, 2, 3].find((i) => t.dest[i] === 2)!;
    expect(entered.get(north)).toBe(5 + UNCONTROLLED_RESOLVE_TICKS);
    expect(Math.min(...entered.values())).toBe(entered.get(north));
  });

  it('emergency vehicles win the grant without waiting', () => {
    const { entered, t } = run(
      emptyMap(),
      [ev(0, 0, 2), ev(1, 3, 1, VehicleType.Emergency)],
      () => {},
    );
    const emergency = [0, 1].find((i) => t.type[i] === VehicleType.Emergency)!;
    expect(entered.get(emergency)).toBe(6);
    expect(entered.get(1 - emergency)!).toBeGreaterThan(6);
  });
});

describe('signal: by phase', () => {
  it('fixed time: n-s green first, then all-red, then e-w', () => {
    const frames: Uint8Array[] = [];
    const { entered, t } = run(
      emptyMap(),
      [ev(0, 1, 3), ev(0, 0, 2)],
      (tr) => setController(tr, 0, 'signal'),
      120,
      (tr) => frames.push(controllerFrame(tr)),
    );
    const east = [0, 1].find((i) => t.dest[i] === 3)!;
    expect(entered.get(1 - east)).toBe(6); // north rolls through on green without waiting
    // East waits for SIGNAL_GREEN_TICKS of n-s green plus the all-red.
    expect(entered.get(east)).toBe(SIGNAL_GREEN_TICKS + DEFAULT_SWITCH_TICKS);
    expect(frames[0]).toEqual(new Uint8Array([ControllerCode.Signal, 0b0101, 0]));
    expect(frames[SIGNAL_GREEN_TICKS]![1]).toBe(0); // all-red
    expect(frames[SIGNAL_GREEN_TICKS + DEFAULT_SWITCH_TICKS]![1]).toBe(0b1010);
  });

  it('switch time follows configureSignal, including an instant switch', () => {
    const { entered } = run(emptyMap(), [ev(0, 1, 3)], (tr) => {
      setController(tr, 0, 'signal');
      configureSignal(tr, 0, false, 0);
    });
    expect(entered.get(0)).toBe(SIGNAL_GREEN_TICKS);
    const neg = run(emptyMap(), [ev(0, 1, 3)], (tr) => {
      setController(tr, 0, 'signal');
      configureSignal(tr, 0, false, -3);
    });
    expect(neg.entered.get(0)).toBe(SIGNAL_GREEN_TICKS);
  });

  it('adaptive: the longest queue gets green after the minimum green', () => {
    const { entered } = run(emptyMap(), [ev(0, 1, 3)], (tr) => {
      setController(tr, 0, 'signal');
      configureSignal(tr, 0, true);
    });
    // East is the only queue: the phase switches at ADAPTIVE_MIN_GREEN_TICKS, then all-red.
    expect(entered.get(0)).toBe(ADAPTIVE_MIN_GREEN_TICKS + DEFAULT_SWITCH_TICKS);
  });

  it('adaptive: green stays while the other phase is empty, and caps at the max green', () => {
    const demand = Array.from({ length: 40 }, (_, k) => ev(k * 2, 0, 2));
    const frames: number[] = [];
    run(
      emptyMap(),
      [...demand, ev(0, 1, 3)],
      (tr) => {
        setController(tr, 0, 'signal');
        configureSignal(tr, 0, true);
      },
      200,
      (tr) => frames.push(tr.sigPhase[0]!),
    );
    expect(frames.indexOf(1)).toBeGreaterThan(ADAPTIVE_MIN_GREEN_TICKS);
  });

  it('emergency vehicles ignore red', () => {
    const { entered } = run(emptyMap(), [ev(0, 1, 3, VehicleType.Emergency)], (tr) =>
      setController(tr, 0, 'signal'),
    );
    expect(entered.get(0)).toBeLessThan(10);
  });
});

describe('roundabout, stop-all and priority', () => {
  const heavy = Array.from({ length: 60 }, (_, k) => ev(k * 2, k % 4, (k + 1 + (k % 3)) % 4));

  it('roundabout: no wait at an empty line; occupancy never exceeds capacity', () => {
    const lone = run(emptyMap(), [ev(0, 0, 2)], (t) => setController(t, 0, 'roundabout'));
    expect(lone.entered.get(0)).toBe(6);
    for (const capacity of [1, 2, 4]) {
      let max = 0;
      const r = run(
        emptyMap(),
        heavy,
        (t) => setController(t, 0, 'roundabout', { capacity }),
        ROUND_TICKS,
        (t) => {
          max = Math.max(max, t.boxCount[0]!);
        },
      );
      expect(max).toBeLessThanOrEqual(capacity);
      expect(r.t.exited).toBeGreaterThan(10);
    }
  });

  it('roundabout: inside has priority over an entering vehicle', () => {
    const world = buildWorld(emptyMap());
    const t = createTraffic(world, []);
    setController(t, 0, 'roundabout');
    // From the south (heading north) a vehicle enters at SE (quarter 1); circulating traffic
    // reaches SE from SW (quarter 2), so SW must be free.
    const box = world.movementLane[0 * 16 + 2 * 4 + 0]!;
    expect(world.cellPhys[world.laneCellBase[box]!]! - t.boxBase).toBe(1);
    expect(mayEnter(t, 0, 0, 2, box)).toBe(true);
    t.occ[t.boxBase + 2] = 99;
    expect(mayEnter(t, 0, 0, 2, box)).toBe(false);
    t.occ[t.boxBase + 2] = 0;
    t.occ[t.boxBase + 0] = 99; // downstream traffic does not block entry by priority
    expect(mayEnter(t, 0, 0, 2, box)).toBe(true);
    t.boxCount[0] = 4;
    expect(mayEnter(t, 0, 0, 2, box)).toBe(false);
  });

  it('stop-all: every vehicle stops at the line and the box holds one vehicle at a time', () => {
    let max = 0;
    const speedsAtEntry: number[] = [];
    const prevSpeed = new Map<number, number>();
    const r = run(
      emptyMap(),
      heavy,
      (t) => setController(t, 0, 'stop-all'),
      ROUND_TICKS,
      (t) => {
        max = Math.max(max, t.boxCount[0]!);
        for (let k = 0; k < t.orderLen; k++) {
          const i = t.order[k]!;
          if (t.laneKind[t.lane[i]!] === 1 && t.cell[i] === 0 && !speedsAtEntry[i])
            speedsAtEntry[i] = prevSpeed.get(i) ?? -1;
          prevSpeed.set(i, t.speed[i]!);
        }
      },
    );
    expect(max).toBe(1);
    expect(r.t.exited).toBeGreaterThan(5);
    expect(speedsAtEntry.filter((s) => s !== undefined).every((s) => s === 0)).toBe(true);
  });

  it('priority(n): the n-s road never stops; the minor road waits for a gap', () => {
    // A dense major stream (one car per tick from the north) never leaves a one-tile gap.
    const major = Array.from({ length: 20 }, (_, k) => ev(k, 0, 2));
    const { t, entered } = run(emptyMap(), [...major, ev(0, 1, 3)], (tr) =>
      setController(tr, 0, 'priority', { direction: 'n' }),
    );
    const minor = [...Array(t.count).keys()].find((i) => t.dest[i] === 3)!;
    const lastMajor = Math.max(...[...entered].filter(([i]) => i !== minor).map(([, k]) => k));
    expect(entered.get(minor)!).toBeGreaterThan(lastMajor);
    expect(t.exited).toBe(21);
    const lone = run(emptyMap(), [ev(0, 0, 2)], (tr) =>
      setController(tr, 0, 'priority', { direction: 's' }),
    );
    expect(lone.entered.get(0)).toBe(6);
    const eastMajor = run(emptyMap(), [ev(0, 1, 3)], (tr) =>
      setController(tr, 0, 'priority', { direction: 'e' }),
    );
    expect(eastMajor.entered.get(0)).toBe(4); // 12-cell arm: rolls straight through at speed
  });
});

describe('vehicle behaviours at intersections', () => {
  it('a turning truck blocks its intersection to new entries; a straight truck does not', () => {
    for (const [dest, turning] of [
      [1, true],
      [2, false],
    ] as const) {
      let violations = 0;
      let sawTruckInBox = false;
      run(
        emptyMap(),
        [ev(0, 0, dest, VehicleType.Truck), ev(0, 2, 0), ev(4, 2, 0)],
        (t) => setController(t, 0, 'roundabout', { capacity: 4 }),
        80,
        (t) => {
          if (t.truckTurning[0]! > 0) sawTruckInBox = true;
          if (t.truckTurning[0]! > 0 && t.boxCount[0]! > 1) violations++;
        },
      );
      expect(sawTruckInBox).toBe(turning);
      expect(violations).toBe(0);
    }
  });

  it('turn pockets take turners off the through lane (left only, or both)', () => {
    for (const [mode, dest, pocket] of [
      [PocketMode.Left, 1, true], // north heading south, east is a left turn
      [PocketMode.Left, 3, false], // right turn without pocket
      [PocketMode.Both, 3, true],
      [PocketMode.Both, 2, false], // straight never uses it
    ] as const) {
      let used = false;
      run(
        emptyMap(),
        [ev(0, 0, dest)],
        (t) => setTurnPockets(t, 0, mode),
        40,
        (t) => {
          if (t.count > 0 && t.lane[0]! >= t.world.pocketLanes) used = true;
        },
      );
      expect(used).toBe(pocket);
    }
    // While a left-turner waits in the pocket, a straight car behind it reaches the line.
    let both = false;
    run(
      emptyMap(),
      [ev(0, 0, 1), ev(1, 0, 2)],
      (t) => setTurnPockets(t, 0, PocketMode.Left),
      40,
      (t) => {
        if (t.lane[0]! >= t.world.pocketLanes && t.cell[1] === 15 && t.lane[1]! < t.world.roadLanes)
          both = true;
      },
    );
    expect(both).toBe(true);
  });
});

describe('Sim integration', () => {
  it('controllerSnapshot reports each intersection; default is uncontrolled', () => {
    const s = Sim.init(sampleInput(1));
    expect(controllerSnapshot(s)).toEqual(new Uint8Array([ControllerCode.Uncontrolled, 0, 0]));
  });
});

describe('property: random controllers on lattice maps', () => {
  function lattice(cols: number[], rows: number[]): GridMap {
    const tiles: MapTile[] = [];
    for (let y = 0; y < 9; y++)
      for (let x = 0; x < 7; x++)
        tiles.push(
          cols.includes(x) || rows.includes(y) ? { kind: 'road', lanes: 1 } : { kind: 'block' },
        );
    const edges: MapEdge[] = [];
    for (const x of cols) {
      edges.push({ id: edges.length, tile: { x, y: 0 }, side: 'n' });
      edges.push({ id: edges.length, tile: { x, y: 8 }, side: 's' });
    }
    for (const y of rows) {
      edges.push({ id: edges.length, tile: { x: 0, y }, side: 'w' });
      edges.push({ id: edges.length, tile: { x: 6, y }, side: 'e' });
    }
    return { id: `lat-${cols}-${rows}`, tiles, edges };
  }
  const map = lattice([1, 5], [2, 6]);
  const kinds: ControllerKind[] = ['uncontrolled', 'signal', 'roundabout', 'stop-all', 'priority'];
  const sides: Side[] = ['n', 'e', 's', 'w'];

  it('occupancy stays exact, capacities hold, and runs are deterministic', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            kind: fc.integer({ min: 0, max: 4 }),
            side: fc.integer({ min: 0, max: 3 }),
            adaptive: fc.boolean(),
            pocket: fc.integer({ min: 0, max: 2 }),
          }),
          { minLength: 4, maxLength: 4 },
        ),
        fc.array(
          fc.record({
            tick: fc.integer({ min: 0, max: 299 }),
            edge: fc.integer({ min: 0, max: 7 }),
            off: fc.integer({ min: 1, max: 7 }),
            type: fc.integer({ min: 0, max: 5 }),
          }),
          { maxLength: 70 },
        ),
        (ctrl, events) => {
          const demand = events.map((e) =>
            ev(e.tick, e.edge, (e.edge + e.off) % 8, e.type as VehicleType),
          );
          const setup = (t: Traffic): void =>
            ctrl.forEach((c, ix) => {
              setController(t, ix, kinds[c.kind]!, { direction: sides[c.side]! });
              configureSignal(t, ix, c.adaptive);
              setTurnPockets(t, ix, c.pocket);
            });
          const hashes: string[] = [];
          for (let rep = 0; rep < 2; rep++) {
            const r = run(map, demand, setup, ROUND_TICKS, (t) => {
              const occ = new Int32Array(t.occ.length);
              for (let k = 0; k < t.orderLen; k++) {
                const i = t.order[k]!;
                const len = VEHICLE_SPECS[t.type[i]!]!.length;
                for (let j = 0; j < len; j++) {
                  const p = t.tail[i * MAX_VEHICLE_LENGTH + j]!;
                  if (p < 0) continue;
                  if (occ[p]) throw new Error('cell held twice');
                  occ[p] = i + 1;
                }
              }
              for (let p = 0; p < occ.length; p++)
                if (occ[p] !== t.occ[p]) throw new Error('occupancy mismatch');
              for (let ix = 0; ix < 4; ix++) {
                if (t.boxCount[ix]! < 0) throw new Error('negative box count');
                if (
                  t.ctrlKind[ix] === ControllerCode.Roundabout &&
                  t.boxCount[ix]! > t.ctrlCapacity[ix]!
                )
                  throw new Error('over capacity');
                if (t.ctrlKind[ix] === ControllerCode.StopAll && t.boxCount[ix]! > 1)
                  throw new Error('stop-all overlap');
              }
            });
            hashes.push(`${r.t.exited}:${r.t.throughput}:${[...r.entered].join(',')}`);
          }
          expect(hashes[0]).toBe(hashes[1]);
        },
      ),
      { numRuns: 40 },
    );
  }, 60_000);
});
