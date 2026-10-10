import { describe, expect, it } from 'vitest';
import { CELLS_PER_TILE, emptyMap } from '@rushwarden/sim';
import {
  HEADING,
  decodeTileLane,
  tileLaneId,
  tileLaneLayout,
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
