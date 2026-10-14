import { describe, expect, it } from 'vitest';
import { GRID_HEIGHT, GRID_WIDTH, emptyMap, type GridMap, type MapTile } from '@rushwarden/sim';
import { loadMapTemplates, templateVariants } from '@rushwarden/content';
import { HEAT_GUTTER_PX } from '../src/effects.js';
import {
  entryTab,
  badgeCentre,
  connections,
  fitGrid,
  intersections,
  isIntersection,
  lanesAt,
  roadRuns,
  roadWidth,
  tileAt,
} from '../src/geometry.js';

/** An L-shaped map plus an isolated 2-lane tile, for run edge cases. */
function lMap(): GridMap {
  const tiles: MapTile[] = [];
  for (let y = 0; y < GRID_HEIGHT; y++)
    for (let x = 0; x < GRID_WIDTH; x++) {
      const road = (y === 2 && x <= 3) || (x === 3 && y >= 2 && y <= 5);
      tiles.push(road ? { kind: 'road', lanes: 1 } : { kind: 'block' });
    }
  tiles[8 * GRID_WIDTH + 6] = { kind: 'road', lanes: 2 };
  return { id: 'l', tiles, edges: [{ id: 0, tile: { x: 0, y: 2 }, side: 'w' }] };
}

describe('geometry', () => {
  it('finds the single intersection of the plus map', () => {
    const map = emptyMap();
    expect(intersections(map)).toEqual([{ x: 3, y: 4 }]);
    expect(isIntersection(map, 3, 3)).toBe(false);
    expect(isIntersection(map, 0, 0)).toBe(false);
  });

  it('reads tiles safely outside the grid', () => {
    const map = emptyMap();
    expect(tileAt(map, -1, 0)).toBeUndefined();
    expect(lanesAt(map, 7, 0)).toBe(0);
    expect(lanesAt(map, 3, 0)).toBe(1);
  });

  it('connects edge tiles off-map', () => {
    const map = emptyMap();
    expect(connections(map, 3, 0).sort()).toEqual(['n', 's']);
    expect(connections(map, 3, 4).sort()).toEqual(['e', 'n', 's', 'w']);
    expect(connections(map, 0, 0)).toEqual([]);
  });

  it('draws the plus map as two open runs', () => {
    expect(roadRuns(emptyMap())).toEqual([
      { axis: 'h', at: 4, from: 0, to: 6, openStart: true, openEnd: true, lanes: 1 },
      { axis: 'v', at: 3, from: 0, to: 8, openStart: true, openEnd: true, lanes: 1 },
    ]);
  });

  it('handles corners, dead ends and isolated tiles', () => {
    const runs = roadRuns(lMap());
    expect(runs).toContainEqual({
      axis: 'h',
      at: 2,
      from: 0,
      to: 3,
      openStart: true,
      openEnd: false,
      lanes: 1,
    });
    expect(runs).toContainEqual({
      axis: 'v',
      at: 3,
      from: 2,
      to: 5,
      openStart: false,
      openEnd: false,
      lanes: 1,
    });
    // The isolated 2-lane tile is still drawn.
    expect(runs).toContainEqual({
      axis: 'v',
      at: 6,
      from: 8,
      to: 8,
      openStart: false,
      openEnd: false,
      lanes: 2,
    });
    expect(runs).toHaveLength(3);
  });

  it('fits the grid in a portrait phone view with whole-pixel tiles', () => {
    const f = fitGrid(390, 600);
    expect(f.tilePx).toBe(55);
    expect(f.widthPx).toBe(385);
    expect(f.originX).toBe(2);
    expect(f.originY + f.heightPx).toBeLessThanOrEqual(600);
    expect(fitGrid(0, 0).tilePx).toBe(1);
    // With the 6 px heat-strip gutter a 390 px phone still gets 54 px tiles.
    const g = fitGrid(390, 600, 6);
    expect(g.tilePx).toBe(54);
    expect(g.originX).toBeGreaterThanOrEqual(6);
  });

  it('makes roads wider with more lanes but always inside a tile', () => {
    expect(roadWidth(1)).toBeLessThan(roadWidth(2));
    expect(roadWidth(2)).toBeLessThan(1);
  });
});

