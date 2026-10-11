/**
 * Store assets (P1-QA-03): Steam capsules, Steam screenshots, the itch cover and the Poki and
 * CrazyGames thumbnail and cover (P1-PLT-02, GDD §12), composed from
 * frames of the game's own renderer (the clip page, ADR-028) plus vector shapes drawn here. No
 * image files, no system fonts, no stock or AI-generated images (GDD §1 constraint 3).
 *
 * This module is pure. It says which frames to grab (`SHOTS`) and, for each asset, the list of
 * draw operations that turn those frames into the image (`storeAssets`). cli/store.ts grabs the
 * frames in headless Chromium and runs the operations on a 2D canvas.
 */
import { OLD_TOWN } from '@rushwarden/render';
import { MARKET_DAY_SEED, type ClipSpec } from './director.js';
import { GLYPH_H, textRects, textWidth } from './font.js';

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A frame of the clip page to grab. */
export interface Shot {
  readonly id: string;
  readonly spec: ClipSpec;
  /** Position in the clip: a fraction of its frames (0 = first, 1 = last). */
  readonly at: number;
  /** Device pixels per logical unit (2.5 renders the 432×768 frame at 1080×1920). */
  readonly scale: number;
}

/** A grabbed frame, as cli/store.ts reports it: size and map box in device pixels. */
export interface ShotFrame {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly map: Box;
}

export type StoreOp =
  | { readonly op: 'fill'; readonly color: number }
  | {
      readonly op: 'rect';
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly color: number;
      readonly alpha?: number;
      readonly radius?: number;
    }
  | {
      readonly op: 'image';
      readonly shot: string;
      readonly src: Box;
      readonly dst: Box;
    }
  | {
      /** Open polylines stroked with round caps and joins. */
      readonly op: 'stroke';
      readonly lines: readonly (readonly (readonly [number, number])[])[];
      readonly width: number;
      readonly color: number;
    };

export interface StoreAsset {
  /** File name without extension. */
  readonly id: string;
  readonly store: 'steam' | 'itch' | 'portal' | 'promo';
  /** What the store calls it (GDD §12 table). */
  readonly role: string;
  readonly width: number;
  readonly height: number;
  /** Logo only: keep the background transparent. */
  readonly transparent: boolean;
  readonly ops: readonly StoreOp[];
}

const P = OLD_TOWN;

/**
 * Frames used. All from the Market Day clips the clip tool already renders (`MARKET_DAY_SEED`): with the
 * greedy plays (`clips/market-day.json`) and with no cards (`clips/market-day-none.json`), plus
 * round 2 of the same run (the Parade, ADR-030) for a second map.
 */
export const SHOTS: readonly Shot[] = [
  { id: 'go', spec: { seed: MARKET_DAY_SEED }, at: 0.08, scale: 2.5 },
  { id: 'flow', spec: { seed: MARKET_DAY_SEED }, at: 0.55, scale: 2.5 },
  { id: 'met', spec: { seed: MARKET_DAY_SEED }, at: 1, scale: 2.5 },
  { id: 'jam', spec: { seed: MARKET_DAY_SEED, plays: 'none' }, at: 0.55, scale: 2.5 },
  { id: 'gridlock', spec: { seed: MARKET_DAY_SEED, plays: 'none' }, at: 1, scale: 2.5 },
  { id: 'parade', spec: { seed: MARKET_DAY_SEED, round: 2 }, at: 0.5, scale: 2.5 },
  // Capsules up to 1438 px wide (page background, main capsule) are cut from the map alone.
  { id: 'jam-hi', spec: { seed: MARKET_DAY_SEED, plays: 'none' }, at: 0.55, scale: 5 },
  // The library hero is 3840 px wide and cut from the map alone, so it needs a bigger render.
  { id: 'hero', spec: { seed: MARKET_DAY_SEED, plays: 'none' }, at: 0.55, scale: 10 },
];

/** Index of the frame a shot grabs, for a clip of `frames` frames. */
export function shotFrame(shot: Pick<Shot, 'at'>, frames: number): number {
  const at = Math.min(1, Math.max(0, shot.at));
  return Math.round(at * (frames - 1));
}

