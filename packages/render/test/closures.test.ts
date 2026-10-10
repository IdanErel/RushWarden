import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_HEADER,
  SNAPSHOT_STRIDE,
  Sim,
  buildWorld,
  emptyMap,
  roundWorld,
  sampleInput,
  type RoundInput,
} from '@rushwarden/sim';
import { BARRIER, NO_CLOSURES, closures } from '../src/closures.js';
import { worldLaneLayout } from '../src/lanes.js';

const map = emptyMap();
const world = buildWorld(map);

describe('closed segments (Parade boss, ADR-022)', () => {
  it('draw nothing when nothing is closed', () => {
    expect(closures(map, world, undefined)).toBe(NO_CLOSURES);
    expect(closures(map, world, [])).toBe(NO_CLOSURES);
  });

  it('grey out every tile of the closed links, as the sim closes them', () => {
    const c = closures(map, world, [{ from: { x: 5, y: 4 }, to: { x: 5, y: 4 } }]);
    // The east arm of the plus is one link each way, from the box to the map edge.
    expect(c.tiles).toEqual([
      { x: 4, y: 4 },
      { x: 5, y: 4 },
      { x: 6, y: 4 },
    ]);
    expect(c.tiles.some((t) => t.x === 3 && t.y === 4)).toBe(false);
  });

  it('put a barrier across the road at each end of a segment', () => {
    const c = closures(map, world, [{ from: { x: 6, y: 4 }, to: { x: 4, y: 4 } }]);
    expect(c.barriers).toHaveLength(2);
    const [west, east] = c.barriers;
    expect(west!.w).toBeCloseTo(BARRIER);
    expect(west!.x).toBeCloseTo(4);
    expect(east!.x + east!.w).toBeCloseTo(7);
    for (const b of c.barriers) {
      expect(b.h).toBeGreaterThan(b.w);
      expect(b.y + b.h / 2).toBeCloseTo(4.5);
    }
    const v = closures(map, world, [{ from: { x: 3, y: 1 }, to: { x: 3, y: 2 } }]);
    expect(v.barriers.map((b) => b.h)).toEqual([BARRIER, BARRIER]);
    const one = closures(map, world, [{ from: { x: 3, y: 1 }, to: { x: 3, y: 1 } }]);
    expect(one.barriers.map((b) => b.h)).toEqual([BARRIER, BARRIER]);
  });

  it('throw on a segment the sim rejects, so the scene can fall back', () => {
    expect(() => closures(map, world, [{ from: { x: 3, y: 4 }, to: { x: 3, y: 4 } }])).toThrow();
  });
});

describe('lane layout per round (roundWorld, ADR-023)', () => {
  it('places every lane id the sim emits when a topology card changes the world', () => {
    const base = sampleInput(6);
    const input: RoundInput = {
      ...base,
      placements: [
        {
          cardId: 'one-way',
          tier: 1,
          target: { kind: 'segment', from: { x: 4, y: 4 }, to: { x: 6, y: 4 } },
          effects: [{ kind: 'setOneWay', doubleLanes: true }],
          order: 0,
        },
      ],
    };
    const layout = worldLaneLayout(roundWorld(input));
    const pt = { x: 0, y: 0, heading: 0 };
    let s = Sim.init(input);
    let seen = 0;
    while (!s.done) {
      s = Sim.step(s);
      const f = Sim.snapshot(s);
      for (let k = 0, o = SNAPSHOT_HEADER; k < f[1]!; k++, o += SNAPSHOT_STRIDE) {
        expect(layout.cellPoint(f[o + 1]!, f[o + 2]!, pt)).toBe(true);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
    // The round's world differs from the bare map's (the one-way arm carries no reverse lanes),
    // so lane ids from the bare map's world would point at the wrong road.
    expect(roundWorld(input).links.some((l) => l.lanes.length === 0)).toBe(true);
    expect(world.links.some((l) => l.lanes.length === 0)).toBe(false);
  });
});
