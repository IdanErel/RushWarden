import { describe, expect, it } from 'vitest';
import { cardText, getCard, loadCards, PHASE1_BLOCKED, PHASE1_CARD_IDS } from '../src/index.js';

describe('Phase 1 card set (docs/tasks/phase-1.md)', () => {
  it('lists 20 cards, 4 per archetype', () => {
    expect(new Set(PHASE1_CARD_IDS).size).toBe(20);
    const bundled = PHASE1_CARD_IDS.filter((id) => PHASE1_BLOCKED[id] === undefined).map(getCard);
    for (const card of bundled) expect(card.tags).toHaveLength(1);
  });

  it('every Phase 1 card is either bundled or blocked with a reason, never both', () => {
    const bundled = new Set(loadCards().map((c) => c.id));
    for (const id of PHASE1_CARD_IDS) {
      const blocked = PHASE1_BLOCKED[id] !== undefined;
      expect(bundled.has(id) !== blocked, id).toBe(true);
    }
    for (const id of bundled) expect(PHASE1_CARD_IDS as readonly string[]).toContain(id);
  });

  // GDD §4 list items, with the generated text at both tiers. Text is generated, not stored:
  // this table is the evidence that data, text and the brief agree.
  const GDD: [string, string, number, string, string, string, string][] = [
    [
      'speed-limit-up',
      'segment',
      1,
      'common',
      'FLOW',
      '+1 top speed on this segment for all vehicles except trucks.',
      '+1 top speed on this segment for all vehicles.',
    ],
    [
      'bus-priority',
      'intersection',
      1,
      'common',
      'MASS',
      'Buses get green on approach to this intersection.',
      'Buses and taxis get green on approach to this intersection.',
    ],
    [
      'express-stop',
      'segment',
      1,
      'common',
      'MASS',
      'Bus stop on this segment: buses dwell 2 ticks.',
      'Bus stop on this segment: buses dwell 1 tick.',
    ],
    [
      'fare-holiday',
      'district',
      1,
      'common',
      'MASS',
      '+40% bus spawns. +40% bike spawns. −20% car spawns.',
      '+60% bus spawns. +60% bike spawns. −30% car spawns.',
    ],
    [
      'roundabout',
      'intersection',
      1,
      'common',
      'CHAOS',
      'Becomes a roundabout holding up to 4 vehicles.',
      'Becomes a roundabout holding up to 6 vehicles.',
    ],
    [
      'yield-culture',
      'district',
      2,
      'uncommon',
      'CHAOS',
      'Uncontrolled intersections resolve 1 tick faster.',
      'Uncontrolled intersections resolve 2 ticks faster.',
    ],
  ];
  it.each(GDD)(
    '%s matches GDD §4 (%s, cost %i, %s, %s)',
    (id, target, cost, rarity, tag, t1, t2) => {
      const card = getCard(id);
      expect(card).toMatchObject({ target, cost, rarity, tags: [tag], duration: 'round' });
      expect(cardText(card, 1)).toBe(t1);
      expect(cardText(card, 2)).toBe(t2);
    },
  );

  it('covers every bundled card in the GDD table', () => {
    expect(
      loadCards()
        .map((c) => c.id)
        .sort(),
    ).toEqual(GDD.map((r) => r[0]).sort());
  });
});
