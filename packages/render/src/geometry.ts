/**
 * Map geometry for drawing: which tiles are roads and intersections, how wide a road is, and
 * where the map sits on screen. Pure: no Pixi, no DOM. All lengths here are in tile units
 * (1 = one tile) unless the name ends in `Px`.
 */
import { GRID_HEIGHT, GRID_WIDTH, type GridMap, type MapTile, type Side } from '@rushwarden/sim';

export const SIDES: readonly Side[] = ['n', 'e', 's', 'w'];

/** Unit vector of travel towards each side, in screen axes (y grows downward). */
export const SIDE_VEC: Readonly<Record<Side, readonly [number, number]>> = {
  n: [0, -1],
  e: [1, 0],
  s: [0, 1],
  w: [-1, 0],
};

export const OPPOSITE: Readonly<Record<Side, Side>> = { n: 's', e: 'w', s: 'n', w: 'e' };

/** Width of one lane, in tiles. Two lanes each way still fit inside a tile with a margin. */
export const LANE_WIDTH = 0.2;
/** Extra road surface outside the outermost lanes (kerb), in tiles. */
export const ROAD_MARGIN = 0.04;

export function tileIndex(x: number, y: number): number {
  return y * GRID_WIDTH + x;
}

export function tileAt(map: GridMap, x: number, y: number): MapTile | undefined {
  if (x < 0 || y < 0 || x >= GRID_WIDTH || y >= GRID_HEIGHT) return undefined;
  return map.tiles[tileIndex(x, y)];
}

export function isRoad(map: GridMap, x: number, y: number): boolean {
  return tileAt(map, x, y)?.kind === 'road';
}

/** Lanes per direction on a road tile; 0 for blocks and out-of-map. */
export function lanesAt(map: GridMap, x: number, y: number): 0 | 1 | 2 {
  const t = tileAt(map, x, y);
  return t?.kind === 'road' ? t.lanes : 0;
}

/** Road width across both directions, in tiles. */
export function roadWidth(lanes: number): number {
  return 2 * lanes * LANE_WIDTH + 2 * ROAD_MARGIN;
}

/** Sides on which a road tile connects: to a road neighbour, or off-map through a map edge. */
export function connections(map: GridMap, x: number, y: number): Side[] {
  if (!isRoad(map, x, y)) return [];
  const out: Side[] = [];
  for (const side of SIDES) {
    const [dx, dy] = SIDE_VEC[side];
    if (isRoad(map, x + dx, y + dy)) out.push(side);
    else if (map.edges.some((e) => e.tile.x === x && e.tile.y === y && e.side === side))
      out.push(side);
  }
  return out;
}

/** GDD §3: an intersection is a road tile where 3–4 road tiles meet. */
export function isIntersection(map: GridMap, x: number, y: number): boolean {
  if (!isRoad(map, x, y)) return false;
  let n = 0;
  for (const side of SIDES) {
    const [dx, dy] = SIDE_VEC[side];
    if (isRoad(map, x + dx, y + dy)) n++;
  }
  return n >= 3;
}

export function intersections(map: GridMap): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = 0; y < GRID_HEIGHT; y++)
    for (let x = 0; x < GRID_WIDTH; x++) if (isIntersection(map, x, y)) out.push({ x, y });
  return out;
}

/** A straight road run between two tile centres (inclusive), to draw as one rounded rectangle. */
export interface RoadRun {
  readonly axis: 'h' | 'v';
  /** Fixed coordinate (y for horizontal runs, x for vertical ones). */
  readonly at: number;
  /** First and last tile along the axis. */
  readonly from: number;
  readonly to: number;
  /** Extend past `from` / `to` to the map boundary, because a map edge is there. */
  readonly openStart: boolean;
  readonly openEnd: boolean;
  readonly lanes: number;
}

/**
 * Maximal straight runs of connected road tiles in both axes. A tile that connects in neither
 * axis (an isolated road tile) yields a zero-length run so it is still drawn.
 */
