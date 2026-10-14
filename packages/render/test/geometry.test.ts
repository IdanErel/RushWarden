import { describe, expect, it } from 'vitest';
import { GRID_HEIGHT, GRID_WIDTH, emptyMap, type GridMap, type MapTile } from '@rushwarden/sim';
import { loadMapTemplates, templateVariants } from '@rushwarden/content';
import {
  backlogCentre,
  badgeCentre,
  connections,
  isRoad,
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

describe('backlogCentre (ADR-035: waiting markers on blocks only)', () => {
  const T = 60;
  const map = emptyMap();
  const onBlock = ([cx, cy]: [number, number]) =>
    !isRoad(map, Math.floor(cx / T), Math.floor(cy / T));
  it('sits on the block beside each entry of the cross, against the border', () => {
    for (const edge of map.edges) {
      const [cx, cy] = backlogCentre(edge, T, 15, 10, map);
      expect(onBlock([cx, cy]), `${edge.side} marker on a block`).toBe(true);
      const [tx, ty] = [Math.floor(cx / T), Math.floor(cy / T)];
      // Next to the entry tile, in the border row or column.
      expect(Math.abs(tx - edge.tile.x) + Math.abs(ty - edge.tile.y)).toBe(1);
      if (edge.side === 'n') expect(cy).toBe(12);
      if (edge.side === 's') expect(cy).toBe(GRID_HEIGHT * T - 12);
      if (edge.side === 'w') expect(cx).toBe(17);
      if (edge.side === 'e') expect(cx).toBe(GRID_WIDTH * T - 17);
    }
  });
});

/**
 * #107 review: every shipped map variant at the phone's and the desktop's tile size, with "99+"
 * waiting at every edge and a card badge on every road run and junction (one badge, then two).
 * The reviewer's scan, as a test.
 */
describe('backlog markers on every shipped map variant (#107 review)', () => {
  const maps = loadMapTemplates().flatMap(templateVariants);
  type B = { cx: number; cy: number; hw: number; hh: number };
  const hit = (a: B, b: B) =>
    Math.abs(a.cx - b.cx) < a.hw + b.hw && Math.abs(a.cy - b.cy) < a.hh + b.hh;
  /** Every road run (both axes) and junction, as badgeCentre's target rects. */
  function runs(m: GridMap): { x: number; y: number; w: number; h: number }[] {
    const out = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (let y = 0; y < GRID_HEIGHT; y++)
      for (let x = 0; x < GRID_WIDTH; x++) {
        if (!isRoad(m, x, y)) continue;
        if (isIntersection(m, x, y)) {
          out.set(`j${x},${y}`, { x, y, w: 1, h: 1 });
          continue;
        }
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
        ] as const) {
          const ok = (i: number) =>
            isRoad(m, x + dx * i, y + dy * i) && !isIntersection(m, x + dx * i, y + dy * i);
          let a = 0;
          let b = 0;
          while (ok(a - 1)) a--;
          while (ok(b + 1)) b++;
          if (a === b && !(isRoad(m, x + dx, y + dy) || isRoad(m, x - dx, y - dy))) continue;
          const [x0, y0] = [x + dx * a, y + dy * a];
          out.set(`s${dx}${x0},${y0}-${b - a}`, {
            x: x0,
            y: y0,
            w: dx ? b - a + 1 : 1,
            h: dy ? b - a + 1 : 1,
          });
        }
      }
    return [...out.values()];
  }

  it('covers the bank', () => expect(maps.length).toBeGreaterThanOrEqual(38));

  for (const T of [44, 76])
    for (const badgesPer of [1, 2])
      it(`T=${T}, ${badgesPer} badge(s) per run: no marker on a road or a marker${
        badgesPer === 1 ? ', or on a badge' : ''
      }`, () => {
        const [W, H] = [GRID_WIDTH * T, GRID_HEIGHT * T];
        const rad = Math.max(7, T * 0.15);
        // "99+" as the scene sizes it (font 0.3T), within one tile.
        const size = Math.max(11, Math.round(T * 0.3));
        const halfH = Math.max(9, Math.round(size * 0.8));
        const halfW = Math.max(halfH, Math.round((3 * size * 0.6) / 2) + Math.round(size * 0.45));
        expect(halfW * 2).toBeLessThanOrEqual(T - 6);
        const problems: string[] = [];
        for (const m of maps) {
          const badges: B[] = runs(m).flatMap((r) =>
            Array.from({ length: badgesPer }, (_, n) => {
              const [cx, cy] = badgeCentre(r, T, rad, n, W, H);
              return { cx, cy, hw: rad + 1, hh: rad + 1 };
            }),
          );
          const markers: B[] = [];
          for (const e of m.edges) {
            const [cx, cy] = backlogCentre(e, T, halfW, halfH, m, badges, markers);
            const p = { cx, cy, hw: halfW, hh: halfH };
            const at = `${m.id} ${e.side}${e.tile.x},${e.tile.y}`;
            if (markers.some((q) => hit(p, q))) problems.push(`${at} on a marker`);
            if (badgesPer === 1 && badges.some((b) => hit(p, b))) problems.push(`${at} on a badge`);
            if (cx - halfW < 0 || cy - halfH < 0 || cx + halfW > W || cy + halfH > H)
              problems.push(`${at} off the canvas`);
            for (let y = 0; y < GRID_HEIGHT; y++)
              for (let x = 0; x < GRID_WIDTH; x++)
                if (
                  isRoad(m, x, y) &&
                  hit(p, { cx: (x + 0.5) * T, cy: (y + 0.5) * T, hw: T / 2 - 1, hh: T / 2 - 1 })
                )
                  problems.push(`${at} on road ${x},${y}`);
            markers.push(p);
          }
        }
        expect(problems).toEqual([]);
      });
});
