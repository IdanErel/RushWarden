import { describe, expect, it } from 'vitest';
import {
  GRIDLOCK_TICKS,
  GRID_WIDTH,
  Sim,
  denseInput,
  latticeMap,
  roundWorld,
  type RoundInput,
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
    expect(t.origin()).toEqual({ x: 5, y: 2, since: 3, waiting: 1 });
  });

  it('any vehicle moving at a junction ends its stuck stretch', () => {
    const t = tracer();
    t.push(snap(1, [car(1, 4, 2, 'e', 0)]));
    t.push(snap(2, [car(1, 4, 2, 'e', 0), car(2, 5, 2, 'n', 1, 1)]));
    t.push(snap(3, [car(1, 4, 2, 'e', 0), car(3, 2, 6, 'w', 0)]));
    // (5, 2) restarted at tick 3, the tick (1, 6) got stuck: the tie goes to the longer queue.
    t.push(snap(4, [car(1, 4, 2, 'e', 0), car(3, 2, 6, 'w', 0), car(4, 1, 7, 'n', 0)]));
    expect(t.origin()).toEqual({ x: 1, y: 6, since: 3, waiting: 2 });
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
  it('on every gridlocked round, names a junction stuck since before the final stall', () => {
    let gridlocks = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const input = overloaded(seed);
      const t = new JamTracer(input.map, worldLaneLayout(roundWorld(input)));
      let s = Sim.init(input);
      while (!s.done) {
        s = Sim.step(s);
        t.push(Sim.snapshot(s));
      }
      const r = Sim.result(s);
      if (!r.gridlocked) continue;
      gridlocks++;
      const o = t.origin();
      expect(o, `seed ${seed}`).not.toBeNull();
      if (!o) continue;
      expect(input.map.tiles[o.y * GRID_WIDTH + o.x]?.kind, `seed ${seed}`).toBe('road');
      expect(o.waiting).toBeGreaterThan(0);
      // Stuck at least as long as the stall the detector needs.
      expect(o.since, `seed ${seed}`).toBeLessThanOrEqual(r.ticks - GRIDLOCK_TICKS);
    }
    expect(gridlocks).toBeGreaterThanOrEqual(5);
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
