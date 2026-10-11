/**
 * Map size for the run screen (GDD §8: map on top, hand at the bottom; portrait-first, scaled
 * to fit; "landscape rearranges HUD to the right", see `wideLayout`). The map keeps the 7×9 grid's aspect plus the renderer's 6 px heat-strip gutter on
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

/** Landscape layout (GDD §8): page padding and the gap between the map and the right column. */
export const WIDE_PAD = 16;
export const WIDE_GAP = 24;
/** The right column (HUD, controls, hand): 28% of the width, within these bounds. */
export const SIDE_MIN_W = 380;
export const SIDE_MAX_W = 520;

/**
 * Landscape: wider than tall and room for the right column next to a usable map. A phone held
 * sideways (844×390) qualifies; a tablet in portrait does not.
 */
export function isWide(viewW: number, viewH: number): boolean {
  return viewW > viewH && viewW >= SIDE_MIN_W + MAP_MIN_W + WIDE_GAP + 2 * WIDE_PAD + 120;
}

/**
 * Landscape layout: the board stays upright (7×9) on the left and grows to the full height left
 * after the page padding; the HUD, controls and hand go in a right column of width `side`.
 */
export function wideLayout(
  viewW: number,
  viewH: number,
): { side: number; map: { width: number; height: number } } {
  const side = Math.round(Math.min(SIDE_MAX_W, Math.max(SIDE_MIN_W, viewW * 0.28)));
  const availW = viewW - side - WIDE_GAP - 2 * WIDE_PAD;
  const availH = viewH - 2 * WIDE_PAD;
  let width = Math.max(availW, MAP_MIN_W);
  if (mapHeightFor(width) > availH) width = mapWidthFor(availH);
  width = Math.max(MAP_MIN_W, Math.floor(width));
  return { side, map: { width, height: mapHeightFor(width) } };
}
