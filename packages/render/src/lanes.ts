/**
 * Lane layout: turns a snapshot's (lane, cell) pair into a point on the map.
 *
 * The renderer only depends on the `LaneLayout` interface. `tileLaneLayout` is a PROVISIONAL
 * numbering owned by the renderer until the sim's world (P1-SIM-01) defines real lane ids; at that
 * point the sim needs to expose its lane geometry (see the package README, "Open interface") and
 * `tileLaneLayout` is replaced by an adapter over it. Nothing else in the renderer changes.
 */
import { CELLS_PER_TILE, GRID_HEIGHT, GRID_WIDTH, type GridMap, type Side } from '@rushwarden/sim';
import { LANE_WIDTH, SIDES, SIDE_VEC, lanesAt, tileIndex } from './geometry.js';

/** A point on the map in tile units plus the direction of travel there (radians, 0 = east). */
export interface LanePoint {
  x: number;
  y: number;
  heading: number;
}

export interface LaneLayout {
  /**
   * Writes the centre of `cell` on `lane` into `out` and returns true, or returns false when the
   * pair does not exist on this map (the renderer then hides the vehicle rather than guessing).
   */
  cellPoint(lane: number, cell: number, out: LanePoint): boolean;
  /** Cells per lane; the renderer uses it only to validate input. */
  readonly cellsPerLane: number;
}

export const HEADING: Readonly<Record<Side, number>> = {
  e: 0,
  s: Math.PI / 2,
  w: Math.PI,
  n: -Math.PI / 2,
};

/**
 * Provisional lane id for "travel towards `dir` on tile (x, y), lane `k`" where k = 0 is the kerb
 * (rightmost) lane, as in ADR-012. Cells 0..3 run along the direction of travel.
 */
export function tileLaneId(x: number, y: number, dir: Side, k: 0 | 1): number {
  return (tileIndex(x, y) * 4 + SIDES.indexOf(dir)) * 2 + k;
}

export function decodeTileLane(lane: number): { x: number; y: number; dir: Side; k: 0 | 1 } {
  const k = (lane & 1) as 0 | 1;
  const rest = lane >> 1;
  const dir = SIDES[rest & 3] ?? 'n';
  const tile = rest >> 2;
  return { x: tile % GRID_WIDTH, y: Math.floor(tile / GRID_WIDTH), dir, k };
}

/** The provisional per-tile layout described on `tileLaneId`. Right-hand traffic. */
export function tileLaneLayout(map: GridMap): LaneLayout {
  const maxLane = GRID_WIDTH * GRID_HEIGHT * 8;
  return {
    cellsPerLane: CELLS_PER_TILE,
    cellPoint(lane, cell, out) {
      if (lane < 0 || lane >= maxLane || cell < 0 || cell >= CELLS_PER_TILE) return false;
      const { x, y, dir, k } = decodeTileLane(lane);
      const lanes = lanesAt(map, x, y);
      if (lanes === 0 || k >= lanes) return false;
      const [dx, dy] = SIDE_VEC[dir];
      // Right of travel is (-dy, dx) in screen axes.
      const lateral = (lanes - k - 0.5) * LANE_WIDTH;
      const along = -0.5 + (cell + 0.5) / CELLS_PER_TILE;
      out.x = x + 0.5 + dx * along - dy * lateral;
      out.y = y + 0.5 + dy * along + dx * lateral;
      out.heading = HEADING[dir];
      return true;
    },
  };
}
