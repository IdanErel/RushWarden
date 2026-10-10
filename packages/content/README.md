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

**Decks:** `decks/<id>.json` lists card ids with counts. `phase1-starting` is GDD §4's default
deck with Grant replaced by Pilot Program (ADR-007).

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

## Demand and round setup

`setupRound({ round, seed, rush?, boss?, district? })` gives the run controller one round, as a
pure function of its arguments. It returns the map (a seeded pick from the bank), the demand
profile, the heat-strip, the quota, the sim's `DistrictRules`
and `closedSegments` (Parade). The argument matches
`RunEnv.setupRound`, so `{ setupRound }` can be passed to the run controller as is.

- **Volume:** `baseVehicles` (66 in D1, tuned by P1-CON-05) grows 11% a round with the quota and
  ×1.6 on rush rounds.
- **Mix:** exact per-round counts from GDD §5's per-mille mix (D1: 70% car, 15% bus, 10% truck,
  5% bike), with leftovers going to the largest remainders.
- **Timing:** `SECOND_WEIGHTS` is a rush-hour curve that peaks in seconds 1–5. Each edge gets a
  seeded weight of 1–5 per round, so some edges run hot. Destinations are uniform over the other edges.
  An edge never spawns twice in one tick.
- **Bosses** (GDD §5): Market Day adds 2 trucks every second. Parade returns one seeded
  `closedSegments` entry and picks only from maps where a closure leaves every edge connected.
  Festival adds 60% more vehicles, 5% of them emergency vehicles.
- **Heat-strip** (GDD §2): spawns per edge per second, plus the max for scaling.
- **Quota:** `roundQuota` is GDD §2's formula in per-mille integers, rounded half up (ADR-018),
  and the single quota source. District 1's base is tuned to 83 (P1-CON-05); D2 and D3 keep 34
  and 42.

The model, the seed salts and the boss rules are in
[ADR-021](../../docs/decisions/ADR-021-demand-model.md).

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
| `setupRound(args)`                                    | One round's map, demand, heat-strip, quota and district rules     |
| `generateDemand(args)`, `heatStrip(map, profile)`     | The seeded demand profile; its per-edge, per-second strip         |
| `roundQuota(d, r, rush, mayor?)`, `roundVehicles`     | GDD §2 quota; demand volume                                       |
| `validateSchema(schema, value)`                       | The JSON Schema subset validator                                  |
| `loadDecks()` / `startingDeck(id?)`                   | Bundled deck lists; a deck as 12 card ids (default: Phase 1 deck) |
| `validateDecks(files, cards)`, `DECK_SCHEMA`          | Deck validation (schema, known cards, 12 cards total)             |

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
- `pnpm --filter @rushwarden/content schema:write` regenerates `schema/card.schema.json` and
  `schema/deck.schema.json` after a schema change.
