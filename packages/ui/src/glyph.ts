/**
 * Card glyph v0 (GDD §7: "48×48 generated from the card's primitives (controller glyph + target
 * shape + tag color); tier-2 cards get a gold border and a second ring"). Pure: returns SVG
 * elements as data, so the same card always gives the same glyph and tests need no DOM.
 *
 * Layers, back to front: a tag-coloured ring with a light tag tint; the target shape drawn as
 * road (intersection = crossing, segment = one road with its lane divider, edge = a road that
 * enters from the border, district = a 3×3 street grid); then the controller glyph from the
 * renderer's own `controllerShapes`, so a card's glyph matches what it puts on the map.
 */
import { OLD_TOWN, controllerShapes, type Shape, type Token } from '@rushwarden/render/core';
import type { UiCard } from './run/port.js';
import { TAG_COLOR, css } from './tags.js';

export const GLYPH_SIZE = 48;
/** Tier-2 border and second ring (§7 "gold border"). */
export const TIER2_GOLD = 0xc9a227;

export interface GlyphElement {
  readonly tag: 'circle' | 'rect' | 'polygon' | 'line';
  readonly attrs: Readonly<Record<string, string | number>>;
}

const C = GLYPH_SIZE / 2;
/** Controller glyph scale: one intersection tile = 16 px, the crossing's square. */
const TILE = 16;
const ROAD = 10;

const paint = (token: Token): string => css(OLD_TOWN[token]);

function road(x: number, y: number, w: number, h: number): GlyphElement {
  return { tag: 'rect', attrs: { x, y, width: w, height: h, fill: paint('road') } };
}

function targetShape(card: UiCard, tag: string): GlyphElement[] {
  const half = ROAD / 2;
  switch (card.target) {
    case 'intersection':
      return [
        road(8, C - half, 32, ROAD),
        road(C - half, 8, ROAD, 32),
        {
          tag: 'rect',
          attrs: {
            x: C - TILE / 2,
            y: C - TILE / 2,
            width: TILE,
            height: TILE,
            rx: 2,
            fill: paint('intersection'),
          },
        },
      ];
    case 'segment':
      return [
        road(8, C - half - 1, 32, ROAD + 2),
        {
          tag: 'line',
          attrs: { x1: 11, y1: C, x2: 37, y2: C, stroke: paint('divider'), 'stroke-width': 2 },
        },
      ];
    case 'edge':
      return [
        road(4, C - half, 30, ROAD),
        // The map border the road enters through, in the tag colour, and the way in.
        { tag: 'line', attrs: { x1: 8, y1: 12, x2: 8, y2: 36, stroke: tag, 'stroke-width': 3 } },
        {
          tag: 'polygon',
          attrs: { points: `30,${C - 8} 40,${C} 30,${C + 8}`, fill: paint('road') },
        },
      ];
    case 'district':
      return [road(10, 17, 28, 4), road(10, 27, 28, 4), road(17, 10, 4, 28), road(27, 10, 4, 28)];
  }
}

const n = (v: number): number => Math.round(v * 100) / 100;

/** A renderer shape (unit = one tile, centred) as an SVG element at the glyph's centre. */
function fromShape(s: Shape): GlyphElement {
  const fill = s.fill ? paint(s.fill) : 'none';
  const stroke = s.stroke
    ? { stroke: paint(s.stroke), 'stroke-width': n((s.strokeWidth ?? 0.05) * TILE) }
    : {};
  switch (s.kind) {
    case 'rect':
      return {
        tag: 'rect',
        attrs: {
          x: n(C + s.x * TILE),
          y: n(C + s.y * TILE),
          width: n(s.w * TILE),
          height: n(s.h * TILE),
          rx: n(s.r * TILE),
          fill,
          ...stroke,
        },
      };
    case 'circle':
      return {
        tag: 'circle',
        attrs: { cx: n(C + s.x * TILE), cy: n(C + s.y * TILE), r: n(s.r * TILE), fill, ...stroke },
      };
    case 'poly': {
      const pts: string[] = [];
      for (let i = 0; i + 1 < s.points.length; i += 2)
        pts.push(`${n(C + (s.points[i] ?? 0) * TILE)},${n(C + (s.points[i + 1] ?? 0) * TILE)}`);
      return { tag: 'polygon', attrs: { points: pts.join(' '), fill, ...stroke } };
    }
  }
}

/** The card's 48×48 glyph as SVG elements, back to front. */
export function cardGlyph(card: UiCard): GlyphElement[] {
  const tag = css(TAG_COLOR[card.tags[0] ?? 'FLOW']);
  const gold = css(TIER2_GOLD);
  const out: GlyphElement[] = [
    {
      tag: 'circle',
      attrs: {
        cx: C,
        cy: C,
        r: 22,
        fill: tag,
        'fill-opacity': 0.14,
        stroke: card.tier === 2 ? gold : tag,
        'stroke-width': card.tier === 2 ? 3 : 2,
      },
    },
  ];
  if (card.tier === 2)
    out.push({
      tag: 'circle',
      attrs: { cx: C, cy: C, r: 18.5, fill: 'none', stroke: gold, 'stroke-width': 1.5 },
    });
  out.push(...targetShape(card, tag));
  if (card.controller) out.push(...controllerShapes(card.controller).map(fromShape));
  return out;
}
