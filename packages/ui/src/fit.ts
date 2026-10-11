/**
 * Map size for the run screen (GDD §8: map on top, hand at the bottom; portrait-first, scaled
 * to fit). The map keeps the 7×9 grid's aspect plus the renderer's 6 px heat-strip gutter on
 * each side, is at most `MAP_MAX_W` wide, and shrinks to the height left after the HUD and the
 * hand, so the whole column fits the viewport without a page scroll (desktop landscape too).
 */
export const MAP_MAX_W = 430;
/** Below this the map stops shrinking (a 4-inch phone in landscape scrolls rather than vanish). */
export const MAP_MIN_W = 180;
const GUTTER = 12;
/**
 * Height kept free under the map for what a turn adds below it: a row of placed-card chips
 * (44 px + 8 px gap) and one more line of card text (20 px).
 */
export const TURN_ALLOWANCE_PX = 72;

export function mapHeightFor(width: number): number {
  return Math.round(((width - GUTTER) / 7) * 9 + GUTTER);
}

export function mapWidthFor(height: number): number {
  return Math.floor(((height - GUTTER) / 9) * 7 + GUTTER);
}

/** The largest map that fits `availWidth` × `availHeight` (CSS px). */
export function fitMap(availWidth: number, availHeight: number): { width: number; height: number } {
  let width = Math.min(availWidth > 0 ? availWidth : MAP_MAX_W, MAP_MAX_W);
  if (mapHeightFor(width) > availHeight) width = mapWidthFor(availHeight);
  width = Math.max(MAP_MIN_W, Math.floor(width));
  return { width, height: mapHeightFor(width) };
}
