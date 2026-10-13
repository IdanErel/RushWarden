import { describe, expect, it } from 'vitest';
import { GLYPH_SIZE, TIER2_GOLD, cardGlyph, type GlyphElement } from '../src/glyph.js';
import { portalRules } from '../src/config.js';
import type { UiCard } from '../src/run/port.js';
import { TAG_COLOR, css } from '../src/tags.js';

const card = (over: Partial<UiCard> = {}): UiCard => ({
  id: 'c',
  uid: 1,
  name: 'C',
  cost: 1,
  target: 'intersection',
  tags: ['FLOW'],
  text: '',
  tier: 1,
  ...over,
});

const key = (els: readonly GlyphElement[]): string => JSON.stringify(els);
const nums = (els: readonly GlyphElement[]): number[] =>
  els.flatMap((e) =>
    Object.entries(e.attrs).flatMap(([k, v]) =>
      k === 'points'
        ? String(v).split(/[ ,]/).map(Number)
        : typeof v === 'number' && !k.includes('opacity') && !k.includes('width')
          ? [v]
          : [],
    ),
  );

describe('card glyph v0 (GDD §7)', () => {
  it('is the same for the same card and stays inside 48×48', () => {
    const c = card({ controller: 'signal' });
    expect(key(cardGlyph(c))).toBe(key(cardGlyph({ ...c })));
    for (const target of ['intersection', 'segment', 'edge', 'district'] as const)
      for (const controller of [
        undefined,
        'signal',
        'roundabout',
        'stop-all',
        'priority',
        'uncontrolled',
      ] as const) {
        const els = cardGlyph(card({ target, ...(controller ? { controller } : {}), tier: 2 }));
        for (const v of nums(els)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(GLYPH_SIZE);
        }
      }
  });

  it('draws a different shape for each target kind', () => {
    const shapes = (['intersection', 'segment', 'edge', 'district'] as const).map((target) =>
      key(cardGlyph(card({ target }))),
    );
    expect(new Set(shapes).size).toBe(4);
  });

  it('adds the controller glyph, one per controller kind', () => {
    const base = cardGlyph(card()).length;
    const kinds = (['signal', 'roundabout', 'stop-all', 'priority'] as const).map((controller) => {
      const els = cardGlyph(card({ controller }));
      expect(els.length).toBeGreaterThan(base);
      return key(els.slice(base));
    });
    expect(new Set(kinds).size).toBe(4);
    // Uncontrolled draws the plain crossing, as on the map.
    expect(cardGlyph(card({ controller: 'uncontrolled' })).length).toBe(base);
  });

  it('rings in the first tag colour, and gold with a second ring at tier 2', () => {
    const t1 = cardGlyph(card({ tags: ['CHAOS', 'FLOW'] }));
    expect(t1[0]?.attrs['stroke']).toBe(css(TAG_COLOR.CHAOS));
    expect(t1[0]?.attrs['fill']).toBe(css(TAG_COLOR.CHAOS));
    const t2 = cardGlyph(card({ tags: ['CHAOS'], tier: 2 }));
    expect(t2[0]?.attrs['stroke']).toBe(css(TIER2_GOLD));
    expect(t2[1]).toMatchObject({
      tag: 'circle',
      attrs: { stroke: css(TIER2_GOLD), fill: 'none' },
    });
    expect(t2.length).toBe(t1.length + 1);
  });
});

describe('portal rules (ADR-024)', () => {
  it('hides the unlock and outbound links on Poki and CrazyGames only', () => {
    for (const p of ['poki', 'crazygames'] as const)
      expect(portalRules(p)).toEqual({ unlock: false, outboundLinks: false, analytics: false });
    for (const p of ['none', 'itch', undefined] as const)
      expect(portalRules(p)).toEqual({ unlock: true, outboundLinks: true, analytics: true });
  });
});
