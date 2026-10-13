# ADR-032: District 1 per-template demand factor

Status: Accepted (Lead, on the toy-only scope) · 2026-10-11 · Content Designer (CON-06). Number
assigned by the Lead. Items 1, 2, 3, 5 and 6 amended by Amendment 1 (playtest B1, B2, E1),
2026-10-13: Proposed.

## Context

ADR-030 item 5 left the toy's no-cards bot at 25–32% against a target of at most 20%. The cause
was map variance. With no cards on a round-4 Market Day, the template decided the round: d1-03
passed 100% of the time and d1-11 2%. About 40% of rush rounds were free passes and about half
were near-certain gridlocks, whatever was played.

CON-06 measured each template on its own. For every template, round (4, 7, 8 for maps that can
hold a Parade, and 12) and factor `k`, it ran seeds 1–200 with no cards and recorded how often the
round passed. Three findings shaped the decision:

1. **Scaling demand alone does not work.** A strong map keeps carrying more than the quota after
   it jams. With 1.6× demand and the same quota, d1-03 still passed 98% of round-4 Market Days
   and 82% of Festivals with no cards. Extra traffic can't make a strong map fail while its quota
   stays where it is, and `roundQuota` had no map argument.
2. **Scaling demand and quota together does work.** The quota keeps its ratio to the map's demand,
   so each template's jam point moves. The factor at which a template passes half of its rounds
   with no cards ranges from 0.6 to 2.0 times today's demand, so the templates differ by about
   3×. The strong ones are the four 4-edge maps (d1-03, d1-06, d1-08, d1-12) and d1-04.
3. **A busy 4-edge map can fill an edge.** An edge has 300 spawn ticks. With a factor above about
   1.3, a Festival on a 4-edge map gives a heavy edge more vehicles than that, and
   `generateDemand` threw.

## Decision

