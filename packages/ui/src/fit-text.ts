/**
 * Card names that fit their card (#86 review: "Recount" broke as "Recou / nt" at 390 px). How
 * wide a name is depends on the font the device has (the UI ships none), so a fixed size that
 * fits on one system breaks words on another. `fitNames` measures instead: it steps the names'
 * font size down until no name has a word wider than its card, then gives every name the
 * smallest size any one needed, so the hand reads as one set. A word that does not fit even at
 * `minPx` (a long one like "Roundabout" on the narrowest phones) still wraps inside its card
 * (`overflow-wrap: anywhere` in styles.css).
 */

/** True when some word of `el` is wider than `el` can be. */
function wordOverflows(el: HTMLElement): boolean {
  // With wrapping only at spaces and hyphens, an over-long word makes the text overflow.
  el.style.overflowWrap = 'normal';
  el.style.hyphens = 'manual';
  const over = el.scrollWidth > el.clientWidth + 0.5;
  el.style.overflowWrap = '';
  el.style.hyphens = '';
  return over;
}

/**
 * Sizes `names` (the `.rw-name` elements of one hand or offer) to the largest size, in `stepPx`
 * steps from their stylesheet size down to `minPx`, at which no word overflows any of them.
 * Returns that size in px.
 */
export function fitNames(names: readonly HTMLElement[], minPx = 10, stepPx = 0.5): number {
  for (const el of names) el.style.fontSize = '';
  const first = names[0];
  if (!first) return 0;
  let size = parseFloat(getComputedStyle(first).fontSize) || 14;
  const overflowing = (): boolean => names.some(wordOverflows);
  while (size > minPx && overflowing()) {
    size = Math.max(minPx, size - stepPx);
    for (const el of names) el.style.fontSize = `${size}px`;
  }
  return size;
}
