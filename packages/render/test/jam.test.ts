import { describe, expect, it } from 'vitest';
import {
  GRIDLOCK_TICKS,
  CELLS_PER_TILE,
  GRID_WIDTH,
  SNAPSHOT_HEADER,
  SNAPSHOT_STRIDE,
  Sim,
  denseInput,
  latticeMap,
  roundWorld,
  type RoundInput,
  type World,
} from '@rushwarden/sim';
import { JamTracer } from '../src/jam.js';
import { tileLaneId, tileLaneLayout, worldLaneLayout } from '../src/lanes.js';
import { snap } from './helpers.js';

// Junctions at (1, 2), (5, 2), (1, 6) and (5, 6).
const map = latticeMap('jam-test', [1, 5], [2, 6]);
const tracer = (): JamTracer => new JamTracer(map, tileLaneLayout(map));

/** A vehicle row on the provisional layout: tile (x, y), heading `dir`, at `cell`, `speed`. */
const car = (
  id: number,
  x: number,
  y: number,
  dir: 'n' | 'e' | 's' | 'w',
  speed: number,
  cell = 3,
): number[] => [id, tileLaneId(x, y, dir, 0), cell, speed, 0];

describe('JamTracer', () => {
  it('nothing is stuck before any vehicle waits', () => {
    const t = tracer();
    expect(t.origin()).toBeNull();
    t.push(snap(1, [car(1, 0, 2, 'e', 2)]));
    expect(t.origin()).toBeNull();
  });

  it('the junction that got stuck first is the origin, not the one with the longer queue', () => {
    const t = tracer();
    // Tick 3: one car waits west of (5, 2), heading east into it.
    t.push(snap(3, [car(1, 4, 2, 'e', 0)]));
    // Tick 5: three cars wait at (1, 6), and (5, 2) is still stuck.
    const later = [
      car(1, 4, 2, 'e', 0),
      car(2, 1, 5, 's', 0),
      car(3, 0, 6, 'e', 0),
      car(4, 1, 6, 'n', 0),
    ];
    t.push(snap(5, later));
    t.push(snap(6, later));
    expect(t.origin()).toEqual({ x: 5, y: 2, since: 3, waiting: 1, firstStop: 3 });
  });

  it('any vehicle moving at a junction ends its stuck stretch', () => {
    const t = tracer();
    t.push(snap(1, [car(1, 4, 2, 'e', 0)]));
    expect(t.origin()).toMatchObject({ x: 5, y: 2, since: 1 });
    // Tick 2: a car drives through (5, 2), so it is not stuck.
    t.push(snap(2, [car(1, 4, 2, 'e', 0), car(2, 5, 2, 'n', 1, 1)]));
    expect(t.origin()).toBeNull();
  });

  it('a tie goes to the junction where a vehicle stopped for good first, not the longer queue', () => {
    const t = tracer();
    // Car 1 stops west of (5, 2) at tick 1 and never moves again. Car 2 drives through (5, 2) at
    // tick 2, so (5, 2)'s stuck stretch starts again at tick 3.
    t.push(snap(1, [car(1, 4, 2, 'e', 0)]));
    t.push(snap(2, [car(1, 4, 2, 'e', 0), car(2, 5, 2, 'n', 1, 1)]));
    // Tick 3: (1, 6) gets stuck too, with two cars that stopped just now.
    const stuck = [car(1, 4, 2, 'e', 0), car(3, 2, 6, 'w', 0), car(4, 1, 7, 'n', 0)];
    t.push(snap(3, stuck));
    t.push(snap(4, stuck));
    expect(t.origin()).toEqual({ x: 5, y: 2, since: 3, waiting: 1, firstStop: 1 });
  });

  it('a vehicle that moves again is no longer stopped for good', () => {
    const t = tracer();
    t.push(snap(1, [car(1, 4, 2, 'e', 0)]));
    t.push(snap(2, [car(1, 4, 2, 'e', 1, 2)])); // creeps forward
    t.push(snap(3, [car(1, 4, 2, 'e', 0)]));
    expect(t.origin()).toMatchObject({ since: 3, firstStop: 3 });
  });

  it('a car stopped heading away from a junction does not wait at it', () => {
    const t = tracer();
    // East of (1, 2), heading east: away from (1, 2) and not yet next to (5, 2).
    t.push(snap(1, [car(1, 2, 2, 'e', 0)]));
    expect(t.origin()).toBeNull();
    // Inside the junction tile counts whatever the heading.
    t.push(snap(2, [car(1, 1, 2, 'e', 0)]));
    expect(t.origin()).toMatchObject({ x: 1, y: 2, since: 2 });
  });

  it('a repeated tick is ignored, and an earlier tick starts a new round', () => {
    const t = tracer();
    t.push(snap(10, [car(1, 4, 2, 'e', 0)]));
    t.push(snap(10, [car(1, 4, 2, 'e', 3)]));
    expect(t.origin()).toMatchObject({ since: 10 });
    t.push(snap(0, []));
    expect(t.origin()).toBeNull();
    t.push(snap(1, [car(1, 4, 2, 'e', 0)]));
    expect(t.origin()).toMatchObject({ x: 5, y: 2, since: 1 });
    t.reset();
    expect(t.origin()).toBeNull();
  });

  it('unknown lanes are skipped, and a new map clears the trace', () => {
    const t = tracer();
    t.push(snap(1, [[1, 65535, 0, 0, 0]]));
    expect(t.origin()).toBeNull();
    t.push(snap(2, [car(1, 4, 2, 'e', 0)]));
    expect(t.origin()).not.toBeNull();
    t.setMap(latticeMap('other', [3], [4]));
    expect(t.origin()).toBeNull();
  });
});

