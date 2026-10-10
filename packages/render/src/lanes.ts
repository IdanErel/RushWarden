/**
 * Lane layout: turns a snapshot's (lane, cell) pair into a point on the map.
 *
 * The renderer only depends on the `LaneLayout` interface. `worldLaneLayout(world)` reads the
 * sim's own lanes (`World`, `locateCell`, ADR-012) and is what real snapshots use.
 * `tileLaneLayout` is the renderer's per-tile numbering, kept only for the fake traffic until the
 * sim spawns vehicles (ADR-015).
 */
import {
  CELLS_PER_TILE,
  GRID_HEIGHT,
  GRID_WIDTH,
  SIDES as SIM_SIDES,
  locateCell,
  type GridMap,
  type Lane,
  type Side,
  type World,
} from '@rushwarden/sim';
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
  /**
   * Writes the centre of the cell `back` cells upstream of (`lane`, `cell`) along the path a
   * vehicle took to get there (into the approach lane for a box lane), so a multi-cell vehicle's
   * body can follow its path. Past the start of the known path it extends straight back from
   * the lane's first cell. Returns false when (`lane`, `cell`) does not exist.
   */
  backPoint(lane: number, cell: number, back: number, out: LanePoint): boolean;
  /** Cells per tile along a lane (`CELLS_PER_TILE`). */
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
    backPoint(lane, cell, back, out) {
      // Per-tile ids do not record where a vehicle came from: extend straight back.
      if (cell - back >= 0) return this.cellPoint(lane, cell - back, out);
      if (!this.cellPoint(lane, 0, out)) return false;
      stepBack(out, back - cell);
      return true;
    },
  };
}

/** Moves `out` `cells` cells back against its heading. */
function stepBack(out: LanePoint, cells: number): void {
  out.x -= (Math.cos(out.heading) * cells) / CELLS_PER_TILE;
  out.y -= (Math.sin(out.heading) * cells) / CELLS_PER_TILE;
}

/** Writes the centre of cell `offset` (0..3) of tile (x, y) for travel `entry` → `exit`. */
function tileCellPoint(
  x: number,
  y: number,
  entry: Side,
  exit: Side,
  offset: number,
  lateral: number,
  out: LanePoint,
): void {
  // Turning tiles: first half along the entry direction, second half along the exit direction.
  const dir = entry === exit || offset < CELLS_PER_TILE / 2 ? entry : exit;
  const [dx, dy] = SIDE_VEC[dir];
  const along = -0.5 + (offset + 0.5) / CELLS_PER_TILE;
  // Right of travel is (-dy, dx) in screen axes.
  out.x = x + 0.5 + dx * along - dy * lateral;
  out.y = y + 0.5 + dy * along + dx * lateral;
  out.heading = HEADING[dir];
}

/**
 * Lane layout over the sim's world (ADR-012 numbering: lane 0 is the kerb lane, right-hand
 * traffic; cell 0 upstream; `CELLS_PER_TILE` cells per tile). Dispatches on `Lane.kind`:
 *
 * - Road lanes: `locateCell` gives the tile, the cell within it and the travel directions. A lane
 *   sits `index + 0.5` lane widths in from the right-hand kerb of the whole road, so a one-way
 *   road whose lanes were doubled fills the road instead of one half of it.
 * - Box lanes (#23): each cell is drawn at the centre of the box quarter the sim puts it in
 *   (`locateCell(...).quadrant`: right turns use 1 quarter, straight 2, left 3). The heading
 *   points from the previous point (the approach lane's last cell or the previous quarter) to the
 *   next (the next quarter or the exit lane's first cell).
 * - Turn pockets (#27): beside the approach's last cell, half a lane inside its innermost lane.
 * - Unknown ids return false, so the vehicle is hidden rather than guessed.
 */