/**
 * The largest box with the aspect `w:h` inside `src`, centred on `focus` (fractions of `src`)
 * and kept inside it: "object-fit: cover" as a source crop.
 */
export function coverCrop(
  src: Box,
  w: number,
  h: number,
  focus: { x: number; y: number } = { x: 0.5, y: 0.5 },
): Box {
  const aspect = w / h;
  let cw = src.w;
  let ch = cw / aspect;
  if (ch > src.h) {
    ch = src.h;
    cw = ch * aspect;
  }
  const cx = Math.min(src.w - cw, Math.max(0, src.w * focus.x - cw / 2));
  const cy = Math.min(src.h - ch, Math.max(0, src.h * focus.y - ch / 2));
  return { x: src.x + cx, y: src.y + cy, w: cw, h: ch };
}

// ---------------------------------------------------------------------------------------------
// Wordmark: "RUSHWARDEN" drawn like a transit-map line (GDD §7): strokes on a 4×6 grid with
// round caps, horizontal, vertical and 45° segments only (N and the R leg are the exceptions).

type Line = readonly (readonly [number, number])[];

const LETTERS: Readonly<Record<string, readonly Line[]>> = {
  R: [
    [
      [0, 6],
      [0, 0],
      [3, 0],
      [4, 1],
      [4, 2],
      [3, 3],
      [0, 3],
    ],
    [
      [2, 3],
      [4, 5],
      [4, 6],
    ],
  ],
  U: [
    [
      [0, 0],
      [0, 5],
      [1, 6],
      [3, 6],
      [4, 5],
      [4, 0],
    ],
  ],
  S: [
    [
      [4, 1],
      [3, 0],
      [1, 0],
      [0, 1],
      [0, 2],
      [1, 3],
      [3, 3],
      [4, 4],
      [4, 5],
      [3, 6],
      [1, 6],
      [0, 5],
    ],
  ],
  H: [
    [
      [0, 0],
      [0, 6],
    ],
    [
      [4, 0],
      [4, 6],
    ],
    [
      [0, 3],
      [4, 3],
    ],
  ],
  W: [
    [
      [0, 0],
      [0, 6],
      [2, 4],
      [4, 6],
      [4, 0],
    ],
  ],
  A: [
    [
      [0, 6],
      [0, 2],
      [2, 0],
      [4, 2],
      [4, 6],
    ],
    [
      [0, 4],
      [4, 4],
    ],
  ],
  D: [
    [
      [0, 0],
      [0, 6],
      [2, 6],
      [4, 4],
      [4, 2],
      [2, 0],
      [0, 0],
    ],
  ],
  E: [
    [
      [4, 0],
      [0, 0],
      [0, 6],
      [4, 6],
    ],
    [
      [0, 3],
      [3, 3],
    ],
  ],
  N: [
    [
      [0, 6],
      [0, 0],
      [4, 6],
      [4, 0],
    ],
  ],
};

export const WORDMARK = 'RUSHWARDEN';
const LETTER_W = 4;
const LETTER_H = 6;
const LETTER_GAP = 2.2;
/** Stroke width in grid units. */
const STROKE = 1.15;

/** Width of a wordmark line in grid units, from the first stroke centre to the last. */
function lineUnits(text: string): number {
  return text.length * LETTER_W + (text.length - 1) * LETTER_GAP;
}

/** Characters the wordmark can draw. */
export const WORDMARK_CHARS: readonly string[] = Object.keys(LETTERS);

/**
 * The wordmark, centred in `box` (which includes the stroke's half-width and the accent line
 * under it): the strokes, plus a line in the accent colour with two stations.
 */
