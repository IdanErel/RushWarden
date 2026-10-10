import { describe, expect, it } from 'vitest';
import { CELLS_PER_TILE, GRID_WIDTH, buildWorld, emptyMap, locateCell } from '@rushwarden/sim';
import {
  HEADING,
  decodeTileLane,
  tileLaneId,
  tileLaneLayout,
  worldLaneLayout,
  type LanePoint,
} from '../src/lanes.js';

const p = (): LanePoint => ({ x: 0, y: 0, heading: 0 });

describe('provisional tile lane layout', () => {
  it('round-trips lane ids', () => {
    for (const dir of ['n', 'e', 's', 'w'] as const)
      for (const k of [0, 1] as const) {
        expect(decodeTileLane(tileLaneId(5, 7, dir, k))).toEqual({ x: 5, y: 7, dir, k });
      }
  });

  it('places northbound traffic on the right (east) half, moving up', () => {
    const layout = tileLaneLayout(emptyMap());
    const a = p();
    const b = p();
    expect(layout.cellPoint(tileLaneId(3, 2, 'n', 0), 0, a)).toBe(true);
    expect(layout.cellPoint(tileLaneId(3, 2, 'n', 0), 3, b)).toBe(true);
    expect(a.x).toBeGreaterThan(3.5);
    expect(b.y).toBeLessThan(a.y);
    expect(a.heading).toBe(HEADING.n);
    expect(a.y).toBeLessThan(3);
    expect(b.y).toBeGreaterThan(2);
  });

  it('places eastbound traffic on the south half', () => {
    const layout = tileLaneLayout(emptyMap());
    const a = p();
    expect(layout.cellPoint(tileLaneId(1, 4, 'e', 0), 1, a)).toBe(true);
    expect(a.y).toBeGreaterThan(4.5);
    expect(a.heading).toBe(0);
  });

  it('rejects cells that do not exist on the map', () => {
    const layout = tileLaneLayout(emptyMap());
    const a = p();
    expect(layout.cellsPerLane).toBe(CELLS_PER_TILE);
    expect(layout.cellPoint(tileLaneId(0, 0, 'n', 0), 0, a)).toBe(false); // block
    expect(layout.cellPoint(tileLaneId(3, 0, 'n', 1), 0, a)).toBe(false); // only 1 lane
    expect(layout.cellPoint(tileLaneId(3, 0, 'n', 0), 4, a)).toBe(false); // cell past the tile
    expect(layout.cellPoint(-1, 0, a)).toBe(false);
    expect(layout.cellPoint(65535, 0, a)).toBe(false);
  });
});

describe('two-lane roads', () => {
  it('puts lane 0 at the kerb and lane 1 next to the centre line (ADR-012)', () => {
    const map = emptyMap();
    const tiles = map.tiles.map((t) => (t.kind === 'road' ? { ...t, lanes: 2 as const } : t));
    const layout = tileLaneLayout({ ...map, tiles });
    const kerb = p();
    const inner = p();
    expect(layout.cellPoint(tileLaneId(3, 2, 'n', 0), 0, kerb)).toBe(true);
    expect(layout.cellPoint(tileLaneId(3, 2, 'n', 1), 0, inner)).toBe(true);
    expect(kerb.x).toBeGreaterThan(inner.x);
    expect(inner.x).toBeGreaterThan(3.5);
  });
});

