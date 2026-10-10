# @rushwarden/content

Cards, maps, districts, mayors and demand templates as JSON with schemas and loaders.

Owner: Content Designer. See GDD section 6 for this package's responsibilities and section 13 for ownership.
Format decisions: [ADR-011](../../docs/decisions/ADR-011-card-data-format.md).

## Cards

Each card is `cards/<id>.json`, validated against `schema/card.schema.json` (GDD §4 anatomy).
Effects use the sim's `Effect` primitives; vehicle types are written as names. Rules text is never
written by hand: it is generated from the effects by the templates in `src/text.ts`. `flavor`
(max 60 characters) is the only free-form field.

```json
{
  "$schema": "../schema/card.schema.json",
  "id": "roundabout",
  "name": "Roundabout",
  "cost": 1,
  "target": "intersection",
  "duration": "round",
  "rarity": "common",
  "tags": ["CHAOS"],
  "effects": [{ "kind": "setController", "controller": "roundabout", "capacity": 4 }],
  "upgrade": {
    "effects": [{ "kind": "setController", "controller": "roundabout", "capacity": 6 }]
  },
  "flavor": "Nobody stops. Everybody yields. Mostly."
}
```

`upgrade` holds the tier-2 deltas: each field given (`cost`, `effects`) replaces the tier-1 value.

**Adding a card:** add the JSON file, add one import line to `src/cards.ts`, run `pnpm test`.
`pnpm test` validates every card (schema, target rules, unique ids and names, file name = id) and
generates its text at both tiers. A card that needs a primitive the sim does not have is a request
to the Sim Engineer first (GDD §4), never a schema workaround.

## Maps

Each map template is `maps/<id>.json`: 9 rows of 7 characters, top row first. `.` is a block,
`#` is a road with 1 lane each way, and `B` is the same road with a bus stop. Edges are inferred:
every dead-end road runs straight off the grid and gets an edge there. Each template expands into
its distinct mirrored and 180° variants (`-mx`, `-my`, `-r180`). See
[ADR-016](../../docs/decisions/ADR-016-map-templates.md).

`pnpm test` runs every variant through the sim's `buildWorld` (ADR-012) and checks the district
traits (D1: 4–6 intersections, 2 bus stops, every edge reachable from every other).

## Public API

| Export                                                | What it does                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| `loadCards()`                                         | The bundled cards, validated once; throws listing every error     |
| `getCard(id)`                                         | One bundled card; throws if unknown                               |
| `parseCard(json, source?)`                            | Validates and converts one card; returns `{ ok, card \| errors }` |
| `validateCards(files)`                                | Validates a set, including unique ids/names and file names        |
| `resolveCard(card, tier)`                             | Cost, target and effects at tier 1 or 2                           |
| `toPlacement(card, tier, target, order)`              | The sim `Placement` for playing a card                            |
| `cardText(card, tier)` / `effectText(effect, target)` | Generated rules text                                              |
| `CARD_SCHEMA`, `EFFECT_SCHEMAS`, `EFFECT_TARGETS`     | The schema and the effect-to-target rules                         |
| `loadMapTemplates()` / `districtMaps(d)`              | Validated templates; every map (variants included) for a district |
| `pickMap(maps, seed)`                                 | Seeded uniform pick of a map                                      |
| `templateVariants(t)`, `rowsToGridMap(id, rows)`      | Template to `GridMap`s                                            |
| `validateSchema(schema, value)`                       | The JSON Schema subset validator                                  |

## Example

```ts
import { cardText, getCard, toPlacement } from '@rushwarden/content';

const card = getCard('roundabout');
cardText(card, 1); // "Becomes a roundabout holding up to 4 vehicles."
cardText(card, 2); // "Becomes a roundabout holding up to 6 vehicles."
const placement = toPlacement(card, 2, { kind: 'intersection', tile: { x: 3, y: 4 } }, 0);
```

## Scripts

- `pnpm --filter @rushwarden/content test` validates all cards and runs the unit tests.
- `pnpm --filter @rushwarden/content schema:write` regenerates `schema/card.schema.json` after a
  schema change.
