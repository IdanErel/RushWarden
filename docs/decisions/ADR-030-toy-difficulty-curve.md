# ADR-030: Toy difficulty curve

Status: Accepted · 2026-10-10 · Lead (proposed by Content Designer, P1-CON-05) · items 2 and 5
amended by ADR-032 (CON-06), 2026-10-11; items 2 and 3 again by ADR-032 Amendment 1 (playtest
B1, B2; Lead ruling on #100), 2026-10-13

ADR-007 item 1 makes the itch toy a 5-round District 1 run whose round 5 is Market Day. With the
tuned District 1 values (ADR-021), rounds 1–4 are the full run's on-ramp: every bot, including one
that never plays a card, passes them about 95% of the time. With 3 approval a toy loss needs 3
failed rounds, so the toy could not be lost (no-cards won 99.7% of toys). The 12-round targets of
GDD §11 and the toy cannot both be met by one curve that the toy replays from round 1.

**Decision.** The toy's 5 rounds sample the 12-round District 1 curve instead of replaying rounds
1–5. It is still a 5-round District 1 run with no shop (ADR-007).

1. **Data.** `TOY_ROUNDS` in `packages/content/src/demand.ts` lists, for each toy round, the D1
   round it plays: that round's quota (`roundQuota`), demand, rush flag and §5 boss. `toyRushRounds()`
   turns it into the run controller's `rushRounds` (toy round number and boss).
2. **Mapping.** `TOY_ROUNDS = [4, 8, 12, 8, 12]`: Market Day, Parade, Festival, Parade, Festival.
   The toy is District 1's rush hour: every round is a rush round with its boss, and it can be
   lost in 3 rounds. Gentler mappings left the toy almost unlosable. With `[1, 3, 4, 8, 12]`,
   no-cards won 75% and greedy 95%. With `[3, 4, 8, 11, 12]`, the figures were 51% and 83%.

   **Amended by ADR-032:** `TOY_ROUNDS = [4, 8, 11, 8, 12]`. Round 11 replaces the first
   Festival. Once the per-template factor evens out the maps, Parade and Festival are the hardest
   rounds for every bot, and two Festivals made the toy almost unwinnable.

   **Amended by ADR-032 Amendment 1 (playtest B2):** `TOY_ROUNDS = [4, 8, 11, 10, 12]`. Round 10
   replaces the second Parade, so the toy plays each event once.

3. **Targets on the toy itself** (Lead): `no-cards` wins at most 20%, `random` 10–30%, each of the
   five `archetype(tag)` bots 35–65%, `greedy-throughput` at most 75%. The P1-CON-05 PR (#55)
   attaches the report that checks them.

   **Amended by ADR-032 Amendment 1 (Lead ruling on #100, toy only):** each `archetype(tag)` bot
   55–75%, `greedy-throughput` at most 80%, `random` 10–30%, `no-cards` at most 20%, and no toy
   round on any map below 35% for any archetype bot. This replaces the playtest triage's "card
   bots pass every toy round at least 50% on every map". The full-run §11 targets are unchanged.

   The bot bands carry a ±2-point tolerance (Lead, #100): a 1-point miss on a 5-round demo isn't
   worth a harder toy. At the chosen quota share (0.86, ADR-032 A1) the toy measures `random`
   9.4% and `greedy-throughput` 81.2%, both inside the tolerance and accepted.
   After ADR-035 (ADR-032 Amendment 2) the toy measures `greedy-throughput` 80.7%, inside the
   tolerance, and `random` 6.5%, outside it: the two can no longer both be met.

4. **Run controller.** The toy preset reads both from content: `curveRounds: TOY_ROUNDS` and
   `rushRounds: toyRushRounds()`. The controller passes `curveRounds[round - 1]` (default `round`)
   to `setupRound` and `roundQuota`. The player still sees "round 1 of 5" to "round 5 of 5"; the
   boss name and quota come from the sampled round.
5. **Known gap: no-cards is not yet at most 20%.** With the mapping above, no-cards wins 25–32% of
   toys in every mapping tried. random, greedy and all five archetypes are inside their targets.
   The cause is map variance, not the curve. With no cards on a round-4 Market Day, the
   template decides the round:

   | Template | d1-03 | d1-12 | d1-06 | d1-08 | d1-04 | d1-01 | d1-05 | d1-07 | d1-09 | d1-10 | d1-02 | d1-11 |
   | -------- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
   | Pass     | 100%  | 99%   | 97%   | 89%   | 81%   | 31%   | 17%   | 6%    | 6%    | 4%    | 2%    | 2%    |

   (Seeds 1–1,200, District 1 values from P1-CON-05.) About 40% of rush rounds are free passes and
   about half are near-certain gridlocks, whatever is played, so no-cards keeps a floor of about
   25% in any 5-round toy. The fix is a per-template demand factor so that every template sits
   near its jam point (ADR-032, task CON-06). The toy's acceptance is re-checked there.

   **Resolved by ADR-032** (CON-06): with the per-template factor and the amended mapping,
   no-cards wins 19.5% of toys (6,000 seeds pooled: 20.1% in the attached 2,000-seed report and
   19.25% in the reviewer's 4,000-seed sample). ADR-032 has the report.

6. **Full runs are unchanged.** `fullRunConfig` has no `curveRounds`, so the 12-round gate run
   (ADR-010) plays rounds 1–12 as before.

Alternatives considered:

- Replaying rounds 1–5 with toy-only quotas or demand. That would mean a second quota formula,
  but `roundQuota` is the single source (ADR-021 item 2).
- Fewer approval points in the toy. That changes a §2 rule the player learns in the toy and then
  plays under in the full game.
