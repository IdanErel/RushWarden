import { describe, expect, it } from 'vitest';
import {
  type DeckFile,
  expandDeck,
  loadCards,
  loadDecks,
  PHASE1_STARTING_DECK_ID,
  STARTING_DECK_SIZE,
  startingDeck,
  validateDecks,
} from '../src/index.js';

const cards = loadCards();

function deck(data: Record<string, unknown>, source = 'test-deck.json'): DeckFile {
  return {
    source,
    data: {
      id: 'test-deck',
      label: 'test',
      cards: [
        { card: 'smart-signal', count: 6 },
        { card: 'one-way', count: 6 },
      ],
      ...data,
    },
  };
}

const errorsOf = (f: DeckFile): string[] =>
  validateDecks([f], cards).errors.map((e) => `${e.path}: ${e.message}`);

describe('deck lists', () => {
  it('bundles valid decks', () => {
    expect(loadDecks().map((d) => d.id)).toContain(PHASE1_STARTING_DECK_ID);
  });

  it('the Phase 1 starting deck is GDD §4 default with Grant replaced by Pilot Program (ADR-007)', () => {
    const ids = startingDeck();
    expect(ids).toHaveLength(STARTING_DECK_SIZE);
    const counts: Record<string, number> = {};
    for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
    expect(counts).toEqual({
      'smart-signal': 2,
      'one-way': 2,
      roundabout: 1,
      'bus-priority': 1,
      detour: 1,
      overtime: 1,
      'pilot-program': 1,
      'turn-lane': 1,
      'speed-limit-up': 1,
      recount: 1,
    });
    expect(ids).not.toContain('grant');
  });

  it('startingDeck throws on an unknown id', () => {
    expect(() => startingDeck('nope')).toThrow('Unknown deck nope');
  });

  it('expandDeck repeats each card by count in listed order', () => {
    expect(
      expandDeck({
        id: 'x',
        label: 'x',
        cards: [
          { card: 'a', count: 2 },
          { card: 'b', count: 1 },
        ],
      }),
    ).toEqual(['a', 'a', 'b']);
  });

  it('accepts a valid deck', () => {
    expect(errorsOf(deck({}))).toEqual([]);
  });

  it.each<[string, Record<string, unknown>, string, string?]>([
    [
      'unknown card',
      {
        cards: [
          { card: 'grant', count: 6 },
          { card: 'one-way', count: 6 },
        ],
      },
      'cards/0/card: unknown card "grant"',
    ],
    [
      'card listed twice',
      {
        cards: [
          { card: 'one-way', count: 6 },
          { card: 'one-way', count: 6 },
        ],
      },
      'cards/1/card: "one-way" listed twice; use count',
    ],
    [
      'wrong total',
      { cards: [{ card: 'one-way', count: 11 }] },
      'cards: has 11 cards, a starting deck has 12',
    ],
    ['file name', {}, 'id: file must be named test-deck.json', 'other.json'],
  ])('rejects %s', (_, data, message, source) => {
    expect(errorsOf(deck(data, source))).toContain(message);
  });

  it('rejects schema errors and duplicate ids', () => {
    expect(errorsOf(deck({ extra: 1 })).length).toBeGreaterThan(0);
    const twice = validateDecks([deck({}), deck({})], cards).errors.map((e) => e.message);
    expect(twice).toContain('duplicate id test-deck');
  });
});
