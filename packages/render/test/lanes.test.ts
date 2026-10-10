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

  it('keeps traffic on the right of travel and moving downstream', () => {
    const a = p();
    const b = p();
    for (const lane of world.lanes) {
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
        { id: world.lanes.length, link: link.id, index: 1, cells: link.cells },
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

  it('draws intersection box lanes (#23) on a straight line from approach to exit', () => {
    const ix = world.intersections[0]!;
    const inSide = ix.inLinks.findIndex((l) => l >= 0);
    const heading = (inSide + 2) & 3;
    const outSide = ix.outLinks.findIndex((l, d) => l >= 0 && d !== inSide);
    const boxId = world.lanes.length;
    const boxed = {
      ...world,
      lanes: [
        ...world.lanes,
        {
          id: boxId,
          link: -1,
          index: 0,
          cells: 2,
          intersection: ix.index,
          entryDir: heading,
          exitDir: outSide,
        },
      ],
    };
    const box = worldLaneLayout(boxed);
    const inLane = world.links[ix.inLinks[inSide]!]!.lanes[0]!;
    const outLane = world.links[ix.outLinks[outSide]!]!.lanes[0]!;
    const from = p();
    const to = p();
    box.cellPoint(inLane, world.lanes[inLane]!.cells - 1, from);
    box.cellPoint(outLane, 0, to);
    const pts = [0, 1].map((c) => {
      const q = p();
      expect(box.cellPoint(boxId, c, q)).toBe(true);
      return q;
    });
    pts.forEach((q, i) => {
      const t = (i + 1) / 3;
      expect(q.x).toBeCloseTo(from.x + (to.x - from.x) * t);
      expect(q.y).toBeCloseTo(from.y + (to.y - from.y) * t);
    });
    expect(box.cellPoint(boxId, 2, p())).toBe(false);
  });
});
