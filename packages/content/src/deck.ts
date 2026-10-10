/**
 * Deck lists (GDD §4 "Draft and deck rules"): a starting deck as card ids with counts, validated
 * against the card set. The run controller loads one with `startingDeck(id)`.
 */
import type { CardDef } from './card.js';
import { type JsonSchema, type SchemaError, validateSchema } from './json-schema.js';

/** GDD §4: "Starting deck … (12 cards)". */
export const STARTING_DECK_SIZE = 12;

export interface DeckEntry {
  readonly card: string;
  readonly count: number;
}

export interface DeckDef {
  readonly id: string;
  /** Why this deck exists; not shown to players. */
  readonly label: string;
  readonly cards: readonly DeckEntry[];
}

export const DECK_SCHEMA: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://rushwarden.com/schema/deck.schema.json',
  title: 'Rushwarden deck list',
  type: 'object',
  properties: {
    $schema: { type: 'string' },
    id: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', maxLength: 40 },
    label: { type: 'string', minLength: 1, maxLength: 200 },
    cards: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          card: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' },
          count: { type: 'integer', minimum: 1, maximum: STARTING_DECK_SIZE },
        },
        required: ['card', 'count'],
        additionalProperties: false,
      },
    },
  },
  required: ['id', 'label', 'cards'],
  additionalProperties: false,
};

export interface DeckFile {
  /** File name, `<id>.json`. */
  readonly source: string;
  readonly data: unknown;
}

export interface DeckError extends SchemaError {
  readonly source: string;
}

/**
 * Validates deck files: schema, file name, each card listed once and present in `cards`, and
 * exactly STARTING_DECK_SIZE cards in total.
 */
export function validateDecks(
  files: readonly DeckFile[],
  cards: readonly CardDef[],
): { readonly decks: readonly DeckDef[]; readonly errors: readonly DeckError[] } {
  const known = new Set(cards.map((c) => c.id));
  const decks: DeckDef[] = [];
  const errors: DeckError[] = [];
  for (const { source, data } of files) {
    const schemaErrors = validateSchema(DECK_SCHEMA, data);
    if (schemaErrors.length > 0) {
      errors.push(...schemaErrors.map((e) => ({ source, ...e })));
      continue;
    }
    const d = data as DeckDef;
    const deck: DeckDef = { id: d.id, label: d.label, cards: d.cards };
    const fail = (path: string, message: string): void => {
      errors.push({ source, path, message });
    };
    if (source !== `${deck.id}.json`) fail('id', `file must be named ${deck.id}.json`);
    const seen = new Set<string>();
    deck.cards.forEach((e, i) => {
      if (!known.has(e.card)) fail(`cards/${i}/card`, `unknown card "${e.card}"`);
      if (seen.has(e.card)) fail(`cards/${i}/card`, `"${e.card}" listed twice; use count`);
      seen.add(e.card);
    });
    const total = deck.cards.reduce((n, e) => n + e.count, 0);
    if (total !== STARTING_DECK_SIZE) {
      fail('cards', `has ${total} cards, a starting deck has ${STARTING_DECK_SIZE}`);
    }
    if (decks.some((x) => x.id === deck.id)) fail('id', `duplicate id ${deck.id}`);
    decks.push(deck);
  }
  return { decks, errors };
}

/** A deck as a flat list of card ids, in listed order (the run controller shuffles it). */
export function expandDeck(deck: DeckDef): string[] {
  return deck.cards.flatMap((e) => Array<string>(e.count).fill(e.card));
}
