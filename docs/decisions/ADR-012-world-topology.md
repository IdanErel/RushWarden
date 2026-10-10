# ADR-012: World topology rules for maps

Status: Proposed · 2026-10-10 · Sim Engineer (P1-SIM-01)

GDD section 3 fixes the grid (7×9 tiles), 1–2 lanes per direction, 4 cells per lane per tile,
intersections as tiles where 3–4 roads meet, edges on the boundary, and BFS routes at spawn. It
does not say how tiles join into lanes, so `packages/sim/src/world.ts` decides, and
`buildWorld(map)` rejects maps that break these rules with a `MapError` naming the tile:

1. **Adjacency is connection.** Orthogonally adjacent road tiles are connected; `GridMap` has no
   separate connectivity data. An edge connects its tile to the outside on `edge.side`, which must
   face the boundary; at most one edge per tile side; edge ids are unique integers in [0, 65535].
2. **Intersections** are road tiles with 3 or 4 road neighbours. Every other road tile has exactly
   two connections (road neighbours plus edges): no dead ends, no isolated tiles.
3. **Edges sit on road ends, never on an intersection tile**, and **no two intersections are
   adjacent**. Both guarantee that every lane between two nodes is at least one tile (4 cells) long,
   so queues and spawns always have cells.
4. **Links.** A link is one direction of travel along a maximal chain of non-intersection tiles
   between two nodes (intersections or edges). All its tiles have the same lane count. Lane index 0
   is the kerb (rightmost) lane; traffic drives on the right, which is what "first at line, then
   rightmost" in rule 5 assumes. Cell 0 is the upstream end, so "cellIndex descending" is
   downstream first.
5. **All road tiles are one connected component** with at least 2 edges; with two-way roads this
   makes every edge reachable from every other (P1-CON-03's "every edge reachable").
6. **Routes** are BFS shortest paths over tiles (fewest tiles, intersections counted), ties broken
   by direction order n, e, s, w; a link with no lanes (a one-way's closed side) is not
   traversable. Routes are cached per (origin, destination) for the round, which equals computing
   them at each spawn because the network is fixed once Go is pressed. Taxis use
   `weightedRoute` (integer Dijkstra over links, no U-turns, ties to the lower link id) when they
   enter an intersection; the cost function arrives with vehicles in P1-SIM-02.
7. **Ids.** Intersections are numbered row-major. Links are traced from intersections (row-major,
   sides n, e, s, w) and then from edges in `map.edges` order; lanes are numbered in link order.
   All ids are stable for a given map and fit the Uint16 snapshot.

Consequence for content (P1-CON-03): put each edge on a stub road tile and keep at least one road
tile between intersections. A 7×9 grid still fits 3×4 = 12 intersections (columns 1, 3, 5; rows
1, 3, 5, 7), the District 3 maximum. Call `buildWorld(map)` from `@rushwarden/sim` in content tests
to validate every template and variant.