/** `denseInput` with its demand tripled into the first half of the round, so it gridlocks. */
function overloaded(seed: number): RoundInput {
  const base = denseInput(seed);
  const demandProfile = [
    ...base.demandProfile,
    ...base.demandProfile.map((d) => ({ ...d, tick: d.tick >> 1 })),
    ...base.demandProfile.map((d) => ({ ...d, tick: d.tick >> 2 })),
  ].sort((a, b) => a.tick - b.tick || a.edge - b.edge);
  return { ...base, demandProfile };
}

describe('JamTracer on the real sim', () => {
  it('on every gridlocked round, names the junction that got stuck first (independent check)', () => {
    let gridlocks = 0;
    let ties = 0;
    // Seeds 1–30, plus three found by scanning 1–300 where junctions got stuck on the same tick.
    const seeds = [...Array.from({ length: 30 }, (_, i) => i + 1), 33, 49, 72];
    for (const seed of seeds) {
      const input = overloaded(seed);
      const world = roundWorld(input);
      const t = new JamTracer(input.map, worldLaneLayout(world));
      const oracle = new WorldOracle(world);
      let s = Sim.init(input);
      while (!s.done) {
        s = Sim.step(s);
        const f = Sim.snapshot(s);
        t.push(f);
        oracle.push(f);
      }
      const r = Sim.result(s);
      if (!r.gridlocked) continue;
      gridlocks++;
      const o = t.origin();
      const want = oracle.first();
      expect(o, `seed ${seed}`).not.toBeNull();
      expect(want, `seed ${seed}`).not.toBeNull();
      if (!o || !want) continue;
      if (want.tieByStop) ties++;
      expect({ x: o.x, y: o.y, since: o.since }, `seed ${seed}`).toEqual({
        x: want.x,
        y: want.y,
        since: want.since,
      });
      expect(input.map.tiles[o.y * GRID_WIDTH + o.x]?.kind, `seed ${seed}`).toBe('road');
      // Stuck at least as long as the stall the detector needs.
      expect(o.since, `seed ${seed}`).toBeLessThanOrEqual(r.ticks - GRIDLOCK_TICKS);
    }
    expect(gridlocks).toBeGreaterThanOrEqual(5);
    // Some rounds tie on the stuck tick and are settled by the vehicle stopped for good first.
    expect(ties).toBeGreaterThan(0);
  }, 30_000); // 30 full sim rounds: slow on a loaded runner

  it('in free-flowing traffic, no junction stays stuck as long as a gridlock stall', () => {
    const input = denseInput(3);
    const t = new JamTracer(input.map, worldLaneLayout(roundWorld(input)));
    let s = Sim.init(input);
    let longest = 0;
    while (!s.done) {
      s = Sim.step(s);
      const f = Sim.snapshot(s);
      t.push(f);
      const o = t.origin();
      if (o) longest = Math.max(longest, (f[0] ?? 0) - o.since);
    }
    expect(Sim.result(s).gridlocked).toBe(false);
    expect(longest).toBeLessThan(GRIDLOCK_TICKS);
  });
});