export function roadRuns(map: GridMap): RoadRun[] {
  const runs: RoadRun[] = [];
  const hasEdge = (x: number, y: number, side: Side): boolean =>
    map.edges.some((e) => e.tile.x === x && e.tile.y === y && e.side === side);
  const covered = new Set<number>();
  // Horizontal.
  for (let y = 0; y < GRID_HEIGHT; y++) {
    let x = 0;
    while (x < GRID_WIDTH) {
      if (!isRoad(map, x, y)) {
        x++;
        continue;
      }
      const start = x;
      let lanes = lanesAt(map, x, y);
      while (isRoad(map, x + 1, y)) {
        x++;
        lanes = Math.max(lanes, lanesAt(map, x, y)) as 1 | 2;
      }
      const openStart = hasEdge(start, y, 'w');
      const openEnd = hasEdge(x, y, 'e');
      if (x > start || openStart || openEnd) {
        runs.push({ axis: 'h', at: y, from: start, to: x, openStart, openEnd, lanes });
        for (let i = start; i <= x; i++) covered.add(tileIndex(i, y));
      }
      x++;
    }
  }
  // Vertical.
  for (let x = 0; x < GRID_WIDTH; x++) {
    let y = 0;
    while (y < GRID_HEIGHT) {
      if (!isRoad(map, x, y)) {
        y++;
        continue;
      }
      const start = y;
      let lanes = lanesAt(map, x, y);
      while (isRoad(map, x, y + 1)) {
        y++;
        lanes = Math.max(lanes, lanesAt(map, x, y)) as 1 | 2;
      }
      const openStart = hasEdge(x, start, 'n');
      const openEnd = hasEdge(x, y, 's');
      if (y > start || openStart || openEnd || !covered.has(tileIndex(x, y))) {
        runs.push({ axis: 'v', at: x, from: start, to: y, openStart, openEnd, lanes });
      }
      y++;
    }
  }
  return runs;
}

/** Where the 7×9 grid sits on screen: pixel size of one tile and the top-left origin. */
export interface ViewFit {
  readonly tilePx: number;
  readonly originX: number;
  readonly originY: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

/**
 * Fits the grid into a `width × height` box, centred, with whole-pixel tiles, leaving at least
 * `gutterPx` on every side (the demand heat-strips live there).
 */
export function fitGrid(width: number, height: number, gutterPx = 0): ViewFit {
  const tilePx = Math.max(
    1,
    Math.floor(
      Math.min((width - 2 * gutterPx) / GRID_WIDTH, (height - 2 * gutterPx) / GRID_HEIGHT),
    ),
  );
  const widthPx = tilePx * GRID_WIDTH;
  const heightPx = tilePx * GRID_HEIGHT;
  return {
    tilePx,
    originX: Math.floor((width - widthPx) / 2),
    originY: Math.floor((height - heightPx) / 2),
    widthPx,
    heightPx,
  };
}

/**
 * Where badge `n` of a mark goes, in px: above a horizontal run, left of a vertical one, and off
 * the top-left corner of a junction (in the block on its diagonal, clear of all four roads). Kept
 * on the canvas: a target on the map's edge has its badge just inside.
 */
export function badgeCentre(
  r: { x: number; y: number; w: number; h: number },
  T: number,
  rad: number,
  n: number,
  width: number,
  height: number,
): [number, number] {
  const step = n * (rad * 2 + 2);
  let cx: number;
  let cy: number;
  if (r.h > r.w) {
    cx = r.x * T - rad - 1;
    cy = r.y * T + rad + 2 + step;
  } else if (r.w > r.h) {
    cx = r.x * T + rad + 2 + step;
    cy = r.y * T - rad - 1;
  } else {
    cx = r.x * T - rad * 0.8 + step;
    cy = r.y * T - rad * 0.8;
  }
  return [
    Math.min(Math.max(cx, rad + 1), width - rad - 1),
    Math.min(Math.max(cy, rad + 1), height - rad - 1),
  ];
}
