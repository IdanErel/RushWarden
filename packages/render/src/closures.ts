/**
 * Closed segments (the Parade boss, ADR-022): `RoundInput.closedSegments`, resolved through the
 * sim's own `closedLinkMask` so the renderer greys out exactly the links the sim closes (a link
 * touching any closed tile is closed in both directions). Pure: returns tiles and barrier rects
 * in tile units; the scene draws them.
 */
import {
  GRID_WIDTH,
  closedLinkMask,
  type GridMap,
  type SegmentId,
  type Side,
  type World,
} from '@rushwarden/sim';
import { SIDE_VEC, lanesAt, roadWidth } from './geometry.js';
import type { TileRect } from './controller-state.js';

/** Barrier thickness across the road, in tiles. */
export const BARRIER = 0.12;

export interface Closures {
  /** Plain road tiles on closed links: drawn greyed out. */
  readonly tiles: readonly { x: number; y: number }[];
  /** One barrier across the road at each end of each closed segment. */
  readonly barriers: readonly TileRect[];
}

export const NO_CLOSURES: Closures = { tiles: [], barriers: [] };

/** Tiles and barriers for a round's closed segments. Throws like `closedLinkMask` on bad input. */
export function closures(
  map: GridMap,
  world: World,
  segments: readonly SegmentId[] | undefined,
): Closures {
  const mask = closedLinkMask(world, segments ?? []);
  if (!mask) return NO_CLOSURES;
  const seen = new Set<number>();
  for (const link of world.links) if (mask[link.id]) for (const t of link.tiles) seen.add(t);
  const tiles = [...seen]
    .sort((a, b) => a - b)
    .map((t) => ({ x: t % GRID_WIDTH, y: Math.floor(t / GRID_WIDTH) }));
  const barriers: TileRect[] = [];
  for (const { from, to } of segments ?? []) {
    const horizontal = from.y === to.y && from.x !== to.x;
    const vertical = from.x === to.x && from.y !== to.y;
    // Barriers sit at the outer edge of each end tile, across the road.
    const ends: [{ x: number; y: number }, Side][] = horizontal
      ? [
          [from.x < to.x ? from : to, 'w'],
          [from.x < to.x ? to : from, 'e'],
        ]
      : vertical
        ? [
            [from.y < to.y ? from : to, 'n'],
            [from.y < to.y ? to : from, 's'],
          ]
        : // A one-tile segment: barriers on both sides along its road.
          lanesAt(map, from.x - 1, from.y) > 0 || lanesAt(map, from.x + 1, from.y) > 0
          ? [
              [from, 'w'],
              [from, 'e'],
            ]
          : [
              [from, 'n'],
              [from, 's'],
            ];
    for (const [tile, side] of ends) {
      const w = roadWidth(lanesAt(map, tile.x, tile.y));
      const [sx, sy] = SIDE_VEC[side];
      // Centre of the barrier, just inside the tile's edge on `side`.
      const cx = tile.x + 0.5 + sx * (0.5 - BARRIER / 2);
      const cy = tile.y + 0.5 + sy * (0.5 - BARRIER / 2);
      const across = sx !== 0 ? { w: BARRIER, h: w } : { w, h: BARRIER };
      barriers.push({ x: cx - across.w / 2, y: cy - across.h / 2, ...across });
    }
  }
  return { tiles, barriers };
}
