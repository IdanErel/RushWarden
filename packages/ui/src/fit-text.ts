/**
 * Card names that fit their card (#86 review: "Recount" broke as "Recou / nt" at 390 px). How
 * wide a name is depends on the font the device has (the UI ships none), so a fixed size that
 * fits on one system breaks words on another. `fitNames` measures instead: it steps the names'
 * font size down until every word fits whole, then gives every name the smallest size any one
 * needed, so the hand reads as one set. It stops at `minPx` (12 px: a two-line name at 12 px
 * reads better than a one-line name at 10 px); a word still too wide there breaks at its soft
 * hyphen (`displayName` in names.ts).
 */

/** True when some word of `el`, kept whole, is wider than `el` can be. */
function wordOverflows(el: HTMLElement): boolean {
  // No breaks inside words (soft hyphens off too), so an over-long word makes the text overflow.
  el.style.overflowWrap = 'normal';
  el.style.hyphens = 'none';
  const over = el.scrollWidth > el.clientWidth + 0.5;
  el.style.overflowWrap = '';
  el.style.hyphens = '';
  return over;
}

/**
 * Sizes `names` (the `.rw-name` elements of one hand or offer) to the largest size, in `stepPx`
 * steps from their stylesheet size down to `minPx`, at which no word overflows any of them.
 * Then turns soft hyphens off in every name whose words all fit whole, so the browser wraps a
 * whole word ("Bus / Priority") instead of filling the line ("Bus Pri- / ority"); only a name
 * with a word too wide at `minPx` keeps them. Returns the size in px.
 */
export function fitNames(names: readonly HTMLElement[], minPx = 12, stepPx = 0.5): number {
  for (const el of names) {
    el.style.fontSize = '';
    el.style.hyphens = '';
  }
  const first = names[0];
  if (!first) return 0;
  let size = parseFloat(getComputedStyle(first).fontSize) || 14;
  const overflowing = (): boolean => names.some(wordOverflows);
  while (size > minPx && overflowing()) {
    size = Math.max(minPx, size - stepPx);
    for (const el of names) el.style.fontSize = `${size}px`;
  }
  const whole = names.map((el) => !wordOverflows(el));
  names.forEach((el, i) => {
    if (whole[i]) el.style.hyphens = 'none';
  });
  return size;
}
