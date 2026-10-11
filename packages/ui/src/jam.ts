/**
 * Naming where a gridlock started on the result card (P1-UI readability, from the #81 feel
 * report). The scene rings the junction (`TrafficScene.gridlockOrigin`); this names it with a grid
 * reference and the card the player put there, if any, so the jam can be traced to a play.
 */
import type { PlacedCard } from './run/port.js';

export interface JamPoint {
  readonly x: number;
  readonly y: number;
}

/** Spreadsheet-style reference: columns A–G left to right, rows 1–9 top to bottom ("D5"). */
export function gridRef(p: JamPoint): string {
  return `${String.fromCharCode(65 + p.x)}${p.y + 1}`;
}

const touches = (a: JamPoint, b: JamPoint): boolean =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

/**
 * The first placed card at the junction: a junction card on it, or a road card whose run ends
 * next to it. District and edge cards act everywhere or off the map, so they name no junction.
 */
export function cardAtJunction(placed: readonly PlacedCard[], at: JamPoint): PlacedCard | null {
  for (const p of placed) {
    const t = p.target;
    if (t.kind === 'intersection' && t.x === at.x && t.y === at.y) return p;
    if (t.kind !== 'segment') continue;
    const ends = p.segment ? [p.segment.from, p.segment.to] : [t];
    if (ends.some((e) => touches(e, at))) return p;
  }
  return null;
}
