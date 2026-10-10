/**
 * A 5×7 pixel font for the clip's captions, drawn as rectangles. It is authored here, in the
 * repo, so the clip needs no font file and no system font (GDD §1 constraint 3: assets are
 * produced in-repo; and system fonts differ between machines, which would break "deterministic
 * output from a seed"). Uppercase only; unknown characters draw as a blank.
 */

export const GLYPH_W = 5;
export const GLYPH_H = 7;
/** Blank columns between glyphs. */
export const TRACKING = 1;
/** Advance of a space, in font pixels (narrower than a glyph, so words read as words). */
export const SPACE_ADVANCE = 3;

function advance(ch: string): number {
  return ch === ' ' ? SPACE_ADVANCE : GLYPH_W + TRACKING;
}

const G: Readonly<Record<string, string>> = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.',
  D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####',
  F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.####',
  H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '.###.|..#..|..#..|..#..|..#..|..#..|.###.',
  J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#',
  N: '#...#|#...#|##..#|#.#.#|#..##|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',
  R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.',
  T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.',
  X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
  Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.',
  '1': '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  '2': '.###.|#...#|....#|...#.|..#..|.#...|#####',
  '3': '####.|....#|....#|.###.|....#|....#|####.',
  '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.',
  '5': '#####|#....|####.|....#|....#|#...#|.###.',
  '6': '..##.|.#...|#....|####.|#...#|#...#|.###.',
  '7': '#####|....#|...#.|..#..|.#...|.#...|.#...',
  '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  '9': '.###.|#...#|#...#|.####|....#|...#.|.##..',
  ' ': '.....|.....|.....|.....|.....|.....|.....',
  '·': '.....|.....|.....|..#..|.....|.....|.....',
  '/': '....#|....#|...#.|..#..|.#...|#....|#....',
  ':': '.....|..#..|..#..|.....|..#..|..#..|.....',
  '-': '.....|.....|.....|.###.|.....|.....|.....',
  '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
  '.': '.....|.....|.....|.....|.....|.....|..#..',
  '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..',
  '%': '##..#|##..#|...#.|..#..|.#...|#..##|#..##',
  '×': '.....|#...#|.#.#.|..#..|.#.#.|#...#|.....',
};

/** Rows of a glyph as booleans, or null for a character the font lacks. */
export function glyph(ch: string): readonly boolean[][] | null {
  const rows = G[ch];
  if (rows === undefined) return null;
  return rows.split('|').map((r) => [...r].map((c) => c === '#'));
}

/** Characters the font can draw. */
export const FONT_CHARS: readonly string[] = Object.keys(G);

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Width of `text` in pixels at pixel size `px`, without trailing tracking. */
export function textWidth(text: string, px: number): number {
  const chars = [...text];
  if (chars.length === 0) return 0;
  const cols = chars.reduce((n, ch) => n + advance(ch), 0);
  const last = chars[chars.length - 1] ?? ' ';
  // The last glyph has no tracking after it; a trailing space still counts its advance.
  return (last === ' ' ? cols : cols - TRACKING) * px;
}

/**
 * `text` as rectangles with its top-left at (x, y), each font pixel `px` units square. Runs of
 * lit pixels in a row merge into one rectangle, so a caption is a few dozen draw calls.
 * Lowercase is drawn as uppercase.
 */
export function textRects(text: string, x: number, y: number, px: number): Rect[] {
  const out: Rect[] = [];
  let cx = x;
  for (const ch of text.toUpperCase()) {
    if (ch === ' ') {
      cx += SPACE_ADVANCE * px;
      continue;
    }
    const rows = glyph(ch) ?? glyph(' ');
    rows?.forEach((row, ry) => {
      let start = -1;
      for (let rx = 0; rx <= GLYPH_W; rx++) {
        const on = row[rx] === true;
        if (on && start < 0) start = rx;
        if (!on && start >= 0) {
          out.push({ x: cx + start * px, y: y + ry * px, w: (rx - start) * px, h: px });
          start = -1;
        }
      }
    });
    cx += advance(ch) * px;
  }
  return out;
}

/** Shortens `text` with a trailing "." run until it fits `maxWidth` at size `px`. */
export function fitText(text: string, px: number, maxWidth: number): string {
  if (textWidth(text, px) <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && textWidth(`${t}..`, px) > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}..`;
}
