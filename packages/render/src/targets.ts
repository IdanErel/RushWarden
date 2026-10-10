/**
 * Card targets on the map (GDD §8 place phase): where they are, which one a tap hits, and how the
 * keyboard cursor moves between them. Pure: no Pixi, no DOM. Lengths in tile units unless the
 * name ends in `Px`.
 */
import { GRID_HEIGHT, GRID_WIDTH, type GridMap, type Side } from '@rushwarden/sim';
import type { ViewFit } from './geometry.js';

/** A place a card can go, as the renderer draws it. */
export type TargetMark =
  | { readonly kind: 'intersection'; readonly x: number; readonly y: number }
  /** A road segment, identified by one of its road tiles. */
  | { readonly kind: 'segment'; readonly x: number; readonly y: number }
  | { readonly kind: 'edge'; readonly edge: number }
  | { readonly kind: 'district' };

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Stable string key for a target, used for undo and test hooks. */
export function targetKey(t: TargetMark): string {
  switch (t.kind) {
    case 'intersection':
    case 'segment':
      return `${t.kind}:${t.x},${t.y}`;
    case 'edge':
      return `edge:${t.edge}`;
    case 'district':
      return 'district';
  }
}

/** The area a target covers, in tile units (district = the whole grid). */
export function targetTileRect(t: TargetMark, map: GridMap): Rect | null {
  switch (t.kind) {
    case 'intersection':
    case 'segment':
      return { x: t.x, y: t.y, w: 1, h: 1 };
    case 'edge': {
      const e = map.edges.find((m) => m.id === t.edge);
      return e ? { x: e.tile.x, y: e.tile.y, w: 1, h: 1 } : null;
    }
    case 'district':
      return { x: 0, y: 0, w: GRID_WIDTH, h: GRID_HEIGHT };
  }
}

/** Converts a tile-unit rect to canvas CSS px for a given fit. */
export function rectToPx(r: Rect, fit: ViewFit): Rect {
  return {
    x: fit.originX + r.x * fit.tilePx,
    y: fit.originY + r.y * fit.tilePx,
    w: r.w * fit.tilePx,
    h: r.h * fit.tilePx,
  };
}

/** The tile under a canvas CSS-px point, or null outside the grid. */
export function tileFromPoint(
  px: number,
  py: number,
  fit: ViewFit,
): { x: number; y: number } | null {
  const x = Math.floor((px - fit.originX) / fit.tilePx);
  const y = Math.floor((py - fit.originY) / fit.tilePx);
  if (x < 0 || y < 0 || x >= GRID_WIDTH || y >= GRID_HEIGHT) return null;
  return { x, y };
}

/**
 * Which of `targets` a tap at tile (x, y) means: a tile target on that tile, else an edge whose
 * tile it is, else the district target if one is offered. Returns its index or -1.
 */
export function hitTarget(
  targets: readonly TargetMark[],
  tile: { x: number; y: number } | null,
  map: GridMap,
): number {
  if (tile) {
    const exact = targets.findIndex(
      (t) =>
        (t.kind === 'intersection' || t.kind === 'segment') && t.x === tile.x && t.y === tile.y,
    );
    if (exact >= 0) return exact;
    const edge = targets.findIndex((t) => {
      if (t.kind !== 'edge') return false;
      const e = map.edges.find((m) => m.id === t.edge);
      return !!e && e.tile.x === tile.x && e.tile.y === tile.y;
    });
    if (edge >= 0) return edge;
  }
  return targets.findIndex((t) => t.kind === 'district');
}

function centre(t: TargetMark, map: GridMap): [number, number] {
  const r = targetTileRect(t, map);
  return r ? [r.x + r.w / 2, r.y + r.h / 2] : [0, 0];
}

const DIR: Readonly<Record<Side, readonly [number, number]>> = {
  n: [0, -1],
  e: [1, 0],
  s: [0, 1],
  w: [-1, 0],
};

/**
 * Keyboard cursor (GDD §8 "arrows move a target cursor"): from target `from`, the nearest target
 * whose centre lies in direction `dir` (within a 45° cone first, then the whole half-plane).
 * Stays put when there is none. With no current cursor, starts at index 0.
 */
export function moveCursor(
  targets: readonly TargetMark[],
  from: number | null,
  dir: Side,
  map: GridMap,
): number | null {
  if (targets.length === 0) return null;
  if (from === null || from < 0 || from >= targets.length) return 0;
  const fromT = targets[from];
  if (!fromT) return 0;
  const [fx, fy] = centre(fromT, map);
  const [dx, dy] = DIR[dir];
  let best = -1;
  let bestScore = Infinity;
  for (const cone of [true, false]) {
    targets.forEach((t, i) => {
      if (i === from) return;
      const [x, y] = centre(t, map);
      const along = (x - fx) * dx + (y - fy) * dy;
      const across = Math.abs((x - fx) * dy - (y - fy) * dx);
      if (along <= 0 || (cone && across > along)) return;
      const score = along + 2 * across;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0) return best;
  }
  return from;
}
