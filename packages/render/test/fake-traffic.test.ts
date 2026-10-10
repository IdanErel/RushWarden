import { describe, expect, it } from 'vitest';
import { ROUND_TICKS, SNAPSHOT_HEADER, SNAPSHOT_STRIDE, emptyMap } from '@rushwarden/sim';
import { FakeTraffic, buildRoute, fakeDemand } from '../src/fake-traffic.js';
import { tileLaneLayout, type LanePoint } from '../src/lanes.js';

const VMAX = [3, 3, 2, 2, 4, 2]; // car, taxi, bus, truck, emergency, bike

function run(seed: number, ticks = ROUND_TICKS): Uint16Array[] {
  let s = FakeTraffic.init(emptyMap(), seed);
  const out: Uint16Array[] = [];
  for (let i = 0; i < ticks && !s.done; i++) {
    s = FakeTraffic.step(s);
    out.push(FakeTraffic.snapshot(s));
  }
  return out;
}

function rows(s: Uint16Array): number[][] {
  const r: number[][] = [];
  for (let i = 0; i < s[1]!; i++) {
    const o = SNAPSHOT_HEADER + i * SNAPSHOT_STRIDE;
    r.push([...s.subarray(o, o + SNAPSHOT_STRIDE)]);
  }
  return r;
}

describe('fake traffic', () => {
  it('is deterministic from the seed', () => {
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });

  it('runs one round and emits the Sim.snapshot format', () => {
    const snaps = run(1);
    expect(snaps).toHaveLength(ROUND_TICKS);
    snaps.forEach((s, i) => {
      expect(s[0]).toBe(i + 1);
      expect(s.length).toBe(SNAPSHOT_HEADER + s[1]! * SNAPSHOT_STRIDE);
    });
  });

  it('spawns every vehicle type and keeps traffic flowing', () => {
    const snaps = run(3);
    const types = new Set(snaps.flatMap((s) => rows(s).map((r) => r[4])));
    expect([...types].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(Math.max(...snaps.map((s) => s[1]!))).toBeGreaterThan(5);
  });

  it('never puts two vehicle heads in one cell and respects vmax', () => {
    for (const s of run(11)) {
      const cells = rows(s).map((r) => `${r[1]}:${r[2]}`);
      expect(new Set(cells).size).toBe(cells.length);
      for (const r of rows(s)) expect(r[3]).toBeLessThanOrEqual(VMAX[r[4]!]!);
    }
  });

  it('only uses cells that exist on the map', () => {
    const layout = tileLaneLayout(emptyMap());
    const p: LanePoint = { x: 0, y: 0, heading: 0 };
    for (const s of run(5))
      for (const r of rows(s)) expect(layout.cellPoint(r[1]!, r[2]!, p)).toBe(true);
  });

  it('builds connected routes between edges', () => {
    const map = emptyMap();
    const layout = tileLaneLayout(map);
    const [a, b] = [map.edges[0]!, map.edges[1]!];
    expect(buildRoute(map, a, a)).toBeNull();
    const route = buildRoute(map, a, b)!;
    expect(route.length).toBe(4 * 8); // 5 tiles down + 3 tiles across, 4 cells each
    const p: LanePoint = { x: 0, y: 0, heading: 0 };
    const q: LanePoint = { x: 0, y: 0, heading: 0 };
    for (let i = 1; i < route.length; i++) {
      layout.cellPoint(route[i - 1]!.lane, route[i - 1]!.cell, p);
      layout.cellPoint(route[i]!.lane, route[i]!.cell, q);
      expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeLessThan(0.45);
    }
  });

  it('stops when the round ends and ignores further steps', () => {
    let s = FakeTraffic.init(emptyMap(), 1, { ticks: 3, spawnPermille: 1000 });
    for (let i = 0; i < 5; i++) s = FakeTraffic.step(s);
    expect(s.done).toBe(true);
    expect(s.tick).toBe(3);
    expect(s.spawned).toBeGreaterThan(0);
  });

  it('lets vehicles reach their exit', () => {
    let s = FakeTraffic.init(emptyMap(), 2);
    while (!s.done) s = FakeTraffic.step(s);
    expect(s.exited).toBeGreaterThan(10);
  });
});

describe('fake traffic with a demand profile', () => {
  const map = emptyMap();

  it('generates a deterministic, sorted demo profile with a peak per edge', () => {
    const d = fakeDemand(map, 4);
    expect(d).toEqual(fakeDemand(map, 4));
    expect(d.length).toBeGreaterThan(50);
    for (let i = 1; i < d.length; i++) {
      const a = d[i - 1]!;
      const b = d[i]!;
      expect(a.tick < b.tick || (a.tick === b.tick && a.edge < b.edge)).toBe(true);
    }
    for (const e of d) expect(e.destinationEdge).not.toBe(e.edge);
  });

  it('spawns exactly the profile, in order, waiting when the edge is busy', () => {
    const demand = [
      { tick: 0, edge: 0, vehicleType: 2, destinationEdge: 2 },
      { tick: 0, edge: 0, vehicleType: 0, destinationEdge: 2 }, // same edge, same tick: waits
      { tick: 3, edge: 1, vehicleType: 5, destinationEdge: 3 },
      { tick: 4, edge: 1, vehicleType: 0, destinationEdge: 99 }, // no route: dropped
    ] as const;
    let s = FakeTraffic.init(map, 1, { demand });
    s = FakeTraffic.step(s);
    expect(rows(FakeTraffic.snapshot(s)).map((r) => r[4])).toEqual([2]);
    for (let i = 0; i < 10; i++) s = FakeTraffic.step(s);
    expect(s.spawned).toBe(3);
    expect(s.waiting).toEqual([]);
  });

  it('ends a jammed round as gridlock after 60 still ticks', () => {
    let s = FakeTraffic.init(map, 2, { demand: fakeDemand(map, 2), jam: true });
    while (!s.done) s = FakeTraffic.step(s);
    expect(s.gridlocked).toBe(true);
    expect(s.tick).toBeLessThan(ROUND_TICKS);
    expect(s.exited).toBe(0);
  });
});

describe('fake throughput', () => {
  it('sums §3 score values of exited vehicles', () => {
    let s = FakeTraffic.init(emptyMap(), 8, { demand: fakeDemand(emptyMap(), 8) });
    while (!s.done) s = FakeTraffic.step(s);
    expect(s.throughput).toBeGreaterThan(s.exited); // buses, trucks, emergencies count more
  });
});