export function worldLaneLayout(world: World): LaneLayout {
  const a: LanePoint = { x: 0, y: 0, heading: 0 };
  const b: LanePoint = { x: 0, y: 0, heading: 0 };
  const side = (dir: number): Side => SIM_SIDES[dir & 3] ?? 'n';

  /** Offset of a link's kerb lane from the road's centre line, in tile units. */
  function kerbLateral(linkId: number): number {
    const link = world.links[linkId];
    if (!link) return LANE_WIDTH / 2;
    const total = link.lanes.length + (world.links[link.reverse]?.lanes.length ?? 0);
    return (total / 2 - 0.5) * LANE_WIDTH;
  }

  function roadPoint(lane: Lane, cell: number, out: LanePoint): boolean {
    if (!Number.isInteger(cell) || cell < 0 || cell >= lane.cells) return false;
    const link = world.links[lane.link];
    if (!link) return false;
    // A turn pocket sits beside the approach's last cell, half a lane inside its innermost lane
    // (on the centre line of a two-lane road); `locateCell` gives that cell.
    const inward = lane.kind === 'pocket' ? link.lanes.length - 0.5 : lane.index;
    const lateral = kerbLateral(lane.link) - inward * LANE_WIDTH;
    const at = locateCell(world, lane.id, cell);
    const x = at.tile % GRID_WIDTH;
    const y = Math.floor(at.tile / GRID_WIDTH);
    tileCellPoint(x, y, side(at.entryDir), side(at.exitDir), at.offset, lateral, out);
    return true;
  }

  /** Centre of the cell's box quarter; quadrants run clockwise from NE (0 NE, 1 SE, 2 SW, 3 NW). */
  function quarterPoint(lane: Lane, cell: number, out: LanePoint): void {
    const at = locateCell(world, lane.id, cell);
    const q = at.quadrant & 3;
    out.x = (at.tile % GRID_WIDTH) + 0.5 + (q < 2 ? 0.25 : -0.25);
    out.y = Math.floor(at.tile / GRID_WIDTH) + 0.5 + (q === 1 || q === 2 ? 0.25 : -0.25);
  }

  function boxPoint(lane: Lane, cell: number, out: LanePoint): boolean {
    const ix = world.intersections[lane.intersection];
    if (!ix || !Number.isInteger(cell) || cell < 0 || cell >= lane.cells) return false;
    // The approach arrives on the side opposite its direction of travel.
    const inId = ix.inLinks[(lane.entryDir + 2) & 3] ?? -1;
    quarterPoint(lane, cell, out);
    if (cell > 0) quarterPoint(lane, cell - 1, a);
    else {
      const inLane = world.lanes[world.links[inId]?.lanes[0] ?? -1];
      if (!inLane || !roadPoint(inLane, inLane.cells - 1, a)) return false;
    }
    if (cell < lane.cells - 1) quarterPoint(lane, cell + 1, b);
    else {
      const outLane = world.lanes[world.links[ix.outLinks[lane.exitDir] ?? -1]?.lanes[0] ?? -1];
      if (!outLane || !roadPoint(outLane, 0, b)) return false;
    }
    out.heading = Math.atan2(b.y - a.y, b.x - a.x);
    return true;
  }

  return {
    cellsPerLane: CELLS_PER_TILE,
    cellPoint(laneId, cell, out) {
      const lane = world.lanes[laneId];
      if (!lane) return false;
      return lane.kind === 'box' ? boxPoint(lane, cell, out) : roadPoint(lane, cell, out);
    },
    backPoint(laneId, cell, back, out) {
      const lane = world.lanes[laneId];
      if (!lane || !this.cellPoint(laneId, cell, out)) return false;
      if (back <= 0) return true;
      if (lane.kind === 'road') {
        if (cell - back >= 0) return roadPoint(lane, cell - back, out);
        roadPoint(lane, 0, out);
        stepBack(out, back - cell);
        return true;
      }
      if (lane.kind === 'box' && cell - back >= 0) return boxPoint(lane, cell - back, out);
      // Box lanes and pockets are entered from the approach link's kerb lane.
      const link =
        lane.kind === 'box'
          ? world.links[
              world.intersections[lane.intersection]?.inLinks[(lane.entryDir + 2) & 3] ?? -1
            ]
          : world.links[lane.link];
      const approach = world.lanes[link?.lanes[0] ?? -1];
      if (!approach) return true;
      // A box lane's cell c is c + 1 cells past the approach's last cell; a pocket sits beside it.
      const into = lane.kind === 'box' ? cell + 1 : 0;
      const c = approach.cells - 1 - (back - into);
      if (c >= 0) return roadPoint(approach, c, out);
      roadPoint(approach, 0, out);
      stepBack(out, -c);
      return true;
    },
  };
}
