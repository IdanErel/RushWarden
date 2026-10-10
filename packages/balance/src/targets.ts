import { GRID_HEIGHT, GRID_WIDTH, type GridMap, type Target } from '@rushwarden/sim';
import { reverseSegment, segmentRuns, type TargetKind } from '@rushwarden/app';

function isRoad(map: GridMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= GRID_WIDTH || y >= GRID_HEIGHT) return false;
  return map.tiles[y * GRID_WIDTH + x]?.kind === 'road';
}

/**
 * Every target of each kind on a map, in a fixed order: intersections are road tiles with 3–4
 * road neighbours (§3); segments are the straight runs of non-intersection road tiles a player
 * places on (`segmentRuns`, shared with the run screen, ADR-031); edges and the district as they
 * are.
 */
export function candidateTargets(map: GridMap): Record<TargetKind, Target[]> {
  const intersection: Target[] = [];
  for (let y = 0; y < GRID_HEIGHT; y++)
    for (let x = 0; x < GRID_WIDTH; x++) {
      if (!isRoad(map, x, y)) continue;
      const n = [
        isRoad(map, x + 1, y),
        isRoad(map, x - 1, y),
        isRoad(map, x, y + 1),
        isRoad(map, x, y - 1),
      ].filter(Boolean).length;
      if (n >= 3) intersection.push({ kind: 'intersection', tile: { x, y } });
    }
  return {
    intersection,
    segment: segmentRuns(map),
    edge: map.edges.map((e): Target => ({ kind: 'edge', edge: e.id })),
    district: [{ kind: 'district' }],
  };
}

/**
 * Targets for `setOneWay` without a fixed direction (One-Way): every segment run with
 * `from != to`, in both directions. GDD §4 says "one-way in the chosen direction", so the player
 * picks the direction and the bots try both (ADR-031).
 */
export function directedRuns(map: GridMap): Target[] {
  const out: Target[] = [];
  for (const t of segmentRuns(map)) {
    if (t.kind !== 'segment' || (t.from.x === t.to.x && t.from.y === t.to.y)) continue;
    out.push(t, reverseSegment(t));
  }
  return out;
}

/** Up to `max` targets spread evenly over the list (deterministic; keeps lookahead cheap). */
export function spread<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return items.slice();
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.floor((i * items.length) / max)] as T);
  return out;
}
