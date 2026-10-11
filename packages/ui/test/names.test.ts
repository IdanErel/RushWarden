import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HYPHENATION, SOFT_HYPHEN, displayName, needsHyphenation } from '../src/names.js';

/** Every card name in content. */
function contentNames(): string[] {
  const dir = fileURLToPath(new URL('../../content/cards/', import.meta.url));
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => (JSON.parse(readFileSync(join(dir, f), 'utf8')) as { name: string }).name);
}

describe('card display names (#89 ruling: break only at a natural point)', () => {
  it('puts soft hyphens at the marked points and nowhere else', () => {
    expect(displayName('Roundabout')).toBe(`Round${SOFT_HYPHEN}about`);
    expect(displayName('Bus Priority')).toBe(`Bus Pri${SOFT_HYPHEN}or${SOFT_HYPHEN}ity`);
    expect(displayName('One-Way')).toBe('One-Way');
    expect(displayName('Toll Booth')).toBe('Toll Booth');
  });

  it('every content card word of 6+ letters has break points', () => {
    const names = contentNames(); // the dev stand-ins use the same names
    expect(names).toContain('Roundabout');
    const missing = new Set<string>();
    for (const n of names)
      for (const w of n.split(/\s+/)) if (needsHyphenation(w) && !HYPHENATION[w]) missing.add(w);
    expect([...missing]).toEqual([]);
  });

  it('entries only add break points: without them the word is unchanged', () => {
    for (const [word, marked] of Object.entries(HYPHENATION)) {
      expect(marked.replaceAll('·', '')).toBe(word);
      expect(marked).toContain('·');
      // No piece is a single letter ("Pri-or-i-ty" would strand an "i").
      for (const part of marked.split('·')) expect(part.length, word).toBeGreaterThanOrEqual(2);
    }
  });
});