/**
 * The test's own reading of "first stuck", from the sim's lane graph rather than the renderer's
 * tile geometry: a vehicle waits at intersection i when it is on one of i's box or pocket lanes,
 * or on the last tile of a road lane whose link ends at i. Stuck stretches and stop ticks are
 * tracked per tick; the first is the earliest stretch, then the earliest vehicle stopped for good,
 * then row-major tile order.
 */
class WorldOracle {
  private readonly since: number[];
  private stoppedAt = new Map<number, number>();
  private last: { waiting: number; firstStop: number }[] = [];
  constructor(private readonly world: World) {
    this.since = world.intersections.map(() => -1);
  }
  private at(laneId: number, cell: number): number {
    const lane = this.world.lanes[laneId];
    if (!lane) return -1;
    if (lane.kind !== 'road') return lane.intersection;
    const link = this.world.links[lane.link];
    if (!link || link.to.kind !== 'intersection') return -1;
    return cell >= lane.cells - CELLS_PER_TILE ? link.to.index : -1;
  }
  push(f: Uint16Array): void {
    const tick = f[0] ?? 0;
    const n = this.world.intersections.length;
    const waiting = Array<number>(n).fill(0);
    const moving = Array<boolean>(n).fill(false);
    const firstStop = Array<number>(n).fill(Infinity);
    const next = new Map<number, number>();
    for (let k = 0; k < (f[1] ?? 0); k++) {
      const o = SNAPSHOT_HEADER + k * SNAPSHOT_STRIDE;
      const id = f[o] ?? 0;
      const stopped = (f[o + 3] ?? 0) === 0;
      const since = stopped ? (this.stoppedAt.get(id) ?? tick) : -1;
      if (stopped) next.set(id, since);
      const i = this.at(f[o + 1] ?? 0, f[o + 2] ?? 0);
      if (i < 0) continue;
      if (stopped) {
        waiting[i] = (waiting[i] ?? 0) + 1;
        firstStop[i] = Math.min(firstStop[i] ?? Infinity, since);
      } else moving[i] = true;
    }
    this.stoppedAt = next;
    for (let i = 0; i < n; i++) {
      const stuck = (waiting[i] ?? 0) > 0 && !moving[i];
      if (!stuck) this.since[i] = -1;
      else if ((this.since[i] ?? -1) < 0) this.since[i] = tick;
    }
    this.last = waiting.map((w, i) => ({ waiting: w, firstStop: firstStop[i] ?? Infinity }));
  }
  first(): { x: number; y: number; since: number; tieByStop: boolean } | null {
    const stuck = this.world.intersections
      .map((ix, i) => ({
        x: ix.x,
        y: ix.y,
        since: this.since[i] ?? -1,
        firstStop: this.last[i]?.firstStop ?? Infinity,
      }))
      .filter((c) => c.since >= 0)
      .sort((a, b) => a.since - b.since || a.firstStop - b.firstStop || a.y - b.y || a.x - b.x);
    const best = stuck[0];
    if (!best) return null;
    const second = stuck[1];
    const tieByStop =
      !!second && second.since === best.since && second.firstStop !== best.firstStop;
    return { x: best.x, y: best.y, since: best.since, tieByStop };
  }
}
