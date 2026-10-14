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

/** An axis-aligned box in px, centre and half sizes. */
export interface Box {
  readonly cx: number;
  readonly cy: number;
  readonly hw: number;
  readonly hh: number;
}

/**
 * Where badge `n` of a mark goes, in px: above a horizontal run, left of a vertical one, and off
 * the top-left corner of a junction (in the block on its diagonal, clear of all four roads; more
 * badges go on up that diagonal). Kept on the canvas: a target on the map's edge has its badge
 * just inside. A badge never goes where an entry's backlog tab (ADR-035) could hide it
 * (`tabs`, from `entryTabZone`): a run's badge moves to the run's other side, and a junction's to
 * the next diagonal (top-right, bottom-right, bottom-left). With every spot under a tab it keeps
 * the usual one.
 */
export function badgeCentre(
  r: { x: number; y: number; w: number; h: number },
  T: number,
  rad: number,
  n: number,
  width: number,
  height: number,
  tabs: readonly Box[] = [],
): [number, number] {
  const step = n * (rad * 2 + 2);
  const spots: [number, number][] = [];
  if (r.h > r.w) {
    spots.push([r.x * T - rad - 1, r.y * T + rad + 2 + step]);
    spots.push([(r.x + r.w) * T + rad + 1, r.y * T + rad + 2 + step]);
  } else if (r.w > r.h) {
    spots.push([r.x * T + rad + 2 + step, r.y * T - rad - 1]);
    spots.push([r.x * T + rad + 2 + step, (r.y + r.h) * T + rad + 1]);
  } else {
    // Further badges on a junction step on up the diagonal, into the same block: stepping
    // sideways put the second one on the north road, over the queue (#96 review).
    const d = step / Math.SQRT2;
    const o = rad * 0.8 + d;
    const [x0, y0, x1, y1] = [r.x * T, r.y * T, (r.x + r.w) * T, (r.y + r.h) * T];
    spots.push([x0 - o, y0 - o], [x1 + o, y0 - o], [x1 + o, y1 + o], [x0 - o, y1 + o]);
  }
  const clamp = ([cx, cy]: [number, number]): [number, number] => [
    Math.min(Math.max(cx, rad + 1), width - rad - 1),
    Math.min(Math.max(cy, rad + 1), height - rad - 1),
  ];
  const underTab = ([cx, cy]: [number, number]) =>
    tabs.some((b) => Math.abs(cx - b.cx) < rad + b.hw && Math.abs(cy - b.cy) < rad + b.hh);
  const placed = spots.map(clamp);
  return placed.find((p) => !underTab(p)) ?? (placed[0] as [number, number]);
}

/**
 * The most map an entry's backlog tab can cover (ADR-035): with no canvas margin and the widest
 * label `entryTab` allows (the tile's width less 6 px across the road). Badges keep out of it.
 */
export function entryTabZone(
  edge: { readonly tile: { readonly x: number; readonly y: number }; readonly side: string },
  T: number,
  gridW: number,
  gridH: number,
): Box {
  const size = Math.max(11, Math.round(T * 0.3));
  const hw = (T - 6) / 2;
  const hh = Math.min(hw, Math.max(9, Math.round(size * 0.8)));
  const [cx, cy] = entryTab(edge, T, hw, hh, gridW, gridH, 0, 0);
  return { cx, cy, hw, hh };
}

/**
 * Where an entry's backlog tab goes (ADR-035: trips waiting to enter), as its centre in map px:
 * attached to its own entry and aligned with that road, so the count can only belong to it. It
 * sits just outside the entry's heat-strip when the canvas has room there (`margin`: canvas px
 * beyond the map on that side, the strip's `gutter` included); with less room it moves in until
 * its outer edge meets the canvas edge, over the strip and the end of the entry tile. Across the
 * road it is centred on the entry tile, so tabs of different entries never meet (the scene keeps
 * each tab within its tile's width). #107: decided by the Lead over an on-board search.
 */
export function entryTab(
  edge: { readonly tile: { readonly x: number; readonly y: number }; readonly side: string },
  T: number,
  halfW: number,
  halfH: number,
  gridW: number,
  gridH: number,
  margin: number,
  gutter: number,
): [number, number] {
  const { x, y } = edge.tile;
  switch (edge.side) {
    case 'n':
      return [(x + 0.5) * T, -Math.min(margin, gutter + 2 * halfH) + halfH];
    case 's':
      return [(x + 0.5) * T, gridH * T + Math.min(margin, gutter + 2 * halfH) - halfH];
    case 'w':
      return [-Math.min(margin, gutter + 2 * halfW) + halfW, (y + 0.5) * T];
    default:
      return [gridW * T + Math.min(margin, gutter + 2 * halfW) - halfW, (y + 0.5) * T];
  }
}

/**
 * A backlog tab's label (ADR-035): "+N", and "999+" above 999, where "+999" would read as an
 * exact count (#107 review).
 */
export function backlogLabel(n: number): string {
  return n > 999 ? '999+' : `+${n}`;
}
