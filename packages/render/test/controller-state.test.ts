import { describe, expect, it } from 'vitest';
import {
  ControllerCode,
  SNAPSHOT_HEADER,
  buildWorld,
  controllerSnapshot,
  Sim,
  emptyMap,
  sampleInput,
  type Placement,
} from '@rushwarden/sim';
import {
  BOX_CAPACITY,
  CONTROLLER_STRIDE,
  STOP_BAR,
  boxAlpha,
  readControllers,
  stopBars,
  type LiveIntersection,
} from '../src/controller-state.js';
import { FAKE_ALL_RED_TICKS, fakeControllerFrame } from '../src/worker/fake-handler.js';
import { roadWidth, lanesAt } from '../src/geometry.js';
import { tileLaneId } from '../src/lanes.js';

const map = emptyMap();
const world = buildWorld(map);

describe('controllers frames (ADR-020 point 10)', () => {
  it('decode [kind, greenMask, boxCount] per intersection in world order', () => {
    const ix = world.intersections[0]!;
    const frame = new Uint8Array([ControllerCode.Signal, 0b0101, 3]);
    expect(readControllers(frame, world)).toEqual([
      { x: ix.x, y: ix.y, kind: 'signal', green: ['n', 's'], box: 3 },
    ]);
    const kinds = [
      [ControllerCode.Uncontrolled, 'uncontrolled'],
      [ControllerCode.Roundabout, 'roundabout'],
      [ControllerCode.StopAll, 'stop-all'],
      [ControllerCode.Priority, 'priority'],
      [99, 'uncontrolled'],
    ] as const;
    for (const [code, kind] of kinds)
      expect(readControllers(new Uint8Array([code, 0, 0]), world)[0]?.kind).toBe(kind);
  });

  it('ignore a short frame and intersections the frame does not cover', () => {
    expect(readControllers(new Uint8Array(2), world)).toEqual([]);
    expect(readControllers(new Uint8Array(CONTROLLER_STRIDE * 5), world)).toHaveLength(
      world.intersections.length,
    );
  });

  it('decode what the sim sends with no controller cards: uncontrolled, box count moving', () => {
    let s = Sim.init(sampleInput(6));
    let maxBox = 0;
    for (let t = 0; t < 400; t++) {
      s = Sim.step(s);
      for (const l of readControllers(controllerSnapshot(s), world)) {
        expect(l.kind).toBe('uncontrolled');
        expect(l.green).toEqual([]);
        maxBox = Math.max(maxBox, l.box);
      }
    }
    expect(maxBox).toBeGreaterThan(0);
  });
});

describe('controllers frames from the sim with a controller card (#32)', () => {
  it('report the signal and both phases', () => {
    const ix = world.intersections[0]!;
    const input = {
      ...sampleInput(6),
      placements: [
        {
          cardId: 'smart-signal',
          tier: 1 as const,
          target: { kind: 'intersection' as const, tile: { x: ix.x, y: ix.y } },
          effects: [{ kind: 'setController' as const, controller: 'signal' as const }],
          order: 0,
        },
      ],
    };
    let s = Sim.init(input);
    const phases = new Set<string>();
    while (!s.done) {
      s = Sim.step(s);
      const l = readControllers(controllerSnapshot(s), world)[0]!;
      expect(l.kind).toBe('signal');
      phases.add(l.green.join(''));
    }
    expect(phases).toContain('ns');
    expect(phases).toContain('ew');
  });
});

