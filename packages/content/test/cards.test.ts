import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CARD_FILES,
  cardText,
  FLAVOR_MAX,
  formatErrors,
  getCard,
  loadCards,
  validateCards,
} from '../src/index.js';

const DIR = new URL('../cards/', import.meta.url);
const onDisk = readdirSync(DIR).filter((f) => f.endsWith('.json'));

// This is the schema validation gate for the shipped card set (runs in `pnpm test` and CI).
describe('bundled cards', () => {
  it('CARD_FILES lists exactly the JSON files in packages/content/cards/', () => {
    expect(CARD_FILES.map((f) => f.source).sort()).toEqual([...onDisk].sort());
  });

  it('CARD_FILES holds the same data as the files on disk', () => {
    for (const { source, data } of CARD_FILES) {
      expect(data, source).toEqual(JSON.parse(readFileSync(new URL(source, DIR), 'utf8')));
    }
  });

  it('every card file passes the schema and the card rules', () => {
    const files = onDisk.map((source) => ({
      source,
      data: JSON.parse(readFileSync(new URL(source, DIR), 'utf8')) as unknown,
    }));
    const { errors } = validateCards(files);
    expect(formatErrors(errors)).toBe('');
  });

  it('loads, and every card has generated text at both tiers and short flavor', () => {
    const cards = loadCards();
    expect(cards).toHaveLength(onDisk.length);
    for (const card of cards) {
      expect(getCard(card.id)).toBe(card);
      expect(cardText(card, 1).length).toBeGreaterThan(0);
      expect(cardText(card, 2).length).toBeGreaterThan(0);
      expect([...card.flavor].length).toBeLessThanOrEqual(FLAVOR_MAX);
    }
  });

  it('getCard throws on an unknown id', () => {
    expect(() => getCard('no-such-card')).toThrow(/Unknown card/);
  });
});
