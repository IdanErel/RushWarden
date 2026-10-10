/**
 * The map template JSON schema. A template is drawn as 9 rows of 7 characters (GDD §3 grid,
 * portrait): `.` block, `#` road with 1 lane each way, `B` the same road with a bus stop.
 * Edges are not drawn: every dead-end road reaches the boundary and gets an edge there (ADR-016).
 * This object is the single source; `schema/map.schema.json` is written from it.
 */
import { GRID_HEIGHT, GRID_WIDTH } from '@rushwarden/sim';
import type { JsonSchema } from './json-schema.js';

/** Tile characters in a template row. */
export const MAP_CHARS = { block: '.', road: '#', busStop: 'B' } as const;

export const MAP_SCHEMA: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://rushwarden.com/schema/map.schema.json',
  title: 'Rushwarden map template',
  description:
    'One district map template (GDD §3). Rows top to bottom; "." block, "#" road (1 lane each way), "B" road with a bus stop. Edges are inferred at dead ends on the boundary.',
  type: 'object',
  properties: {
    $schema: { type: 'string' },
    id: { type: 'string', pattern: '^d[1-3]-[0-9]{2}$' },
    district: { type: 'integer', minimum: 1, maximum: 3 },
    name: { type: 'string', minLength: 1, maxLength: 24 },
    rows: {
      type: 'array',
      minItems: GRID_HEIGHT,
      maxItems: GRID_HEIGHT,
      items: { type: 'string', pattern: `^[.#B]{${GRID_WIDTH}}$` },
    },
  },
  required: ['id', 'district', 'name', 'rows'],
  additionalProperties: false,
};
