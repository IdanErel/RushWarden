import { GRID_HEIGHT, GRID_WIDTH, type GridMap, type Target } from '@rushwarden/sim';
import type { TargetKind } from '@rushwarden/app';

function isRoad(map: GridMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= GRID_WIDTH || y >= GRID_HEIGHT) return false;
  return map.tiles[y * GRID_WIDTH + x]?.kind === 'road';
}

/**
 * Every target of each kind on a map, in a fixed order: intersections are road tiles with 3–4
 * road neighbours (§3); segments are single road tiles that are not intersections; edges and the
 * district as they are.
 */
export function candidateTargets(map: GridMap): Record<TargetKind, Target[]> {
  const intersection: Target[] = [];
  const segment: Target[] = [];
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
      else segment.push({ kind: 'segment', from: { x, y }, to: { x, y } });
    }
  return {
    intersection,
    segment,
    edge: map.edges.map((e): Target => ({ kind: 'edge', edge: e.id })),
    district: [{ kind: 'district' }],
  };
}

/** Up to `max` targets spread evenly over the list (deterministic; keeps lookahead cheap). */
export function spread<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return items.slice();
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.floor((i * items.length) / max)] as T);
  return out;
}
