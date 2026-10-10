import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARD_SCHEMA } from '../src/card-schema.js';
import { DECK_SCHEMA } from '../src/deck.js';
import type { JsonSchema } from '../src/json-schema.js';

const FILES: readonly (readonly [string, JsonSchema])[] = [
  ['card.schema.json', CARD_SCHEMA],
  ['deck.schema.json', DECK_SCHEMA],
];

describe.each(FILES)('schema/%s', (name, schema) => {
  const file = new URL(`../schema/${name}`, import.meta.url);
  it('matches the schema in src (regenerate with `pnpm --filter @rushwarden/content schema:write`)', () => {
    if (process.env['UPDATE_SCHEMA'] === '1') {
      writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
    }
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(schema);
  });
});
