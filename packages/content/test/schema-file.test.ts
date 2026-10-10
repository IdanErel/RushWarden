import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARD_SCHEMA } from '../src/card-schema.js';
import type { JsonSchema } from '../src/json-schema.js';
import { MAP_SCHEMA } from '../src/map-schema.js';

const FILES: [string, JsonSchema][] = [
  ['card.schema.json', CARD_SCHEMA],
  ['map.schema.json', MAP_SCHEMA],
];

describe('schema/*.schema.json', () => {
  it.each(FILES)(
    '%s matches its TS source (regenerate with `pnpm --filter @rushwarden/content schema:write`)',
    (name, schema) => {
      const file = new URL(`../schema/${name}`, import.meta.url);
      if (process.env['UPDATE_SCHEMA'] === '1') {
        writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
      }
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(schema);
    },
  );
});
