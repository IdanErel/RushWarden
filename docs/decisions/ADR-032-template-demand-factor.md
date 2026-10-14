# ADR-032: District 1 per-template demand factor

Status: Accepted (Lead, on the toy-only scope) · 2026-10-11 · Content Designer (CON-06). Number
assigned by the Lead. Items 1, 2, 3, 5 and 6 amended by Amendment 1 (playtest B1, B2, E1),
2026-10-13: Proposed. Amendment 1 item 3's factors re-tuned by Amendment 2 (ADR-035), 2026-10-14:
Accepted (Lead, #108).

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
   **Replaced (A1):** the level is gone; the quota is 86% of the spawned score.

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
(`2026-10-13-triage-and-plan.md`), with the code freeze lifted for these three items, and the
Lead's ruling on #100 (quota share and toy targets).

### Context

Idan's playtest of 3a9a765 and its validation found three problems in the toy that this ADR
caused or left:

- **B1, no slack.** Item 5 put a toy round's quota at about 95% of all the score it spawns. On
  clear roads a few late or queued cars failed the round (92/115, 113/127, 103/145).
- **B2, the Parade wall.** One factor per template, averaged over rounds, left Parade on the four
  4-edge maps at quotas of 354–451. Card bots passed 0–9% of those Parades, and the toy played
  Parade twice (rounds 2 and 4).
- **E1, dead cards.** Under the GDD's 2-play cap, 16 of the 20 toy cards cost 1 and 4
  cost 2, so energy 3 rarely binds (only for two cost-2 plays). Overtime (+1 energy) and Pilot
  Program (next card free) rarely buy anything and cost a play.

The triage asked for about 85% of the spawned score, card bots passing every toy round at least
50% of the time on every map, and no toy round below 10% slack. At 85% the card bots won 64–84%
of toys, so the Lead ruled on #100: a share of 0.86–0.90 (0.88 first), and new toy targets in
ADR-030 item 3. Each archetype bot 55–75%, `greedy-throughput` at most 80%, `random` 10–30%,
`no-cards` at most 20%, and no toy round or map below 35% for any archetype bot. Full-run §11 is
unchanged.

### Decision

1. **Quota (B1).** A toy round's quota is `TOY_QUOTA_SHARE_PERMILLE` (860) of the score the round
   spawns, times the mayor modifier, rounded half up. `roundScore(1, round, rush, boss, mapId)`
   sums each vehicle's §5 score over the round's exact type counts (`mixCounts`), so it includes
   the Festival's volume and emergency vehicles, and adds Market Day's 30 trucks (60 points). It
   is exact, so the quota needs no demand profile. Every toy round, on every map, leaves 14% of
   what spawns as slack. A content test checks this for every map and toy round.
2. **Share 0.86.** Measured over 600 seeds per bot (2,000 for 0.86) with the factors below:

   | Share | `no-cards` | `random` | `greedy` | archetypes | Lowest archetype cell |
   | ----- | ---------- | -------- | -------- | ---------- | --------------------- |
   | 0.85  | 19.4%      | 10.4%    | 84.0%    | 64.4–77.7% | 42%                   |
   | 0.86  | 18.5%      | 9.4%     | 81.2%    | 59.0–74.0% | 38%                   |
   | 0.88  | 13.7%      | 5.5%     | 74.7%    | 48.2–66.8% | 23%                   |
   | 0.90  | 11.2%      | 4.0%     | 64.2%    | 38.5–58.3% | 11%                   |

   (0.85 was measured before #95 merged.) A higher share hurts `random` most, since it fails
   anyway on clear roads with no slack, and it puts the 4-edge maps' steep cells below 35%. 0.86
   meets the `no-cards`, archetype and per-cell targets and misses `random` (9.4% for 10%) and
   `greedy-throughput` (81.2% for 80%) by about a point each. Those two pull against each other:
   making the toy harder lowers both, and easier raises both.

3. **Factor per template and toy round (B1, B2).** `TEMPLATE_DEMAND_PERMILLE[template][round]`
   now scales only the round's vehicles: it sets how busy a map is, and the quota follows. Each
   boss loads a map its own way (a Parade closes a road, a Festival adds 60% and emergency
   vehicles), so a single number per template can't even out every round. A map or round without
   an entry plays at 1000. Full runs still don't use the factor.

   | Template | D1 4 Market Day | D1 8 Parade | D1 11 | D1 10 | D1 12 Festival |
   | -------- | --------------- | ----------- | ----- | ----- | -------------- |
   | d1-01    | 1070            | 670         | 1280  | 1370  | 460            |
   | d1-02    | 610             | –           | 810   | 840   | 290            |
   | d1-03    | 1750            | –           | 2120  | 2230  | 800            |
   | d1-04    | 1930            | 940         | 2140  | 2370  | 820            |
   | d1-05    | 840             | –           | 1080  | 1140  | 390            |
   | d1-06    | 1810            | –           | 2180  | 2290  | 820            |
   | d1-07    | 680             | 670         | 890   | 930   | 330            |
   | d1-08    | 1680            | –           | 2030  | 2130  | 750            |
   | d1-09    | 790             | –           | 1020  | 1080  | 370            |
   | d1-10    | 730             | –           | 940   | 1000  | 350            |
   | d1-11    | 600             | 590         | 790   | 830   | 290            |
   | d1-12    | 1880            | –           | 2260  | 2370  | 850            |

4. **Calibration.**
   - The cells were tuned at share 0.85 so that the card bots (`greedy-throughput` and the five
     archetypes, pooled) pass each about 64% of the time.
   - The method: a sweep of one factor for all maps (600–1250, Festival at half), then per-cell
     iterations on fresh seed ranges. Each cell's next factor was solved from a logistic fit of
     its pass rate against log factor over all its measurements, with steps capped at ±7%.
   - At 0.86, d1-03 and d1-12 Market Day were eased 2% (1790 to 1750, 1920 to 1880) to lift FLOW's
     weakest cells.
   - Everything was measured on the sim with the ADR-033 gridlock rule (#94), since that rule
     changes outcomes.
   - To recalibrate after a map or rule change, rerun the same loop.
5. **Parade pool (B2).** A toy Parade picks only maps with at least `TOY_PARADE_MIN_EDGES` (5)
   edges, and a closable segment as before. That leaves d1-01, d1-04, d1-07 and d1-11 and their
   variants. A full-run Parade still draws from the whole bank.
6. **One Parade (B2).** `TOY_ROUNDS = [4, 8, 11, 10, 12]`: Market Day, Parade, round 11, round 10,
   Festival. Round 10 replaces the second Parade, so each event comes once. This amends ADR-030
   item 2 again.
7. **Toy cards (E1).** `TOY_EXCLUDED_CARDS = ['overtime', 'pilot-program']`. `toyRunConfig` drops
   them from the starting deck (12 to 10 cards) and from the offer pool (20 to 18 cards). This is
   toy-only, like ADR-007's Grant swap. Full runs keep them, and the 2-play cap and energy 3 stay
   as the GDD sets them.

### Results

Toy, seeds 1–2,000 per bot, on this branch with `main` at 7bee954 merged in and the ADR-033 sim
commit (d8a8ef4) applied locally. `no-cards` is local to the measurement, as before. A round's
pass rate counts only runs that reached it.

| Bot                 | Toy win | Target (ADR-030 item 3, amended) |
| ------------------- | ------- | -------------------------------- |
| `no-cards`          | 18.5%   | at most 20%                      |
| `random`            | 9.4%    | 10–30%, ±2 (accepted)            |
| `greedy-throughput` | 81.2%   | at most 80%, ±2 (accepted)       |
| `archetype(FLOW)`   | 59.0%   | 55–75%                           |
| `archetype(MASS)`   | 71.5%   | 55–75%                           |
| `archetype(TOLL)`   | 74.0%   | 55–75%                           |
| `archetype(CHAOS)`  | 71.1%   | 55–75%                           |
| `archetype(TEMPO)`  | 72.6%   | 55–75%                           |

- **Lowest cell per archetype** (toy round, template):
  - FLOW 38% (Festival, d1-12)
  - CHAOS 47% (round 4, d1-01)
  - TEMPO 49% (round 3, d1-01)
  - MASS 50% (Festival, d1-09)
  - TOLL 52% (round 4, d1-03)

  Every cell is above the 35% floor. `greedy-throughput`'s lowest cell is 57%.

- **Card bots pooled:** 55–69% in every cell. **`no-cards`** is 28–35% per round on average.
- **Slack** is 14% on every toy round and map.
- **Quotas.** A toy Parade asks 133–212 (d1-11 to d1-04), down from 354–451.
- **Full run.** Unchanged by this amendment: every change is toy-only.

### Consequences

- **Two targets are missed by about a point.** `random` is at 9.4% (target 10%) and
  `greedy-throughput` at 81.2% (target at most 80%), and no share in 0.86–0.90 meets both. The
  Lead accepted 0.86 with both residuals on #100, and ADR-030 item 3 now carries a ±2-point
  tolerance on the bot bands.
- **Flat difficulty.** Every round is tuned to about the same pass rate, so the toy no longer
  ramps. The quota still rises from Market Day to the Festival on each map.
- **Store copy.** `docs/store/itch.md` now lists the toy's 18 cards and says three of the five
  rounds bring an event.
- **Clip seed.** The Market Day clip seed is now 20, on d1-06. With One-Way and Bus Priority it
  passes 384 against 357; with no cards it gridlocks at 0:08. The outcomes are the same with and
  without the ADR-033 gridlock rule.
- **The final report** runs on `main` after ADR-033 (#94) merges, as the Lead asked.

## Amendment 2: re-tune after ADR-035 (2026-10-14)

Status: Accepted (Lead, #108) · Content Designer · from the Lead's #106 heads-up and the toy-only release
candidate gate.

### Context

ADR-035 (#106) diverts trips that have no route instead of dropping them, which makes every card
round easier. On the Amendment 1 factors at share 0.86, with ADR-033 (#94) applied, the toy
measured `greedy-throughput` 93.2%, archetypes 78.0–88.0%, `random` 14.2% and `no-cards` 17.7%
(1,000 seeds per bot). Raising the share alone trades badly: at 0.90 greedy is still 85.8% and
`random` already 7.3%.

### Decision

1. **Share unchanged** at 0.86, so slack stays 14% on every toy round and map.
2. **Factors.** Amendment 1 item 3's table becomes the one below (old value in brackets where it
   changed). Most of the change makes the busier 5- and 6-edge maps busier, which is where
   diverted trips helped the card bots most. FLOW's weakest cells (Festival on d1-03 and d1-06,
   round 11 on d1-12) were then eased about 2%, and d1-06's Market Day stays at 1810 so the clip
   seed keeps its outcomes.

   | Template | D1 4 Market Day | D1 8 Parade | D1 11       | D1 10       | D1 12 Festival |
   | -------- | --------------- | ----------- | ----------- | ----------- | -------------- |
   | d1-01    | 1080 (1070)     | 730 (670)   | 1300 (1280) | 1450 (1370) | 500 (460)      |
   | d1-02    | 680 (610)       | –           | 860 (810)   | 950 (840)   | 320 (290)      |
   | d1-03    | 1740 (1750)     | –           | 2120        | 2210 (2230) | 780 (800)      |
   | d1-04    | 2100 (1930)     | 1050 (940)  | 2270 (2140) | 2360 (2370) | 870 (820)      |
   | d1-05    | 970 (840)       | –           | 1240 (1080) | 1280 (1140) | 460 (390)      |
   | d1-06    | 1810            | –           | 2230 (2180) | 2350 (2290) | 830 (820)      |
   | d1-07    | 780 (680)       | 780 (670)   | 950 (890)   | 1020 (930)  | 370 (330)      |
   | d1-08    | 1730 (1680)     | –           | 2080 (2030) | 2180 (2130) | 800 (750)      |
   | d1-09    | 870 (790)       | –           | 1080 (1020) | 1140 (1080) | 410 (370)      |
   | d1-10    | 820 (730)       | –           | 1010 (940)  | 1070 (1000) | 360 (350)      |
   | d1-11    | 690 (600)       | 660 (590)   | 880 (790)   | 920 (830)   | 320 (290)      |
   | d1-12    | 1910 (1880)     | –           | 2280 (2260) | 2420 (2370) | 880 (850)      |

3. **Calibration.** Same loop as item 4, on fresh seed ranges, followed by a run-level model
   (per bot and cell, a logistic fit of pass rate against log factor, combined over each seed's
   five cells) to pick between candidate tables.

### Results

Toy, seeds 1–2,000 per bot, on `main` 01b1265 (ADR-035) with the ADR-033 sim commit (d8a8ef4)
applied locally. `no-cards` is local to the measurement, as before.

| Bot                 | Toy win | Target (ADR-030 item 3, amended) |
| ------------------- | ------- | -------------------------------- |
| `no-cards`          | 7.1%    | at most 20%                      |
| `random`            | 6.5%    | 5–30% (Lead, #108)               |
| `greedy-throughput` | 80.7%   | at most 80%, ±2                  |
| `archetype(FLOW)`   | 56.5%   | 55–75%                           |
| `archetype(MASS)`   | 73.3%   | 55–75%                           |
| `archetype(TOLL)`   | 66.8%   | 55–75%                           |
| `archetype(CHAOS)`  | 62.2%   | 55–75%                           |
| `archetype(TEMPO)`  | 67.8%   | 55–75%                           |

- **Lowest cell per archetype:** FLOW 40% (round 1, d1-04 and others), TOLL 44%, CHAOS 42%,
  MASS 43%, TEMPO 46%. Every cell is above the 35% floor; greedy's lowest is 51%.
- **Second seed range** (2,001–4,000, the table before the three 2% eases): greedy 79.2%,
  FLOW 54.5%, `random` 5.5%.

### Consequences

- **`random` band moved to 5–30%.** After ADR-035, `random` and `greedy-throughput` can no longer both
  be met. Every table tried moves them together: the tables with greedy at most 82% put `random`
  at 5.5–6.5% (2,000 seeds each), and the one table near `random` 8% (8.4%) had greedy at 82.9%
  on 800 seeds. Raising the share instead is worse (0.90: greedy 85.8%, `random` 7.3%). The
  release candidate gate is greedy back inside tolerance. The Lead accepted this table on #108
  and set the toy `random` band to 5–30% (ADR-030 item 3).
- **Quotas.** Toy quotas rise with the busier maps: a toy Parade now asks 149–236 (d1-11 to
  d1-04), up from 133–212.
- **Clip seed.** Unchanged (20); its Market Day keeps both outcomes, with and without ADR-033.
- **The official report** runs on `main` after ADR-033 (#94) merges.
- **Full run.** Unchanged: the factor is toy-only. The full-run §11 break from ADR-035 is ADR-036.
