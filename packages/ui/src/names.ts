/**
 * Card names as the cards show them (the coordinator's ruling on #89: readability over
 * spectacle). A name that does not fit its card may break only at a space, a hyphen ("One-Way")
 * or a soft hyphen (U+00AD) placed at a natural point here: "Round­about", never "Roundab / out".
 * The soft hyphens live in the UI's display string only; content's names and ids are unchanged,
 * and accessible names use the plain name.
 *
 * Every word of 6 letters or more in a card name has an entry: at the narrowest phones (360 px)
 * on a wide fallback font, a 6-letter word can already be wider than its card at the 12 px floor
 * (`fitNames`). A unit test fails when content adds a name with a long word that has none.
 */

export const SOFT_HYPHEN = '­';

/** Break points per word, marked with `·`. Words of 6+ letters in card names. */
export const HYPHENATION: Readonly<Record<string, string>> = {
  Roundabout: 'Round·about',
  Staggered: 'Stag·gered',
  Overtime: 'Over·time',
  Delivery: 'De·liv·ery',
  Priority: 'Pri·or·ity',
  Recount: 'Re·count',
  Holiday: 'Holi·day',
  Culture: 'Cul·ture',
  Program: 'Pro·gram',
  Express: 'Ex·press',
  Detour: 'De·tour',
  Signal: 'Sig·nal',
  Second: 'Sec·ond',
  Window: 'Win·dow',
  Remove: 'Re·move',
};

/** Words that need an entry: 6+ letters, not already split by a hyphen. */
export function needsHyphenation(word: string): boolean {
  return word.length >= 6 && !word.includes('-');
}

/** The name with soft hyphens at its words' natural break points. */
export function displayName(name: string): string {
  return name
    .split(/(\s+)/)
    .map((w) => (HYPHENATION[w] ?? w).replaceAll('·', SOFT_HYPHEN))
    .join('');
}
