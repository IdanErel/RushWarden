import { describe, expect, it } from 'vitest';
import { CELLS_PER_TILE, VehicleType, buildWorld, emptyMap } from '@rushwarden/sim';
import {
  SnapshotBuffer,
  TICK_MS,
  lerpAngle,
  snapshotCount,
  type VehiclePose,
} from '../src/interpolate.js';
import { tileLaneId, tileLaneLayout, worldLaneLayout } from '../src/lanes.js';
import { connections, isIntersection, lanesAt, roadWidth } from '../src/geometry.js';
import { VEHICLE_LENGTH } from '../src/shapes.js';
import { snap } from './helpers.js';

const N = tileLaneId(3, 2, 'n', 0);
const E = tileLaneId(4, 4, 'e', 0);

function setup(): SnapshotBuffer {
  return new SnapshotBuffer(tileLaneLayout(emptyMap()));
}

describe('SnapshotBuffer', () => {
  it('draws nothing before the first snapshot', () => {
    expect(setup().sample(0, [])).toBe(0);
    expect(setup().tick).toBe(-1);
  });

  it('shows the only snapshot as is', () => {
    const b = setup();
    b.push(snap(1, [[7, N, 0, 1, 0]]), 0);
    const out: VehiclePose[] = [];
    expect(b.sample(10, out)).toBe(1);
    expect(out[0]).toMatchObject({ id: 7, type: 0, speed: 1 });
    expect(b.alpha(10)).toBe(1);
  });

  it('interpolates between the last two snapshots', () => {
    const b = setup();
    b.push(snap(1, [[7, N, 0, 1, 0]]), 0);
    b.push(snap(2, [[7, N, 2, 2, 0]]), 100);
    const out: VehiclePose[] = [];
    b.sample(100, out);
    const y0 = out[0]!.y;
    b.sample(100 + TICK_MS / 2, out);
    const yMid = out[0]!.y;
    b.sample(100 + TICK_MS, out);
    const y1 = out[0]!.y;
    expect(y0).toBeCloseTo(2.875);
    expect(y1).toBeCloseTo(2.375);
    expect(yMid).toBeCloseTo((y0 + y1) / 2);
  });

  it('never predicts past the newest snapshot', () => {
    const b = setup();
    b.push(snap(1, [[7, N, 0, 1, 0]]), 0);
    b.push(snap(2, [[7, N, 2, 2, 0]]), 100);
    const out: VehiclePose[] = [];
    b.sample(100 + TICK_MS, out);
    const at1 = out[0]!.y;
    b.sample(100 + 10 * TICK_MS, out);
    expect(out[0]!.y).toBe(at1);
    expect(b.alpha(50)).toBe(0);
  });

  it('respects the tick length at 2×', () => {
    const b = setup();
    b.tickMs = TICK_MS / 2;
    b.push(snap(1, []), 0);
    b.push(snap(2, []), 0);
    expect(b.alpha(TICK_MS / 4)).toBeCloseTo(0.5);
  });

  it('shows new vehicles at their position and drops exited ones', () => {
    const b = setup();
    b.push(snap(1, [[1, N, 0, 1, 0]]), 0);
    b.push(snap(2, [[2, E, 1, 0, 3]]), 0);
    const out: VehiclePose[] = [];
    expect(b.sample(10, out)).toBe(1);
    expect(out[0]).toMatchObject({ id: 2, type: 3 });
  });

  it('snaps instead of sliding across the map', () => {
    const b = setup();
    b.push(snap(1, [[1, tileLaneId(3, 8, 'n', 0), 0, 1, 0]]), 0);
    b.push(snap(2, [[1, tileLaneId(3, 0, 'n', 0), 0, 1, 0]]), 0);
    const out: VehiclePose[] = [];
    b.sample(TICK_MS / 2, out);
    expect(out[0]!.y).toBeLessThan(1);
  });

  it('skips cells that are not on the map', () => {
    const b = setup();
    b.push(snap(1, [[1, tileLaneId(0, 0, 'n', 0), 0, 1, 0]]), 0);
    expect(b.sample(0, [])).toBe(0);
  });

  it('ignores stale snapshots and restarts on tick 0', () => {
    const b = setup();
    b.push(snap(5, []), 0);
    b.push(snap(4, []), 0);
    expect(b.tick).toBe(5);
    b.push(snap(0, [[1, N, 0, 0, 0]]), 0);
    expect(b.tick).toBe(0);
    expect(b.alpha(0)).toBe(1); // no previous after a reset
  });

  it('does not trust a count header longer than the buffer', () => {
    const s = snap(1, [[1, N, 0, 0, 0]]);
    s[1] = 50;
    expect(snapshotCount(s)).toBe(1);
  });
});