0. **Scope: the toy only** (Lead ruling on #75). The §11 gates read the full 12-round report, and
   the toy and the full run may not diverge on them. So full runs keep the P1-CON-05 curve
   unchanged: base quota 83, `baseVehicles` 66, no factor. Applying the factor to full runs too
   would have broken §11: greedy won 80.5% and four of five archetypes won more than 65%.
1. **Factor.** `TEMPLATE_DEMAND_PERMILLE` in `packages/content/src/demand.ts` gives each District 1
   template a per-mille factor. In a round set up with `templateDemand`, it scales both the
   round's vehicles (`roundVehicles`) and its quota (`roundQuota`). A variant (`d1-03-mx`) uses
   its template's factor. A map with no entry gets 1000.

   | Template | d1-01 | d1-02 | d1-03 | d1-04 | d1-05 | d1-06 | d1-07 | d1-08 | d1-09 | d1-10 | d1-11 | d1-12 |
   | -------- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
   | Factor   | 760   | 530   | 1640  | 1190  | 690   | 1710  | 580   | 1420  | 640   | 620   | 540   | 1810  |

   **Amended (A1):** one factor per template and toy round, and it scales the vehicles only. The
   quota follows from them (A1 item 1).

2. **Calibration.** For each template, the 50% pass factor at each measured round is combined by
   geometric mean. The means are normalised over the bank (geometric mean 1) and multiplied by
   0.905, the toy's overall level. To recalibrate after a
   map change, rerun the sweep and scale the same way.
   **Amended (A1):** calibrated per cell against the card bots (A1 item 3).

3. **API.**
   - `setupRound({ ..., templateDemand: true })` scales the round. Its `quota` and
     `districtRules.quota` then include the factor. The default is false.
   - `roundQuota(district, round, rush, quotaPermille?, mapId?)` and
     `roundVehicles(district, round, rush, boss?, mapId?)` apply the factor when given a map id.
   - `templateDemandPermille(mapId)` resolves the factor.
   - `roundQuota` is still the single quota source (ADR-021 item 2).
     **Amended (A1):** `roundQuota` with a map id is `TOY_QUOTA_SHARE_PERMILLE` of `roundScore`, and
     `templateDemandPermille(mapId, round)` takes the round.

4. **Full edges.** When an edge already spawns on every tick, the vehicle goes to the next edge
   that is not its destination. A round with free ticks draws exactly as before.
5. **Level.** A toy round's quota is also multiplied by `TEMPLATE_QUOTA_LEVEL_PERMILLE` (1060).
   That takes the base from 83 to about 88, about 95% of a clean round 1's score. The base quota
   (83) and `baseVehicles` (66) don't change.
   **Replaced (A1):** the level is gone; the quota is 85% of the spawned score.

6. **Toy mapping.** `TOY_ROUNDS` becomes `[4, 8, 11, 8, 12]`, amending ADR-030 item 2. With the
   templates evened out, Parade and Festival are the hardest rounds for every bot. Two Festivals
   made the toy almost unwinnable: at the level that meets §11, archetypes won 13–20% of toys. One
   Festival, with round 11 in its place, meets the toy targets.
   **Amended (A1):** `TOY_ROUNDS = [4, 8, 11, 10, 12]`.

7. **Run controller.** `RunConfig.templateDemand` (set by `toyRunConfig`, absent in
   `fullRunConfig`) makes the controller pass `templateDemand: true` to `setupRound` and the
   round's map id to `roundQuota`. So the quota the player must beat always equals the
   round-setup quota. An app test checks this for the toy and a full run.

## Results

- Reports:
  - toy: `docs/balance/toy-con-06.md`, 2,000 seeds per bot.
  - full run: `docs/balance/latest.md`, 10,000 seeds per bot.
  - The `no-cards` bot in the toy report is local to the measurement and is not in
    `packages/balance`.
- **No-card pass rate by template** (seeds 1–1,200), round-4 Market Day. Before: 2–100%. After:
  51–79%.

  | Template | d1-01 | d1-02 | d1-03 | d1-04 | d1-05 | d1-06 | d1-07 | d1-08 | d1-09 | d1-10 | d1-11 | d1-12 |
  | -------- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
  | Before   | 31%   | 2%    | 100%  | 81%   | 17%   | 97%   | 6%    | 89%   | 6%    | 4%    | 2%    | 99%   |
  | After    | 74%   | 63%   | 73%   | 67%   | 66%   | 67%   | 56%   | 79%   | 51%   | 66%   | 58%   | 64%   |

- **Toy** (`docs/balance/toy-con-06.md`, 2,000 seeds per bot, toy quota lift 1060):

  | Bot                       | Win        | Target      | Before (P1-CON-05, local wiring) |
  | ------------------------- | ---------- | ----------- | -------------------------------- |
  | `no-cards`                | 20.1%      | at most 20% | 28.0%                            |
  | `random`                  | 10.5%      | 10–30%      | 21.8%                            |
  | `greedy-throughput`       | 58.9%      | at most 75% | 56.6%                            |
  | the five `archetype(tag)` | 45.4–56.5% | 35–65% each | 46.6–53.1%                       |

  By archetype: FLOW 45.4%, MASS 56.5%, TOLL 54.2%, CHAOS 53.6%, TEMPO 48.5%.

  **no-cards meets its target when the samples are pooled.** This 2,000-seed sample gives 20.1%
  (402 of 2,000). The reviewer's fresh 4,000-seed sample gave 19.25%. Pooled over 6,000 seeds,
  `no-cards` wins 19.5%, which meets "at most 20%".
  - The `random` bot plays 6–10 points worse than playing no cards. So "no-cards at most 20%"
    and "random at least 10%" overlap only in a band about a point wide.
  - A lift of 1065 instead of 1060 gave `no-cards` 19.1% but dropped `random` to 9.9%, so 1060
    stays.

  **Toy card deltas aren't gated.** In the toy a bot drafts only after passing a round, so high
  toy deltas mostly measure who was already winning: bus-lane +13.7, detour +12.3 and
  fare-holiday +12.3. §11 gates the full-run deltas, and those are all within limits.

- **Full run** (`docs/balance/latest.md`, 10,000 seeds per bot). Unchanged from P1-CON-05, and the
  §11 gates hold:
  - `random` 5.1%
  - `greedy-throughput` 56.8%
  - archetypes: FLOW 43.4%, MASS 45.3%, TOLL 51.3%, CHAOS 50.8%, TEMPO 37.7%

## Consequences

- In the toy, the quota on the round screen depends on the map. A map that carries more traffic
  gets a bigger quota. At the toy's round 1 (D1 round 4, Market Day), it runs from 99 (d1-02) to
  339 (d1-12). The full run is unchanged.
- Every seeded round's demand changes. The golden determinism fixtures don't use content's
  demand, so they're unchanged. The clip tool's Market Day seed is content-dependent (ADR-028)
  and needs a new one. Seed 4 (d1-08, Market Day) passes with the director's One-Way and
  gridlocks with no cards.
- **The toy and the full run differ in their maps' demand.** Bringing the factor to full runs
  needs a re-tune of the full curve against §11 (a later task).
- **Remaining spread on boss rounds.** The factor is one number per template, so it evens out
  Market Day and normal rounds best. Parade still varies by template: with no cards, 0% on the
  4-edge maps and up to 49% on d1-07 and d1-11. A Festival with no cards passes 0–33%. A
  per-boss factor could even these out later. The targets don't need one.

## Alternatives considered

- **A demand-only factor.** Ruled out by finding 1: a strong map passes a jammed round.
- **A per-template spawn curve.** This has the same problem. It moves the jam point but not a
  jammed strong map's throughput.
- **Editing the maps.** This would change how the bank looks, and the strong maps are strong
  because they have 4 edges. It is a bigger content change than CON-06, and the factor can be
  recalibrated after any map edit.
- **A separate quota-only factor for the 4-edge maps, with their demand capped.** Measured and
  ruled out: their normal rounds then had a quota above everything they spawn.

## Amendment 1: playtest B1, B2 and E1 (2026-10-13)

Status: Proposed · Content Designer · from the Lead's playtest triage
(`2026-10-13-triage-and-plan.md`), with the code freeze lifted for these three items.

### Context

Idan's playtest of 3a9a765 and its validation found three problems in the toy that this ADR
caused or left:

- **B1, no slack.** Item 5 put a toy round's quota at about 95% of all the score it spawns. On
  clear roads a few late or queued cars failed the round (92/115, 113/127, 103/145).
- **B2, the Parade wall.** One factor per template, averaged over rounds, left Parade on the four
  4-edge maps at quotas of 354–451. Card bots passed 0–9% of those Parades, and the toy played
  Parade twice (rounds 2 and 4).
- **E1, dead cards.** Under the GDD's 2-play cap, 18 of the toy's 20 cards cost 1, so energy never
  binds. Overtime (+1 energy) and Pilot Program (next card free) buy nothing and cost a play.

The Lead's bar for the next candidate: toy `no-cards` at most 20%; card bots passing every toy
round at least 50% of the time on every map; no toy round below 10% slack; §11 still in range on
full 12-round runs.

### Decision

1. **Quota (B1).** A toy round's quota is `TOY_QUOTA_SHARE_PERMILLE` (850) of the score the round
   spawns, times the mayor modifier, rounded half up. `roundScore(1, round, rush, boss, mapId)`
   sums each vehicle's §5 score over the round's exact type counts (`mixCounts`), so it includes
   the Festival's volume and emergency vehicles, and adds Market Day's 30 trucks (60 points). It
   is exact, so the quota needs no demand profile. Every toy round, on every map, leaves 15% of
   what spawns as slack. A content test checks this for every map and toy round.
2. **Factor per template and toy round (B1, B2).** `TEMPLATE_DEMAND_PERMILLE[template][round]`
   now scales only the round's vehicles: it sets how busy a map is, and the quota follows. Each
   boss loads a map its own way (a Parade closes a road, a Festival adds 60% and emergency
   vehicles), so a single number per template can't even out every round. A map or round without
   an entry plays at 1000. Full runs still don't use the factor.

   | Template | D1 4 Market Day | D1 8 Parade | D1 11 | D1 10 | D1 12 Festival |
   | -------- | --------------- | ----------- | ----- | ----- | -------------- |
   | d1-01    | 1070            | 670         | 1280  | 1370  | 460            |
   | d1-02    | 610             | –           | 810   | 840   | 290            |
   | d1-03    | 1790            | –           | 2120  | 2230  | 800            |
   | d1-04    | 1930            | 940         | 2140  | 2370  | 820            |
   | d1-05    | 840             | –           | 1080  | 1140  | 390            |
   | d1-06    | 1810            | –           | 2180  | 2290  | 820            |
   | d1-07    | 680             | 670         | 890   | 930   | 330            |
   | d1-08    | 1680            | –           | 2030  | 2130  | 750            |
   | d1-09    | 790             | –           | 1020  | 1080  | 370            |
   | d1-10    | 730             | –           | 940   | 1000  | 350            |
   | d1-11    | 600             | 590         | 790   | 830   | 290            |
   | d1-12    | 1920            | –           | 2260  | 2370  | 850            |

3. **Calibration.** Each cell (template × toy round) was tuned so that the card bots
   (`greedy-throughput` and the five archetypes, pooled) pass it about 64% of the time. The
   method: a sweep of one factor for all maps (600–1250, Festival at half), then per-cell
   iterations on fresh seed ranges, each cell's next factor solved from a logistic fit of its pass
   rate against log factor over all its measurements, with steps capped at ±7%. The final table
   was checked on seeds 1–2,000 with the run's real code path. Measured on the sim with the ADR-033
   gridlock rule (#94), since that rule changes outcomes. To recalibrate after a map or rule
   change, rerun the same loop.
4. **Parade pool (B2).** A toy Parade picks only maps with at least `TOY_PARADE_MIN_EDGES` (5)
   edges, and a closable segment as before. That leaves d1-01, d1-04, d1-07 and d1-11 and their
   variants. A full-run Parade still draws from the whole bank.
5. **One Parade (B2).** `TOY_ROUNDS = [4, 8, 11, 10, 12]`: Market Day, Parade, round 11, round 10,
   Festival. Round 10 replaces the second Parade, so each event comes once. This amends ADR-030
   item 2 again.
6. **Toy cards (E1).** `TOY_EXCLUDED_CARDS = ['overtime', 'pilot-program']`. `toyRunConfig` drops
   them from the starting deck (12 to 10 cards) and from the offer pool (20 to 18 cards). This is
   toy-only, like ADR-007's Grant swap. Full runs keep them, and the 2-play cap and energy 3 stay
   as the GDD sets them.

### Results

Toy, seeds 1–2,000 per bot, branch content plus the ADR-033 sim. `no-cards` is local to the
measurement, as before. "Card" pools `greedy-throughput` and the five archetypes. A round's pass
rate counts only runs that reached it.

| Bot                 | Toy win | ADR-030 target |
| ------------------- | ------- | -------------- |
| `no-cards`          | 19.4%   | at most 20%    |
| `random`            | 10.4%   | 10–30%         |
| `greedy-throughput` | 84.0%   | at most 75%    |
| `archetype(FLOW)`   | 64.4%   | 35–65%         |
| `archetype(MASS)`   | 75.8%   | 35–65%         |
| `archetype(TOLL)`   | 77.2%   | 35–65%         |
| `archetype(CHAOS)`  | 77.0%   | 35–65%         |
| `archetype(TEMPO)`  | 77.7%   | 35–65%         |

Card-bot pass rate by toy round and template (pooled):

| Toy round      | d1-01 | d1-02 | d1-03 | d1-04 | d1-05 | d1-06 | d1-07 | d1-08 | d1-09 | d1-10 | d1-11 | d1-12 |
| -------------- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| 1 (Market Day) | 65%   | 62%   | 62%   | 65%   | 65%   | 67%   | 64%   | 65%   | 62%   | 60%   | 70%   | 64%   |
| 2 (Parade)     | 66%   | –     | –     | 61%   | –     | –     | 66%   | –     | –     | –     | 64%   | –     |
| 3 (D1 11)      | 65%   | 65%   | 66%   | 69%   | 63%   | 65%   | 66%   | 68%   | 66%   | 69%   | 65%   | 65%   |
| 4 (D1 10)      | 62%   | 63%   | 59%   | 67%   | 65%   | 65%   | 63%   | 63%   | 64%   | 64%   | 66%   | 65%   |
| 5 (Festival)   | 66%   | 71%   | 64%   | 63%   | 65%   | 66%   | 62%   | 68%   | 64%   | 64%   | 67%   | 61%   |

- **Against the Lead's bar.** `no-cards` 19.4%. Every cell is 59–71% for the pooled card bots.
  Slack is 15% on every toy round. The full run is unchanged by this amendment (every change is
  toy-only), so §11 stands as reported for the sim it runs on.
- **By single bot,** `greedy-throughput` passes every cell at least 60% of the time and MASS,
  TOLL, CHAOS and TEMPO at least 53%. FLOW dips below 50% in 5 of 52 cells, all on 4-edge maps:
  d1-12 round 1 (42%) and round 5 (43%), d1-03 round 1 (48%), d1-06 round 1 (48%) and round 4
  (49%).
- **`no-cards` per round** is 30–34% on average and 10–52% by cell.
- **Quotas.** A toy Parade asks 132–209 (d1-11 to d1-04), down from 354–451. By toy round, the
  quota runs 151–374 (Market Day), 129–372 (round 11), 129–371 (round 10) and 149–431 (Festival).

### Consequences

- **The toy is easier for the card bots than ADR-030's targets.** A card bot passing each round
  about 64% of the time wins 64–84% of toys with 3 approvals. "At least 50% on every map"
  and "archetypes at most 65%" can't both hold: the second needs about 55% per round, which
  leaves no margin over the first. This amendment follows the Lead's bar, and ADR-030's
  targets for `greedy-throughput` and the archetypes are no longer met.
- **The margin on `no-cards` is small.** Card bots beat no cards by about 32 points per round;
  the bar needs both a 50% floor for the card bots and about 33% at most for no cards. More
  card-bot headroom per cell would raise `no-cards` above 20%.
- **Flat difficulty.** Every round is tuned to the same pass rate, so the toy no longer ramps.
  The quota still rises from Market Day to the Festival on each map.
- **Store copy.** `docs/store/itch.md` lists 20 cards and the TEMPO cards Overtime and Pilot
  Program for the toy. The toy now has 18. The copy isn't changed here.
- **Clip seed.** The Market Day clip seed is now 20 (d1-06; One-Way and Bus Priority pass, no cards
  gridlocks at 0:08). It gives the same outcomes with and without the ADR-033 gridlock rule.
- **The final report** runs on `main` after ADR-033 (#94) merges, as the Lead asked.