export function wordmarkOps(
  box: Box,
  lines: readonly string[],
  color: number = P.outline,
  accent: number = P.accent,
): StoreOp[] {
  for (const l of lines)
    for (const ch of l) if (!LETTERS[ch]) throw new Error(`wordmark has no letter "${ch}"`);
  const widest = Math.max(...lines.map(lineUnits));
  const lineGap = 2.6;
  // Height: letters, gaps between lines, the accent line under the last (1.4 + 0.7) and the
  // stroke overhang on both sides.
  const hUnits = lines.length * LETTER_H + (lines.length - 1) * lineGap + 2.1 + STROKE;
  const wUnits = widest + STROKE;
  const u = Math.min(box.w / wUnits, box.h / hUnits);
  const x0 = box.x + (box.w - wUnits * u) / 2 + (STROKE / 2) * u;
  const y0 = box.y + (box.h - hUnits * u) / 2 + (STROKE / 2) * u;
  const out: Line[] = [];
  lines.forEach((text, row) => {
    const lx = x0 + ((widest - lineUnits(text)) / 2) * u;
    const ly = y0 + row * (LETTER_H + lineGap) * u;
    [...text].forEach((ch, k) => {
      const ox = lx + k * (LETTER_W + LETTER_GAP) * u;
      for (const l of LETTERS[ch] ?? []) out.push(l.map(([x, y]) => [ox + x * u, ly + y * u]));
    });
  });
  const ops: StoreOp[] = [{ op: 'stroke', lines: out, width: STROKE * u, color }];
  // Accent: a transit line under the wordmark with a station at each end.
  const ay = y0 + (lines.length * LETTER_H + (lines.length - 1) * lineGap + 1.4) * u;
  const ax = x0 - (STROKE / 2) * u;
  const aw = widest * u + STROKE * u;
  const th = 0.7 * u;
  ops.push({ op: 'rect', x: ax, y: ay, w: aw, h: th, color: accent, radius: th / 2 });
  const d = 1.5 * u;
  for (const cx of [ax + d / 2, ax + aw - d / 2])
    ops.push({
      op: 'rect',
      x: cx - d / 2,
      y: ay + th / 2 - d / 2,
      w: d,
      h: d,
      color: accent,
      radius: d / 2,
    });
  return ops;
}

/** Pixel-font text as rect ops (the clip's own 5×7 font). */
function textOps(s: string, x: number, y: number, px: number, color: number): StoreOp[] {
  return textRects(s, x, y, px).map((r) => ({ op: 'rect' as const, ...r, color }));
}

/** Largest integer font pixel at which `s` fits `maxW`, capped at `max`. */
export function fitPx(s: string, maxW: number, max: number): number {
  return Math.max(1, Math.min(max, Math.floor(maxW / textWidth(s, 1))));
}

function frameOf(frames: ReadonlyMap<string, ShotFrame>, id: string): ShotFrame {
  const f = frames.get(id);
  if (!f) throw new Error(`no frame for shot "${id}"`);
  return f;
}

/**
 * Where capsules and the hero centre their crop of the map: the upper arterial of the Old Town
 * map, where the Market Day queues build (the lower half is quiet).
 */
export const MAP_FOCUS = { x: 0.5, y: 0.28 } as const;

/** A capsule: the map cropped to fill, a ground plate, and the wordmark on it. */
function capsule(
  frames: ReadonlyMap<string, ShotFrame>,
  shot: string,
  w: number,
  h: number,
  plate: Box,
  lines: readonly string[],
): StoreOp[] {
  const f = frameOf(frames, shot);
  const focus = MAP_FOCUS;
  const pad = Math.round(Math.min(plate.w, plate.h) * 0.12);
  return [
    { op: 'fill', color: P.ground },
    { op: 'image', shot, src: coverCrop(f.map, w, h, focus), dst: { x: 0, y: 0, w, h } },
    {
      op: 'rect',
      ...plate,
      color: P.ground,
      alpha: 0.94,
      radius: Math.round(Math.min(plate.w, plate.h) * 0.08),
    },
    ...wordmarkOps(
      { x: plate.x + pad, y: plate.y + pad, w: plate.w - 2 * pad, h: plate.h - 2 * pad },
      lines,
    ),
  ];
}

