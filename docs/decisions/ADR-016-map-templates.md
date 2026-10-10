# ADR-016: Map template format and variants

Status: Accepted · 2026-10-10 · Lead (proposed by Content Designer, P1-CON-03)

GDD §3 says maps are seeded per district "from a template bank of 12 layouts per district with
mirrored and rotated variants", and §5 gives each district's traits. The file format, which
transforms count as variants and how a map is picked are open. Decisions:

1. **Templates are drawn, not listed.** `packages/content/maps/<id>.json` holds 9 rows of 7
   characters (top row first): `.` block, `#` road with 1 lane each way, `B` the same road with a
   bus stop. District 2 and 3 add a 2-lane character when they land. A JSON Schema
   (`schema/map.schema.json`, written from `src/map-schema.ts`) checks the shape.
2. **Edges are inferred.** ADR-012 forbids dead ends without an edge, so every road tile with one
   road neighbour must run straight off the grid and gets an edge on that side. A dead end inside
   the grid is an error. Edge ids are assigned in row-major tile order, per variant.
3. **Variants are the four symmetries of the 7×9 rectangle**: identity, mirror left-right (`-mx`),
   mirror top-bottom (`-my`) and 180° (`-r180`). A 90° turn would make the grid 9×7, so it is not
   a variant. A symmetric template keeps only its distinct variants. District 1 has 12 templates
   and 38 maps.
4. **Validation** (in `pnpm test`): every variant passes the sim's `buildWorld` (ADR-012), and
   - the intersection count is in the district's range (D1 4–6, D2 7–9, D3 9–12);
   - the district's bus stop count is exact (D1 2, D2 4, D3 4). Stops are never on an intersection
     or an edge tile. D3's count is not in the brief; 4 is a placeholder until District 3;
   - there are at least 4 edges (a content choice, so demand and heat strips have room);
   - a route exists between every ordered pair of edges;
   - no template is a variant of another, and ids are unique and match the file name.
5. **Picking a map:** `pickMap(maps, seed)` picks uniformly over all of the district's maps,
   variants included, with the seeded PRNG from `@rushwarden/sim`. The run controller decides which
   seed to pass.
