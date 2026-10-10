import { GRID_HEIGHT, GRID_WIDTH, type GridMap, type Target } from '@rushwarden/sim';

/**
 * Segment targets as the player places them (ADR-031): a segment is the full straight run of
 * non-intersection road tiles through a tile. The run screen (packages/ui) and the balance bots
 * (packages/balance) both build targets here, so the two cannot drift.
 */

function isRoad(map: GridMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= GRID_WIDTH || y >= GRID_HEIGHT) return false;
  return map.tiles[y * GRID_WIDTH + x]?.kind === 'road';
}

/** A road tile with 3–4 road neighbours (GDD §3). */
function isIntersection(map: GridMap, x: number, y: number): boolean {
  if (!isRoad(map, x, y)) return false;
  const n =
    Number(isRoad(map, x + 1, y)) +
    Number(isRoad(map, x - 1, y)) +
    Number(isRoad(map, x, y + 1)) +
    Number(isRoad(map, x, y - 1));
  return n >= 3;
}

/**
 * The straight run of non-intersection road tiles through (x, y), as a sim segment target. It
 * points from `from` to `to` (west to east, or north to south); a one-way card placed on it goes
 * that way unless the player chooses the reverse (`reverseSegment`).
 */
export function segmentAt(map: GridMap, x: number, y: number): Target {
  const plain = (a: number, b: number): boolean => isRoad(map, a, b) && !isIntersection(map, a, b);
  const horizontal = plain(x - 1, y) || plain(x + 1, y) || !(plain(x, y - 1) || plain(x, y + 1));
  const [dx, dy] = horizontal ? [1, 0] : [0, 1];
  let [fx, fy] = [x, y];
  while (plain(fx - dx, fy - dy)) [fx, fy] = [fx - dx, fy - dy];
  let [tx, ty] = [x, y];
  while (plain(tx + dx, ty + dy)) [tx, ty] = [tx + dx, ty + dy];
  return { kind: 'segment', from: { x: fx, y: fy }, to: { x: tx, y: ty } };
}

/**
 * Every distinct segment target on the map, in a fixed order: `segmentAt` of each
 * non-intersection road tile, scanning rows top to bottom, then columns left to right, without
 * repeats.
 */
export function segmentRuns(map: GridMap): Target[] {
  const out: Target[] = [];
  const seen = new Set<string>();
  for (let y = 0; y < GRID_HEIGHT; y++)
    for (let x = 0; x < GRID_WIDTH; x++) {
      if (!isRoad(map, x, y) || isIntersection(map, x, y)) continue;
      const t = segmentAt(map, x, y);
      if (t.kind !== 'segment') continue;
      const key = `${t.from.x},${t.from.y},${t.to.x},${t.to.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  return out;
}

/** The same segment pointing the other way (to -> from). */
export function reverseSegment(t: Extract<Target, { kind: 'segment' }>): Target {
  return { kind: 'segment', from: t.to, to: t.from };
}
