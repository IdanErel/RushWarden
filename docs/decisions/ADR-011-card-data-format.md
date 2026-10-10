# ADR-011: Card data format, schema and generated text

Status: Accepted · 2026-10-10 · Content Designer (P1-CON-01)

GDD §4 fixes the card anatomy, that cards are JSON in `packages/content/cards/*.json` validated by
a schema, and that rules text is generated from effects. It leaves the file layout, the schema
technology and the shape of `upgrade` open. Decisions:

1. **One file per card**, `cards/<id>.json`. `src/cards.ts` imports each file statically (works in
   Vite and Node without a glob); a test fails if the list and the directory disagree.
2. **The schema is JSON Schema 2020-12**, written as a TypeScript object (`src/card-schema.ts`) and
   emitted to `schema/card.schema.json` for editor completion. A test fails if the file is stale
   (`pnpm --filter @rushwarden/content schema:write` regenerates it). Validation uses a ~200-line
   interpreter of the keyword subset we use (`src/json-schema.ts`) instead of adding Ajv, which the
   brief does not list as a dependency. Unknown keywords throw, so the subset cannot silently grow.
3. **Effects are the sim's `Effect` union** field for field. A mapped type makes adding or removing
   a field on an `Effect` variant a compile error in the schema. The one JSON difference: vehicle
   types are names (`"bus"`), converted to `VehicleType` numbers by the loader, because numbers
   are unreadable and easy to get wrong when authoring.
4. **`upgrade` replaces whole fields**: `{ cost?, effects? }`, each given field replaces the tier-1
   value (at least one field; tier 2 must differ from tier 1 and must not cost more). Whole-list
   replacement keeps tier 2 readable in review and lets the same template generate its text.
   `upgrade.cost` may be 0 (One-Way's tier 2).
5. **Rules beyond the schema**, enforced by the validator: each primitive may only act on the
   target kinds in `EFFECT_TARGETS`; `direction` only with `priority` controllers, `capacity` only
   with roundabouts; no two contradicting effects of a singleton kind; unique ids and names; tags
   1–2 (Commissioner's Decree's "any" gets its own decision when that card is added).
6. **Text templates are the contract for what a primitive means.** Each template states only what
   its fields say. Where the sim type leaves meaning open, the template's reading is the one the
   Sim Engineer implements, or the template changes in the same PR: `drawModifier` applies to the
   next round's draw; `addBusStop` on a segment means "this segment has a stop with this dwell".
   English templates live in `packages/content` until §8's i18n layer exists.