describe('lerpAngle', () => {
  it('takes the short way round', () => {
    expect(lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5)).toBeCloseTo(Math.PI);
    expect(lerpAngle(-Math.PI + 0.1, Math.PI - 0.1, 0.5)).toBeCloseTo(-Math.PI);
    expect(lerpAngle(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4);
  });
});

describe('multi-cell vehicles through a turn (body follows the path)', () => {
  const map = emptyMap();
  const world = buildWorld(map);
  const layout = worldLaneLayout(world);

  /** True when (x, y) in tile units is on asphalt: inside a road band or an intersection box. */
  function onRoad(x: number, y: number): boolean {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    const lanes = lanesAt(map, tx, ty);
    if (lanes === 0) return false;
    const half = roadWidth(lanes) / 2 + 0.02;
    const dx = Math.abs(x - tx - 0.5);
    const dy = Math.abs(y - ty - 0.5);
    // Intersection tiles: the box square, plus the road bands running into it.
    if (isIntersection(map, tx, ty) && dx <= half && dy <= half) return true;
    const sides = connections(map, tx, ty);
    const horizontal = sides.includes('e') || sides.includes('w');
    const vertical = sides.includes('n') || sides.includes('s');
    return (horizontal && dy <= half) || (vertical && dx <= half);
  }

  it('keeps a truck and a bus on the road at every step of every turn', () => {
    const cellLen = 1 / CELLS_PER_TILE;
    const out: VehiclePose[] = [];
    for (const lane of world.lanes.filter((l) => l.kind === 'box')) {
      const ix = world.intersections[lane.intersection]!;
      const outLink = world.links[ix.outLinks[lane.exitDir]!]!;
      // The head's path: through the box, then the first cells of the exit lane.
      const path: [number, number][] = [];
      for (let c = 0; c < lane.cells; c++) path.push([lane.id, c]);
      for (let c = 0; c < 3; c++) path.push([outLink.lanes[0]!, c]);
      for (const type of [VehicleType.Truck, VehicleType.Bus]) {
        const len = VEHICLE_LENGTH[type];
        for (let k = 1; k < path.length; k++) {
          const b = new SnapshotBuffer(layout);
          const [pl, pc] = path[k - 1]!;
          const [cl, cc] = path[k]!;
          b.push(snap(1, [[1, pl, pc, 1, type]]), 0);
          b.push(snap(2, [[1, cl, cc, 1, type]]), 100);
          for (const at of [100, 100 + TICK_MS / 2, 100 + TICK_MS]) {
            b.sample(at, out);
            const p = out[0]!;
            // Head cell centre, body middle and tail cell centre, as the scene draws them.
            for (let i = 0; i < len; i++) {
              const x = p.x - Math.cos(p.heading) * i * cellLen;
              const y = p.y - Math.sin(p.heading) * i * cellLen;
              expect(onRoad(x, y), `type ${type} lane ${cl}:${cc} t=${at} body ${i}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it('points a long vehicle from its tail cell to its head cell', () => {
    const lane = world.lanes.find((l) => l.kind === 'box' && l.cells === 1)!;
    const b = new SnapshotBuffer(layout);
    b.push(snap(1, [[1, lane.id, 0, 1, VehicleType.Truck]]), 0);
    const out: VehiclePose[] = [];
    b.sample(0, out);
    const head = { x: 0, y: 0, heading: 0 };
    const tail = { x: 0, y: 0, heading: 0 };
    layout.cellPoint(lane.id, 0, head);
    expect(layout.backPoint(lane.id, 0, 2, tail)).toBe(true);
    expect(out[0]!.heading).toBeCloseTo(Math.atan2(head.y - tail.y, head.x - tail.x));
    // A car (1 cell) keeps the lane's own heading.
    b.push(snap(2, [[1, lane.id, 0, 1, VehicleType.Car]]), 50);
    b.sample(1000, out);
    expect(out[0]!.heading).toBeCloseTo(head.heading);
  });
});