/** A 1920×1080 screenshot: the full 9:16 frame (with its HUD) and a three-word caption. */
function screenshot(
  frames: ReadonlyMap<string, ShotFrame>,
  shot: string,
  caption: readonly string[],
  sub: string,
): StoreOp[] {
  const W = 1920;
  const H = 1080;
  const f = frameOf(frames, shot);
  const fh = 1000;
  const fw = Math.round((f.width / f.height) * fh);
  const fx = 180;
  const fy = (H - fh) / 2;
  const ops: StoreOp[] = [
    { op: 'fill', color: P.block },
    { op: 'rect', x: fx - 8, y: fy - 8, w: fw + 16, h: fh + 16, color: P.outline, radius: 20 },
    {
      op: 'image',
      shot,
      src: { x: 0, y: 0, w: f.width, h: f.height },
      dst: { x: fx, y: fy, w: fw, h: fh },
    },
  ];
  const tx = fx + fw + 120;
  const tw = W - tx - 120;
  const px = Math.min(...caption.map((l) => fitPx(l, tw, 16)));
  const lineH = (GLYPH_H + 4) * px;
  const subPx = fitPx(sub, tw, 6);
  const blockH = caption.length * lineH + 10 * px + GLYPH_H * subPx;
  let y = Math.round((H - blockH) / 2);
  for (const l of caption) {
    ops.push(...textOps(l, tx, y, px, P.outline));
    y += lineH;
  }
  ops.push({ op: 'rect', x: tx, y: y + 2 * px, w: 18 * px, h: 2 * px, color: P.accent });
  y += 8 * px;
  ops.push(...textOps(sub, tx, y, subPx, P.outline));
  // Small wordmark in the corner, so a screenshot shared on its own still names the game.
  ops.push(...wordmarkOps({ x: W - 120 - 300, y: H - 60 - 52, w: 300, h: 52 }, [WORDMARK]));
  return ops;
}

/**
 * The portals' 16:9 cover: the whole 9:16 game frame (map, cards and HUD) on the left, as in the
 * promo images, and the wordmark large on the right. A 16:9 crop of the portrait map alone would
 * show only a few blocks.
 */
function portalCover(frames: ReadonlyMap<string, ShotFrame>, shot: string): StoreOp[] {
  const W = 1920;
  const H = 1080;
  const f = frameOf(frames, shot);
  const fh = 1000;
  const fw = Math.round((f.width / f.height) * fh);
  const fx = 180;
  const fy = (H - fh) / 2;
  const tx = fx + fw + 120;
  return [
    { op: 'fill', color: P.ground },
    { op: 'rect', x: fx - 8, y: fy - 8, w: fw + 16, h: fh + 16, color: P.outline, radius: 20 },
    {
      op: 'image',
      shot,
      src: { x: 0, y: 0, w: f.width, h: f.height },
      dst: { x: fx, y: fy, w: fw, h: fh },
    },
    ...wordmarkOps({ x: tx, y: 300, w: W - tx - 120, h: 480 }, ['RUSH', 'WARDEN']),
  ];
}

/** Captioned promo images: shot and caption (three words, GDD §12), plus a line under it. */
export const SCREENSHOTS: readonly {
  readonly shot: string;
  readonly caption: readonly string[];
  readonly sub: string;
}[] = [
  {
    shot: 'go',
    caption: ['Place', 'the rules'],
    sub: 'Up to 2 rule cards a round. Then press Go.',
  },
  {
    shot: 'flow',
    caption: ['Watch', 'rush hour'],
    sub: '15 seconds of traffic. Nothing is random after Go.',
  },
  {
    shot: 'met',
    caption: ['Beat the', 'quota'],
    sub: 'Pass to add 1 of 3 new cards to your deck.',
  },
  { shot: 'jam', caption: ['Name', 'the jam'], sub: 'Every jam has a cause you can point at.' },
  {
    shot: 'gridlock',
    caption: ['Gridlock', 'ends it'],
    sub: 'Nothing moves for 3 seconds: the round is over.',
  },
  {
    shot: 'parade',
    caption: ['Read the', 'demand'],
    sub: 'Each edge shows where traffic comes from before you play.',
  },
];

/**
 * Every asset, from the grabbed frames. Steam sizes are Steamworks' current ones (ADR-029; the
 * "Graphical Assets" and "Library Assets" pages), which supersede the GDD §12 table. Steam
 * screenshots must show gameplay only, so they are captured from the run screen, not made here.
 */
