import { describe, expect, it } from 'vitest';
import { emptyMap } from '@rushwarden/sim';
import {
  SnapshotBuffer,
  TICK_MS,
  lerpAngle,
  snapshotCount,
  type VehiclePose,
} from '../src/interpolate.js';
import { tileLaneId, tileLaneLayout } from '../src/lanes.js';
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
