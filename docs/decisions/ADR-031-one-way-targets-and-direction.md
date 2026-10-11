# ADR-031: One-Way targets and direction

Status: Accepted (Lead) · 2026-10-10 · Sim Engineer (#57). Number assigned by the Lead.

## Context

`setOneWay` without a fixed direction (card 3, One-Way) takes its direction from its segment
target, from `from` to `to`, so the sim rejects a segment with `from == to`. The balance bots
targeted single-tile segments, so every One-Way play was illegal and bots never played or drafted
it (found by Content). A first fix gave bots every two-tile pair of adjacent road tiles in both
directions. Reviewer-2 pointed out that a player can place neither: the run screen turns a tap
into the whole straight run through the tile (`segmentAt`), pointing west to east or north to
south. GDD §4 says One-Way makes the segment "one-way in the chosen direction".

## Decision

1. **A segment target is the full straight run** of non-intersection road tiles through a tile,
   as `segmentAt` builds it. There are no sub-run stubs. This holds for every segment card the
   bots place, not only One-Way, so bots place exactly what a player can.
2. **One shared helper.** `segmentAt(map, x, y)`, `segmentRuns(map)` and `reverseSegment(t)` live
   in `packages/app/src/map/segments.ts`. The run screen (`packages/ui`, `controller-run.ts`)
   and the balance bots (`packages/balance`, `targets.ts`) both use it, so they cannot drift. A
   balance test checks on every District 1 map that the bots' segment targets equal what a tap on
   the run screen places.
3. **Direction is the player's choice** (GDD §4). The run screen adds a direction choice for
   One-Way (Render/UI). The bots try both directions of every run with `from != to`
   (`directedRuns`), which matches the card as the GDD specifies it.

## Consequences

- Balance numbers for every segment card change, and One-Way becomes playable. The committed
  `docs/balance/latest.md` from #29 is stale until the nightly regenerates it (ADR-027).
- Until the run screen offers the reverse direction, players can place only the west-to-east or
  north-to-south half of what the bots try.

## Amendment

2026-10-10, Render/UI (#65): the run screen places One-Way in its segment's default direction
and shows it as an arrow. A ⇄ button next to its undo chip turns it round, and so does **R**,
which flips the last One-Way placed. R joins the GDD §8 keyboard map (1–5, arrows, Enter, Space,
Esc). A second tap on a placed One-Way still undoes it, as §8 says. The run screen offers One-Way
only on runs with `from != to`, the same rule as the bots' `directedRuns`.