describe('badgeCentre (playtest U8: badges off the road)', () => {
  const T = 60;
  const rad = 9;
  it('puts a junction badge off its top-left corner, in the diagonal block', () => {
    const [x, y] = badgeCentre({ x: 3, y: 4, w: 1, h: 1 }, T, rad, 0, 7 * T, 9 * T);
    expect(x + rad).toBeLessThanOrEqual(3 * T + 2);
    expect(y + rad).toBeLessThanOrEqual(4 * T + 2);
  });
  it('puts a horizontal run badge above the run and a vertical one to its left', () => {
    const [, hy] = badgeCentre({ x: 1, y: 4, w: 2, h: 1 }, T, rad, 0, 7 * T, 9 * T);
    expect(hy + rad).toBeLessThanOrEqual(4 * T);
    const [vx] = badgeCentre({ x: 3, y: 1, w: 1, h: 2 }, T, rad, 0, 7 * T, 9 * T);
    expect(vx + rad).toBeLessThanOrEqual(3 * T);
  });
  it('stays on the grid at the map edge, and stacks', () => {
    const [x, y] = badgeCentre({ x: 0, y: 0, w: 1, h: 1 }, T, rad, 0, 7 * T, 9 * T);
    expect(x - rad).toBeGreaterThanOrEqual(0);
    expect(y - rad).toBeGreaterThanOrEqual(0);
    // A second badge on a junction stays in the diagonal block, clear of both roads (#96).
    const [x1, y1] = badgeCentre({ x: 3, y: 4, w: 1, h: 1 }, T, rad, 0, 7 * T, 9 * T);
    const [x2, y2] = badgeCentre({ x: 3, y: 4, w: 1, h: 1 }, T, rad, 1, 7 * T, 9 * T);
    expect(Math.hypot(x2 - x1, y2 - y1)).toBeCloseTo(rad * 2 + 2);
    expect(x2 + rad).toBeLessThan(3 * T);
    expect(y2 + rad).toBeLessThan(4 * T);
    // Along a run, they stack along its side.
    const [hx1] = badgeCentre({ x: 1, y: 4, w: 2, h: 1 }, T, rad, 0, 7 * T, 9 * T);
    const [hx2] = badgeCentre({ x: 1, y: 4, w: 2, h: 1 }, T, rad, 1, 7 * T, 9 * T);
    expect(hx2 - hx1).toBe(rad * 2 + 2);
  });
});

describe('entryTab (ADR-035: the backlog count on its own entry)', () => {
  const T = 60;
  const map = emptyMap();
  const [hw, hh, gutter] = [20, 10, 6];
  it('sits just outside the heat-strip when the canvas has room', () => {
    for (const edge of map.edges) {
      const [cx, cy] = entryTab(edge, T, hw, hh, GRID_WIDTH, GRID_HEIGHT, 50, gutter);
      if (edge.side === 'n') expect([cx, cy]).toEqual([(edge.tile.x + 0.5) * T, -gutter - hh]);
      if (edge.side === 's')
        expect([cx, cy]).toEqual([(edge.tile.x + 0.5) * T, GRID_HEIGHT * T + gutter + hh]);
      if (edge.side === 'w') expect([cx, cy]).toEqual([-gutter - hw, (edge.tile.y + 0.5) * T]);
      if (edge.side === 'e')
        expect([cx, cy]).toEqual([GRID_WIDTH * T + gutter + hw, (edge.tile.y + 0.5) * T]);
    }
  });
  it('moves in over the strip and the entry tile until it meets the canvas edge', () => {
    for (const margin of [0, gutter]) {
      for (const edge of map.edges) {
        const [cx, cy] = entryTab(edge, T, hw, hh, GRID_WIDTH, GRID_HEIGHT, margin, gutter);
        if (edge.side === 'n') expect(cy - hh).toBeCloseTo(-margin);
        if (edge.side === 's') expect(cy + hh).toBeCloseTo(GRID_HEIGHT * T + margin);
        if (edge.side === 'w') expect(cx - hw).toBeCloseTo(-margin);
        if (edge.side === 'e') expect(cx + hw).toBeCloseTo(GRID_WIDTH * T + margin);
      }
    }
  });
});