describe('world lane layout (sim lanes, ADR-012)', () => {
  const map = emptyMap();
  const world = buildWorld(map);
  const layout = worldLaneLayout(world);

  it('places every cell of every road lane inside the tile locateCell names', () => {
    const a = p();
    for (const lane of world.lanes) {
      for (let c = 0; c < lane.cells; c++) {
        expect(layout.cellPoint(lane.id, c, a)).toBe(true);
        const { tile } = locateCell(world, lane.id, c);
        const tx = tile % GRID_WIDTH;
        const ty = Math.floor(tile / GRID_WIDTH);
        expect(a.x).toBeGreaterThan(tx);
        expect(a.x).toBeLessThan(tx + 1);
        expect(a.y).toBeGreaterThan(ty);
        expect(a.y).toBeLessThan(ty + 1);
      }
    }
  });

  it('keeps road traffic on the right of travel and moving downstream', () => {
    const a = p();
    const b = p();
    for (const lane of world.lanes.slice(0, world.roadLanes)) {
      expect(layout.cellPoint(lane.id, 0, a)).toBe(true);
      expect(layout.cellPoint(lane.id, 1, b)).toBe(true);
      const { tile, entryDir } = locateCell(world, lane.id, 0);
      const cx = (tile % GRID_WIDTH) + 0.5;
      const cy = Math.floor(tile / GRID_WIDTH) + 0.5;
      const [dx, dy] = [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ][entryDir]!;
      // Right of travel is (-dy, dx); downstream is (dx, dy).
      expect((a.x - cx) * -dy! + (a.y - cy) * dx!).toBeGreaterThan(0);
      expect((b.x - a.x) * dx! + (b.y - a.y) * dy!).toBeCloseTo(1 / CELLS_PER_TILE);
      expect(a.heading).toBeCloseTo(Math.atan2(dy!, dx!));
    }
  });

  it('moves at most half a tile between consecutive cells, corners included', () => {
    const a = p();
    const b = p();
    for (const lane of world.lanes)
      for (let c = 1; c < lane.cells; c++) {
        layout.cellPoint(lane.id, c - 1, a);
        layout.cellPoint(lane.id, c, b);
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(0.5);
      }
  });

  it('walks back along the path a vehicle took (backPoint)', () => {
    const q = p();
    const r = p();
    const road = world.lanes[0]!;
    // Same lane: the cell `back` cells upstream.
    layout.backPoint(road.id, 5, 2, q);
    layout.cellPoint(road.id, 3, r);
    expect(q).toEqual(r);
    // Before the lane's first cell: straight back from it, one cell length per cell.
    layout.backPoint(road.id, 0, 2, q);
    layout.cellPoint(road.id, 0, r);
    expect(Math.hypot(q.x - r.x, q.y - r.y)).toBeCloseTo(2 / CELLS_PER_TILE);
    // A box lane leads back into its approach lane's last cells.
    const box = world.lanes.find((l) => l.kind === 'box' && l.cells === 3)!;
    const ix = world.intersections[box.intersection]!;
    const approach = world.lanes[world.links[ix.inLinks[(box.entryDir + 2) & 3]!]!.lanes[0]!]!;
    layout.backPoint(box.id, 2, 1, q);
    layout.cellPoint(box.id, 1, r);
    expect(q).toEqual(r);
    layout.backPoint(box.id, 0, 2, q);
    layout.cellPoint(approach.id, approach.cells - 2, r);
    expect(q).toEqual(r);
    // A pocket sits beside the approach's last cell; behind it is the approach.
    const pocket = world.lanes.find((l) => l.kind === 'pocket')!;
    const kerb = world.lanes[world.links[pocket.link]!.lanes[0]!]!;
    layout.backPoint(pocket.id, 0, 1, q);
    layout.cellPoint(kerb.id, kerb.cells - 2, r);
    expect(q).toEqual(r);
    expect(layout.backPoint(world.lanes.length, 0, 1, q)).toBe(false);
    // The per-tile layout extends straight back past its tile.
    const tl = tileLaneLayout(emptyMap());
    const id = tileLaneId(3, 2, 'n', 0);
    expect(tl.backPoint(id, 3, 1, q)).toBe(true);
    tl.cellPoint(id, 2, r);
    expect(q).toEqual(r);
    tl.backPoint(id, 0, 1, q);
    tl.cellPoint(id, 0, r);
    expect(q.y - r.y).toBeCloseTo(1 / CELLS_PER_TILE);
    expect(tl.backPoint(-1, 0, 1, q)).toBe(false);
  });

  it('rejects ids and cells the world does not have', () => {
    const a = p();
    const lane = world.lanes[0]!;
    expect(layout.cellPoint(world.lanes.length, 0, a)).toBe(false);
    expect(layout.cellPoint(-1, 0, a)).toBe(false);
    expect(layout.cellPoint(lane.id, lane.cells, a)).toBe(false);
    expect(layout.cellPoint(lane.id, -1, a)).toBe(false);
  });

  it('fills the road with a one-way link whose lanes were doubled', () => {
    const link = world.links[world.lanes[0]!.link]!;
    const doubled = {
      ...world,
      links: world.links.map((l) =>
        l.id === link.id
          ? { ...l, lanes: [l.lanes[0]!, world.lanes.length] }
          : l.id === link.reverse
            ? { ...l, lanes: [] }
            : l,
      ),
      lanes: [
        ...world.lanes,
        {
          id: world.lanes.length,
          kind: 'road' as const,
          link: link.id,
          index: 1,
          cells: link.cells,
          intersection: -1,
          turn: -1,
          entryDir: -1,
          exitDir: -1,
        },
      ],
    };
    const one = worldLaneLayout(doubled);
    const kerb = p();
    const inner = p();
    one.cellPoint(link.lanes[0]!, 0, kerb);
    one.cellPoint(world.lanes.length, 0, inner);
    const { tile, entryDir } = locateCell(world, link.lanes[0]!, 0);
    // Symmetric about the road's centre line, across the direction of travel.
    const across = entryDir % 2 === 0 ? 'x' : 'y';
    const centre = across === 'x' ? (tile % GRID_WIDTH) + 0.5 : Math.floor(tile / GRID_WIDTH) + 0.5;
    expect(kerb[across] - centre + (inner[across] - centre)).toBeCloseTo(0);
    expect(kerb[across]).not.toBeCloseTo(inner[across]);
  });

  it('draws intersection box lanes (#23) in the sim quarter of each cell', () => {
    const boxes = world.lanes.slice(world.roadLanes, world.pocketLanes);
    expect(boxes.length).toBeGreaterThan(0);
    const q = p();
    for (const lane of boxes) {
      for (let c = 0; c < lane.cells; c++) {
        expect(layout.cellPoint(lane.id, c, q)).toBe(true);
        const { tile, quadrant } = locateCell(world, lane.id, c);
        const cx = (tile % GRID_WIDTH) + 0.5;
        const cy = Math.floor(tile / GRID_WIDTH) + 0.5;
        // Quadrants clockwise from NE: east half is 0 and 1, south half is 1 and 2.
        expect(q.x > cx).toBe(quadrant === 0 || quadrant === 1);
        expect(q.y > cy).toBe(quadrant === 1 || quadrant === 2);
        expect(Number.isFinite(q.heading)).toBe(true);
      }
      expect(layout.cellPoint(lane.id, lane.cells, q)).toBe(false);
    }
  });

  it('draws turn pockets (#27) beside the approach stop line, inside its lanes', () => {
    const pockets = world.lanes.slice(world.pocketLanes);
    expect(pockets.length).toBeGreaterThan(0);
    const q = p();
    const last = p();
    for (const lane of pockets) {
      const link = world.links[lane.link]!;
      const through = world.lanes[link.lanes[0]!]!;
      expect(layout.cellPoint(lane.id, 0, q)).toBe(true);
      layout.cellPoint(through.id, through.cells - 1, last);
      const { entryDir } = locateCell(world, lane.id, 0);
      const across = entryDir % 2 === 0 ? 'x' : 'y';
      const along = across === 'x' ? 'y' : 'x';
      // Level with the stop-line cell, shifted toward the road centre (left of travel).
      expect(q[along]).toBeCloseTo(last[along]);
      const [dx, dy] = [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ][entryDir]!;
      const right = (q.x - last.x) * -dy! + (q.y - last.y) * dx!;
      expect(right).toBeLessThan(0);
      expect(q.heading).toBeCloseTo(last.heading);
      expect(layout.cellPoint(lane.id, 1, q)).toBe(false);
    }
  });

  it('joins box lanes to their approach and exit lanes without a jump', () => {
    const prev = p();
    const cur = p();
    for (const lane of world.lanes.slice(world.roadLanes, world.pocketLanes)) {
      const ix = world.intersections[lane.intersection]!;
      const inLink = world.links[ix.inLinks[(lane.entryDir + 2) & 3]!]!;
      const outLink = world.links[ix.outLinks[lane.exitDir]!]!;
      layout.cellPoint(inLink.lanes[0]!, world.lanes[inLink.lanes[0]!]!.cells - 1, prev);
      for (let c = 0; c <= lane.cells; c++) {
        if (c < lane.cells) layout.cellPoint(lane.id, c, cur);
        else layout.cellPoint(outLink.lanes[0]!, 0, cur);
        expect(Math.hypot(cur.x - prev.x, cur.y - prev.y)).toBeLessThanOrEqual(0.5);
        Object.assign(prev, cur);
      }
    }
  });
});
