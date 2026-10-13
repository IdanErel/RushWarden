import { describe, expect, it } from 'vitest';
import { GRID_HEIGHT, GRID_WIDTH, emptyMap, type GridMap, type MapTile } from '@rushwarden/sim';
import {
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
    const [x2] = badgeCentre({ x: 3, y: 4, w: 1, h: 1 }, T, rad, 1, 7 * T, 9 * T);
    const [x1] = badgeCentre({ x: 3, y: 4, w: 1, h: 1 }, T, rad, 0, 7 * T, 9 * T);
    expect(x2 - x1).toBe(rad * 2 + 2);
  });
});