/**
 * #107 review: every shipped map variant at the phone's and the desktop's tile size, with "+999"
 * waiting at every entry, with no margin, the strip's gutter only, and a roomy margin. Each tab
 * must sit on its own entry (across the road, inside that entry's tile), stay on the canvas, and
 * touch no other entry: neither its tab nor its tile.
 */
describe('backlog tabs on every shipped map variant (#107 review)', () => {
  const maps = loadMapTemplates().flatMap(templateVariants);
  type B = { cx: number; cy: number; hw: number; hh: number };
  const hit = (a: B, b: B) =>
    Math.abs(a.cx - b.cx) < a.hw + b.hw && Math.abs(a.cy - b.cy) < a.hh + b.hh;

  it('covers the bank', () => expect(maps.length).toBeGreaterThanOrEqual(38));

  for (const T of [44, 76])
    for (const margin of [0, HEAT_GUTTER_PX, 40])
      it(`T=${T}, margin ${margin}: each tab on its own entry, clear of every other entry`, () => {
        // "+999" as the scene sizes it: font 0.3T (about 0.6 em a glyph), shrunk until the tab
        // fits its entry tile across the road.
        let size = Math.max(11, Math.round(T * 0.3));
        let hh = 0;
        let hw = 0;
        for (;;) {
          hh = Math.max(Math.min(9, T / 2 - 3), Math.round(size * 0.8));
          hw = Math.max(hh, Math.round((4 * size * 0.6) / 2) + Math.round(size * 0.45));
          if ((hw * 2 <= T - 6 && hh * 2 <= T - 6) || size <= 7) break;
          size--;
        }
        expect(hw * 2).toBeLessThanOrEqual(T - 6);
        const problems: string[] = [];
        for (const m of maps) {
          const tabs = m.edges.map((e) => {
            const [cx, cy] = entryTab(
              e,
              T,
              hw,
              hh,
              GRID_WIDTH,
              GRID_HEIGHT,
              margin,
              HEAT_GUTTER_PX,
            );
            return { e, box: { cx, cy, hw, hh } };
          });
          const tile = (e: (typeof m.edges)[number]): B => ({
            cx: (e.tile.x + 0.5) * T,
            cy: (e.tile.y + 0.5) * T,
            hw: T / 2,
            hh: T / 2,
          });
          for (const { e, box } of tabs) {
            const at = `${m.id} ${e.side}${e.tile.x},${e.tile.y}`;
            const along = e.side === 'n' || e.side === 's';
            // On its own entry: across the road, inside the entry tile's span.
            const [lo, hi] = along ? [box.cx - hw, box.cx + hw] : [box.cy - hh, box.cy + hh];
            const t0 = (along ? e.tile.x : e.tile.y) * T;
            if (lo < t0 || hi > t0 + T) problems.push(`${at} outside its entry`);
            if (
              box.cx - hw < -margin ||
              box.cy - hh < -margin ||
              box.cx + hw > GRID_WIDTH * T + margin ||
              box.cy + hh > GRID_HEIGHT * T + margin
            )
              problems.push(`${at} off the canvas`);
            for (const o of tabs) {
              if (o.e === e) continue;
              if (hit(box, o.box))
                problems.push(`${at} on the tab of ${o.e.side}${o.e.tile.x},${o.e.tile.y}`);
              if (hit(box, tile(o.e)))
                problems.push(`${at} on entry ${o.e.side}${o.e.tile.x},${o.e.tile.y}`);
            }
          }
        }
        expect(problems).toEqual([]);
      });
});
