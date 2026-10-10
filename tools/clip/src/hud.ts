/**
 * The clip's captions around the map: what round this is, which cards were played (the cause a
 * viewer should be able to point at, GDD pillar 1), and throughput filling towards the quota.
 * Laid out as plain rectangles in the clip's logical 432×768 frame (9:16); the page draws them
 * with Pixi. Pure, so the layout is unit-tested without a browser.
 */
import { OLD_TOWN, type Palette } from '@rushwarden/render';
import type { BossCondition } from '@rushwarden/sim';
import { GLYPH_H, fitText, textRects, textWidth, type Rect } from './font.js';

/** Logical frame size (9:16). Rendered at `scale` device pixels per unit (2.5 → 1080×1920). */
export const FRAME_W = 432;
export const FRAME_H = 768;
const MARGIN = 16;

/**
 * Archetype tag colours: the same values as the run screen's `TAG_COLOR` (packages/ui, PR #31),
 * copied until that lands so a card chip in the clip matches the card frame in the game.
 */
export const TAG_COLOR: Readonly<Record<string, number>> = {
  FLOW: 0x1f7f75,
  MASS: 0x2f63b8,
  TOLL: 0x9a6c00,
  CHAOS: 0xb83a24,
  TEMPO: 0x6e45ad,
};

/** GDD §5 boss names, as the HUD shows them. */
const BOSS_NAME: Readonly<Partial<Record<BossCondition, string>>> = {
  'market-day': 'Market Day',
  parade: 'Parade',
  festival: 'Festival',
  'stadium-exit': 'Stadium Exit',
  'signal-outage': 'Signal Outage',
  blackout: 'Blackout',
  convoy: 'Convoy',
  marathon: 'Marathon',
  'gridlock-drill': 'Gridlock Drill',
};

export interface HudCard {
  readonly name: string;
  /** First archetype tag; picks the chip colour. */
  readonly tag: string;
}

export interface HudState {
  readonly district: string;
  readonly round: number;
  readonly rush: boolean;
  readonly boss: BossCondition | null;
  readonly cards: readonly HudCard[];
  readonly quota: number;
  /** Throughput at the shown tick. */
  readonly throughput: number;
  /** Final throughput of the round; sets the bar's scale so it never overflows. */
  readonly finalThroughput: number;
  /** Shown tick, for the clock. */
  readonly tick: number;
  /** Set once the last tick is on screen. */
  readonly outcome: 'pass' | 'fail' | 'gridlock' | null;
}

export interface DrawOp extends Rect {
  readonly color: number;
  readonly alpha?: number;
  readonly radius?: number;
}

/** Where the map sits, so captions stay out of it (from `fitGrid` with the heat gutter). */
export interface MapBox {
  readonly top: number;
  readonly bottom: number;
}

function text(ops: DrawOp[], s: string, x: number, y: number, px: number, color: number): void {
  for (const r of textRects(s, x, y, px)) ops.push({ ...r, color });
}

/** A rounded chip with centred text; returns its width. */
function chip(
  ops: DrawOp[],
  label: string,
  x: number,
  y: number,
  px: number,
  fill: number,
  ink: number,
): number {
  const padX = 4 * px;
  const h = GLYPH_H * px + 6 * px;
  const w = textWidth(label, px) + 2 * padX;
  ops.push({ x, y, w, h, color: fill, radius: 2 * px });
  text(ops, label, x + padX, y + 3 * px, px, ink);
  return w;
}

/** "0:07": seconds of the round elapsed at this tick, as the game counts them (20 ticks/s). */
export function clock(tick: number): string {
  const s = Math.floor(tick / 20);
  return `0:${String(s).padStart(2, '0')}`;
}

export function title(state: Pick<HudState, 'round' | 'rush' | 'boss'>): string {
  const boss = state.boss ? (BOSS_NAME[state.boss] ?? state.boss) : null;
  if (boss) return `Round ${state.round} · ${boss}`;
  return state.rush ? `Round ${state.round} · Rush` : `Round ${state.round}`;
}

/** Bar fill in [0, 1] and the quota mark's position on the same scale. */
export function barScale(
  throughput: number,
  quota: number,
  finalThroughput: number,
): { fill: number; mark: number } {
  const scale = Math.max(quota, finalThroughput, 1) * 1.1;
  return {
    fill: Math.min(1, Math.max(0, throughput / scale)),
    mark: Math.min(1, quota / scale),
  };
}

/** Draw list for one frame. */
export function hudOps(state: HudState, map: MapBox, palette: Palette = OLD_TOWN): DrawOp[] {
  const ops: DrawOp[] = [];
  const ink = palette.outline;
  const W = FRAME_W;
  const inner = W - 2 * MARGIN;

  // Top band: wordmark and district, round title, card chips.
  const top = Math.max(0, Math.floor((map.top - 94) / 2));
  text(ops, 'Rushwarden', MARGIN, top + 4, 2, ink);
  const district = fitText(state.district, 2, inner / 2);
  text(ops, district, W - MARGIN - textWidth(district, 2), top + 4, 2, palette.accent);
  text(ops, fitText(title(state), 3, inner), MARGIN, top + 28, 3, ink);
  let x = MARGIN;
  const chipY = top + 60;
  const cards = state.cards.length
    ? state.cards
    : [{ name: 'No cards played', tag: '' } satisfies HudCard];
  for (const c of cards) {
    const room = W - MARGIN - x;
    if (room < 40) break;
    const label = fitText(c.name, 2, room - 16);
    const fill = TAG_COLOR[c.tag] ?? palette.road;
    x += chip(ops, label, x, chipY, 2, fill, palette.glyph) + 8;
  }

  // Bottom band: label row, quota bar, big numbers or the outcome.
  const base = map.bottom + Math.max(0, Math.floor((FRAME_H - map.bottom - 96) / 2));
  text(ops, 'Through', MARGIN, base + 4, 2, ink);
  const t = clock(state.tick);
  text(ops, t, W - MARGIN - textWidth(t, 2), base + 4, 2, ink);

  const barY = base + 24;
  const barH = 22;
  const { fill, mark } = barScale(state.throughput, state.quota, state.finalThroughput);
  ops.push({ x: MARGIN, y: barY, w: inner, h: barH, color: palette.block, radius: 6 });
  const met = state.throughput >= state.quota;
  if (fill > 0) {
    ops.push({
      x: MARGIN,
      y: barY,
      w: Math.max(barH / 2, Math.round(inner * fill)),
      h: barH,
      color: met ? palette.signalGreen : palette.accent,
      radius: 6,
    });
  }
  const mx = MARGIN + Math.round(inner * mark);
  ops.push({ x: mx - 2, y: barY - 5, w: 4, h: barH + 10, color: ink });

  const numY = barY + barH + 14;
  const big = String(state.throughput);
  text(ops, big, MARGIN, numY, 4, ink);
  const quotaLabel = ` / ${state.quota} quota`;
  text(ops, quotaLabel, MARGIN + textWidth(big, 4), numY + 14, 2, ink);

  if (state.outcome) {
    const [label, bg, fg] =
      state.outcome === 'gridlock'
        ? ['Gridlock', ink, palette.glyph]
        : state.outcome === 'pass'
          ? ['Quota met', palette.signalGreen, ink]
          : ['Quota missed', palette.stop, palette.glyph];
    const w = textWidth(label, 3) + 24;
    chip(ops, label, W - MARGIN - w, numY - 2, 3, bg, fg);
  }
  return ops;
}
