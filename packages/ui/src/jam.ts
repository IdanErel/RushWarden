/**
 * Where a gridlock started, on the result card (P1-UI readability, from the #81 feel report).
 * The scene rings the junction (`TrafficScene.gridlockOrigin`); the card points at the ring and
 * says which of the player's cards sits next to it, if any. It says "next to", not "by": the card
 * is where the jam began, which does not make it the cause (reviewer-2 on #90: taking the named
 * card away cleared the jam in 5 of 62 cases).
 */
import { t } from './i18n.js';
import type { PlacedCard } from './run/port.js';

export interface JamPoint {
  readonly x: number;
  readonly y: number;
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

/**
 * The result card's gridlock line. A junction card on the ringed junction itself reads "at your
 * X" (playtest U7: "next to" read wrong when the ring sat on the card); a card beside it reads
 * "next to your X".
 */
export function jamLine(placed: readonly PlacedCard[], at: JamPoint): string {
  const on = placed.find(
    (p) => p.target.kind === 'intersection' && p.target.x === at.x && p.target.y === at.y,
  );
  if (on) return t('result.jamAt', { name: on.card.name });
  const near = cardAtJunction(placed, at);
  return near ? t('result.jamCard', { name: near.card.name }) : t('result.jam');
}