describe('signal stop bars', () => {
  const ix = world.intersections[0]!;
  const live = (green: LiveIntersection['green']): LiveIntersection => ({
    x: ix.x,
    y: ix.y,
    kind: 'signal',
    green,
    box: 0,
  });

  it('put one bar per approach, just outside the box, across the inbound lanes', () => {
    const bars = stopBars(map, live(['n', 's']));
    expect(bars.map((b) => b.side).sort()).toEqual(['e', 'n', 's', 'w']);
    const hw = roadWidth(lanesAt(map, ix.x, ix.y)) / 2;
    const cx = ix.x + 0.5;
    const cy = ix.y + 0.5;
    const north = bars.find((b) => b.side === 'n')!;
    // Southbound traffic from the north keeps right, which is the west half.
    expect(north.x + north.w).toBeCloseTo(cx);
    expect(north.x).toBeLessThan(cx);
    expect(north.y + north.h).toBeCloseTo(cy - hw);
    expect(north.h).toBeCloseTo(STOP_BAR);
    const east = bars.find((b) => b.side === 'e')!;
    // Westbound traffic from the east keeps right, which is the north half.
    expect(east.y + east.h).toBeCloseTo(cy);
    expect(east.x).toBeCloseTo(cx + hw);
    expect(east.w).toBeCloseTo(STOP_BAR);
  });

  it('are green for green approaches and red otherwise, all red in clearance', () => {
    const g = (bars: ReturnType<typeof stopBars>): Record<string, boolean> =>
      Object.fromEntries(bars.map((b) => [b.side, b.green]));
    expect(g(stopBars(map, live(['n', 's'])))).toEqual({ n: true, e: false, s: true, w: false });
    expect(Object.values(g(stopBars(map, live([]))))).toEqual([false, false, false, false]);
  });

  it('are not drawn for other controller kinds', () => {
    expect(stopBars(map, { ...live(['n']), kind: 'roundabout' })).toEqual([]);
    expect(stopBars(map, { ...live([]), kind: 'uncontrolled' })).toEqual([]);
  });
});

describe('box occupancy tint', () => {
  it('rises per vehicle and caps when the box is full', () => {
    expect(boxAlpha(0)).toBe(0);
    expect(boxAlpha(Number.NaN)).toBe(0);
    const a = [1, 2, 3, 4].map(boxAlpha);
    for (let i = 1; i < a.length; i++) expect(a[i]).toBeGreaterThan(a[i - 1]!);
    expect(boxAlpha(BOX_CAPACITY + 3)).toBe(boxAlpha(BOX_CAPACITY));
    expect(boxAlpha(BOX_CAPACITY)).toBeLessThanOrEqual(0.5);
  });
});

describe('fake controller frames (dev page)', () => {
  const ix = world.intersections[0]!;
  const signal: Placement = {
    cardId: 'x',
    tier: 1,
    target: { kind: 'intersection', tile: { x: ix.x, y: ix.y } },
    effects: [{ kind: 'setController', controller: 'signal' }],
    order: 0,
  };
  const snap = (tick: number, lanes: number[]): Uint16Array => {
    const out = new Uint16Array(SNAPSHOT_HEADER + lanes.length * 5);
    out[0] = tick;
    out[1] = lanes.length;
    lanes.forEach((lane, k) => (out[SNAPSHOT_HEADER + k * 5 + 1] = lane));
    return out;
  };

  it('takes the kind from setController placements and alternates signal phases', () => {
    const at = (tick: number): LiveIntersection =>
      readControllers(
        fakeControllerFrame({ placements: [signal] }, world, snap(tick, [])),
        world,
      )[0]!;
    expect(at(1)).toMatchObject({ kind: 'signal', green: ['n', 's'] });
    expect(at(40 + FAKE_ALL_RED_TICKS - 1).green).toEqual([]);
    expect(at(40 + FAKE_ALL_RED_TICKS).green).toEqual(['e', 'w']);
    expect(
      readControllers(fakeControllerFrame({ placements: [] }, world, snap(1, [])), world)[0]?.kind,
    ).toBe('uncontrolled');
  });

  it('counts vehicles on the intersection tile', () => {
    const inBox = tileLaneId(ix.x, ix.y, 's', 0);
    const outside = tileLaneId(ix.x, ix.y - 1, 's', 0);
    const f = fakeControllerFrame({ placements: [] }, world, snap(5, [inBox, inBox, outside]));
    expect(readControllers(f, world)[0]?.box).toBe(2);
  });
});
