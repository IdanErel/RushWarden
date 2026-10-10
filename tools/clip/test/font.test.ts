import { describe, expect, it } from 'vitest';
import {
  FONT_CHARS,
  GLYPH_H,
  GLYPH_W,
  SPACE_ADVANCE,
  fitText,
  glyph,
  textRects,
  textWidth,
} from '../src/font.ts';

describe('pixel font', () => {
  it('has a 5x7 bitmap for every character and lit pixels for every visible one', () => {
    for (const ch of FONT_CHARS) {
      const rows = glyph(ch);
      expect(rows, ch).toHaveLength(GLYPH_H);
      for (const r of rows ?? []) expect(r, ch).toHaveLength(GLYPH_W);
      if (ch !== ' ') expect(rows?.flat().some(Boolean), ch).toBe(true);
    }
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') expect(FONT_CHARS).toContain(ch);
  });

  it('draws lowercase as uppercase and unknown characters as blanks', () => {
    expect(textRects('round', 0, 0, 2)).toEqual(textRects('ROUND', 0, 0, 2));
    expect(textRects('~', 0, 0, 2)).toEqual([]);
    expect(glyph('~')).toBeNull();
  });

  it('keeps every rectangle inside the measured width and line height', () => {
    const s = 'Round 5 · Market Day 0:12 / 60%';
    const w = textWidth(s, 3);
    for (const r of textRects(s, 10, 20, 3)) {
      expect(r.x).toBeGreaterThanOrEqual(10);
      expect(r.x + r.w).toBeLessThanOrEqual(10 + w);
      expect(r.y + r.h).toBeLessThanOrEqual(20 + GLYPH_H * 3);
    }
  });

  it('gives spaces a narrower advance than glyphs', () => {
    expect(textWidth('A A', 1)).toBe(GLYPH_W + 1 + SPACE_ADVANCE + GLYPH_W);
    expect(textWidth('', 4)).toBe(0);
    expect(textWidth('A ', 1)).toBe(GLYPH_W + 1 + SPACE_ADVANCE);
  });

  it('shortens text that does not fit', () => {
    expect(fitText('Fare Holiday', 2, 1000)).toBe('Fare Holiday');
    const short = fitText('Delivery Window', 2, 100);
    expect(short.endsWith('..')).toBe(true);
    expect(textWidth(short, 2)).toBeLessThanOrEqual(100);
  });
});
