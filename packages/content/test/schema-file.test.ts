import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARD_SCHEMA } from '../src/card-schema.js';

const FILE = new URL('../schema/card.schema.json', import.meta.url);

describe('schema/card.schema.json', () => {
  it('matches CARD_SCHEMA (regenerate with `pnpm --filter @rushwarden/content schema:write`)', () => {
    if (process.env['UPDATE_SCHEMA'] === '1') {
      writeFileSync(FILE, `${JSON.stringify(CARD_SCHEMA, null, 2)}\n`);
    }
    expect(JSON.parse(readFileSync(FILE, 'utf8'))).toEqual(CARD_SCHEMA);
  });
});