export function storeAssets(frames: ReadonlyMap<string, ShotFrame>): StoreAsset[] {
  const a = (
    id: string,
    store: StoreAsset['store'],
    role: string,
    width: number,
    height: number,
    ops: readonly StoreOp[],
    transparent = false,
  ): StoreAsset => ({ id, store, role, width, height, transparent, ops });
  const one = [WORDMARK];
  const two = ['RUSH', 'WARDEN'];
  const cap = 'jam-hi';
  return [
    // Store assets (Steamworks "Graphical Assets": store assets page).
    a(
      'steam-header-920x430',
      'steam',
      'Header capsule',
      920,
      430,
      capsule(frames, cap, 920, 430, { x: 60, y: 104, w: 800, h: 222 }, one),
    ),
    a(
      'steam-small-462x174',
      'steam',
      'Small capsule',
      462,
      174,
      capsule(frames, cap, 462, 174, { x: 16, y: 28, w: 430, h: 118 }, one),
    ),
    a(
      'steam-main-1232x706',
      'steam',
      'Main capsule',
      1232,
      706,
      capsule(frames, cap, 1232, 706, { x: 96, y: 202, w: 1040, h: 302 }, one),
    ),
    a(
      'steam-vertical-748x896',
      'steam',
      'Vertical capsule',
      748,
      896,
      capsule(frames, cap, 748, 896, { x: 74, y: 428, w: 600, h: 360 }, two),
    ),
    a('steam-background-1438x810', 'steam', 'Page background (ambient, no text)', 1438, 810, [
      { op: 'fill', color: P.ground },
      {
        op: 'image',
        shot: cap,
        src: coverCrop(frameOf(frames, cap).map, 1438, 810, MAP_FOCUS),
        dst: { x: 0, y: 0, w: 1438, h: 810 },
      },
      // Washed out so it does not compete with the page.
      { op: 'rect', x: 0, y: 0, w: 1438, h: 810, color: P.ground, alpha: 0.72 },
    ]),
    // Library assets (Steamworks "Library Assets" page).
    a(
      'steam-library-capsule-600x900',
      'steam',
      'Library capsule',
      600,
      900,
      capsule(frames, cap, 600, 900, { x: 50, y: 560, w: 500, h: 280 }, two),
    ),
    a(
      'steam-library-header-920x430',
      'steam',
      'Library header',
      920,
      430,
      capsule(frames, cap, 920, 430, { x: 60, y: 104, w: 800, h: 222 }, one),
    ),
    a('steam-library-hero-3840x1240', 'steam', 'Library hero (no text, per Steam)', 3840, 1240, [
      { op: 'fill', color: P.ground },
      {
        op: 'image',
        shot: 'hero',
        src: coverCrop(frameOf(frames, 'hero').map, 3840, 1240, MAP_FOCUS),
        dst: { x: 0, y: 0, w: 3840, h: 1240 },
      },
    ]),
    a(
      'steam-library-logo-1280x720',
      'steam',
      'Library logo (transparent)',
      1280,
      720,
      wordmarkOps({ x: 40, y: 40, w: 1200, h: 640 }, two),
      true,
    ),
    // Captioned promo images: not Steam screenshots (Steam wants gameplay only, no marketing
    // text). For itch, press and social posts.
    ...SCREENSHOTS.map((s, k) =>
      a(
        `promo-${k + 1}-1920x1080`,
        'promo',
        `Captioned promo ${k + 1}`,
        1920,
        1080,
        screenshot(frames, s.shot, s.caption, s.sub),
      ),
    ),
    a(
      'itch-cover-630x500',
      'itch',
      'Cover image',
      630,
      500,
      capsule(frames, cap, 630, 500, { x: 65, y: 160, w: 500, h: 180 }, two),
    ),
    // Poki and CrazyGames submission package (P1-PLT-02, GDD §12 "Thumbnail 512×512 and 16:9
    // cover"). Both portals get the same two images.
    a(
      'portal-thumbnail-512x512',
      'portal',
      'Poki and CrazyGames thumbnail',
      512,
      512,
      capsule(frames, cap, 512, 512, { x: 40, y: 166, w: 432, h: 180 }, two),
    ),
    a(
      'portal-cover-1920x1080',
      'portal',
      'Poki and CrazyGames 16:9 cover',
      1920,
      1080,
      portalCover(frames, 'flow'),
    ),
  ];
}
