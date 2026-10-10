/**
 * Parade (GDD §5, District 1 round 8 boss): "one segment closed". Content picks the segment from
 * the round seed and returns it in `RoundSetup.closedSegments`, for the run controller to copy
 * into `RoundInput.closedSegments` (sim `SegmentId`, ADR-022).
 */
import {
  buildWorld,
  createPrng,
  GRID_HEIGHT,
  GRID_WIDTH,
  type GridMap,
  nextInt,
  type SegmentId,
  type TileRef,
} from '@rushwarden/sim';

export type { SegmentId };

const DIRS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
] as const;

function isRoad(map: GridMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= GRID_WIDTH || y >= GRID_HEIGHT) return false;
  return map.tiles[y * GRID_WIDTH + x]?.kind === 'road';
}

/**
 * Closable segments: for every link (a run of road tiles between two intersections; links to an
 * edge are excluded), each maximal straight piece of it. Closing any piece blocks the whole link;
 * bent links (corners) give one candidate per straight piece. Fixed order: row-major `from`.
 */
export function interiorSegments(map: GridMap): SegmentId[] {
  const world = buildWorld(map);
  const isX = (x: number, y: number): boolean =>
    isRoad(map, x, y) && (world.tileIntersection[y * GRID_WIDTH + x] ?? -1) !== -1;
  const out = new Map<string, SegmentId>();
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      if (!isX(x, y)) continue;
      for (const d of DIRS) {
        // Walk the link: non-intersection road tiles have exactly two road neighbours.
        const tiles: TileRef[] = [];
        let prev = { x, y };
        let cur = { x: x + d.dx, y: y + d.dy };
        while (isRoad(map, cur.x, cur.y) && !isX(cur.x, cur.y)) {
          tiles.push(cur);
          const p = prev;
          const c = cur;
          const next = DIRS.map((n) => ({ x: c.x + n.dx, y: c.y + n.dy })).find(
            (t) => isRoad(map, t.x, t.y) && !(t.x === p.x && t.y === p.y),
          );
          if (next === undefined) break; // reached an edge tile
          prev = cur;
          cur = next;
        }
        if (tiles.length === 0 || !isX(cur.x, cur.y)) continue;
        for (const run of straightRuns(tiles)) {
          const first = run[0];
          const last = run[run.length - 1];
          if (first === undefined || last === undefined) continue;
          const [from, to] = idx(first) <= idx(last) ? [first, last] : [last, first];
          out.set(`${idx(from)}-${idx(to)}`, { from, to });
        }
      }
    }
  }
  return [...out.values()].sort((a, b) => idx(a.from) - idx(b.from) || idx(a.to) - idx(b.to));
}

function idx(t: TileRef): number {
  return t.y * GRID_WIDTH + t.x;
}

/** Splits a path of adjacent tiles into maximal straight (same row or column) pieces. */
function straightRuns(tiles: readonly TileRef[]): TileRef[][] {
  const runs: TileRef[][] = [];
  let run: TileRef[] = [];
  for (const t of tiles) {
    const a = run[0];
    if (a !== undefined && run.length >= 1) {
      const b = run[1] ?? t;
      const sameLine = (a.x === b.x && b.x === t.x) || (a.y === b.y && b.y === t.y);
      if (!sameLine) {
        runs.push(run);
        run = [];
      }
    }
    run.push(t);
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

function segmentTileSet(s: SegmentId): Set<number> {
  const out = new Set<number>();
  const dx = Math.sign(s.to.x - s.from.x);
  const dy = Math.sign(s.to.y - s.from.y);
  for (let x = s.from.x, y = s.from.y; ; x += dx, y += dy) {
    out.add(y * GRID_WIDTH + x);
    if (x === s.to.x && y === s.to.y) return out;
  }
}

/** True if every edge can still reach every other edge with `closed` removed (roads are two-way). */
export function edgesConnectedWithout(map: GridMap, closed: SegmentId): boolean {
  const blocked = segmentTileSet(closed);
  if (map.edges.some((e) => blocked.has(idx(e.tile)))) return false;
  const [start, ...rest] = map.edges;
  if (start === undefined) return true;
  const seen = new Set<number>([start.tile.y * GRID_WIDTH + start.tile.x]);
  const queue: TileRef[] = [start.tile];
  for (let t = queue.shift(); t !== undefined; t = queue.shift()) {
    for (const d of DIRS) {
      const x = t.x + d.dx;
      const y = t.y + d.dy;
      const i = y * GRID_WIDTH + x;
      if (!isRoad(map, x, y) || blocked.has(i) || seen.has(i)) continue;
      seen.add(i);
      queue.push({ x, y });
    }
  }
  return rest.every((e) => seen.has(e.tile.y * GRID_WIDTH + e.tile.x));
}

/** Segments a Parade may close: interior, straight, and leaving every edge pair connected. */
export function paradeCandidates(map: GridMap): SegmentId[] {
  return interiorSegments(map).filter((s) => edgesConnectedWithout(map, s));
}

/** The Parade's closed segment for a round: a seeded uniform pick from `paradeCandidates`. */
export function pickParadeSegment(map: GridMap, seed: number): SegmentId {
  const candidates = paradeCandidates(map);
  const pick = candidates[nextInt(createPrng(seed), Math.max(1, candidates.length))];
  if (pick === undefined) throw new RangeError(`map ${map.id} has no segment a Parade can close`);
  return pick;
}
