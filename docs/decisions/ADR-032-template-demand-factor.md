# ADR-032: District 1 per-template demand factor

Status: Proposed · 2026-10-11 · Content Designer (CON-06). Number assigned by the Lead.

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

1. **Factor.** `TEMPLATE_DEMAND_PERMILLE` in `packages/content/src/demand.ts` gives each District 1
   template a per-mille factor. It scales both the round's vehicles (`roundVehicles`) and its quota
   (`roundQuota`). A variant (`d1-03-mx`) uses its template's factor. A map with no entry, or no
   map at all, gets 1000.

   | Template | d1-01 | d1-02 | d1-03 | d1-04 | d1-05 | d1-06 | d1-07 | d1-08 | d1-09 | d1-10 | d1-11 | d1-12 |
   | -------- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
   | Factor   | 760   | 530   | 1640  | 1190  | 690   | 1710  | 580   | 1420  | 640   | 620   | 540   | 1810  |

2. **Calibration.** For each template, the 50% pass factor at each measured round is combined by
   geometric mean. The means are normalised over the bank (geometric mean 1) and multiplied by
   0.905, the overall level that meets the toy and §11 targets together. To recalibrate after a
   map change, rerun the sweep and scale the same way.
3. **API.** `roundQuota(district, round, rush, quotaPermille?, mapId?)` and
   `roundVehicles(district, round, rush, boss?, mapId?)` take the round's map id;
   `templateDemandPermille(mapId)` resolves it. `setupRound` passes its map, so its `quota` and
   `districtRules.quota` include the factor. `roundQuota` is still the single quota source
   (ADR-021 item 2).
4. **Full edges.** When an edge already spawns on every tick, the vehicle goes to the next edge
   that is not its destination. A round with free ticks draws exactly as before.
5. **Level.** District 1's base quota goes from 83 to 88, about 95% of a clean round 1's score.
   `baseVehicles` stays 66.
6. **Toy mapping.** `TOY_ROUNDS` becomes `[4, 8, 11, 8, 12]`, amending ADR-030 item 2. With the
   templates evened out, Parade and Festival are the hardest rounds for every bot. Two Festivals
   made the toy almost unwinnable: at the level that meets §11, archetypes won 13–20% of toys. One
   Festival, with round 11 in its place, meets the toy targets.
7. **Run controller (Platform).** The controller must pass the round's map to `roundQuota`:

   ```ts
   quota: roundQuota(state.config.district, curveRound, rush !== null, state.config.quotaPermille, setup.map.id),
   ```

   Until it does, the game scales each map's demand but not its quota. Weak maps would then
   fail almost always and strong maps pass almost always, which is worse than today. The content
   change and this line must land together.

## Results

- Reports: 2,000 seeds per bot, toy and full, on this branch plus the line in item 7. The
  `no-cards` bot is local to the measurement and is not in `packages/balance`.
- **No-card pass rate by template** (seeds 1–1,200), round-4 Market Day. Before: 2–100%. After:
  51–79%.

  | Template | d1-01 | d1-02 | d1-03 | d1-04 | d1-05 | d1-06 | d1-07 | d1-08 | d1-09 | d1-10 | d1-11 | d1-12 |
  | -------- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
  | Before   | 31%   | 2%    | 100%  | 81%   | 17%   | 97%   | 6%    | 89%   | 6%    | 4%    | 2%    | 99%   |
  | After    | 74%   | 63%   | 73%   | 67%   | 66%   | 67%   | 56%   | 79%   | 51%   | 66%   | 58%   | 64%   |

- **Toy** (2,000 seeds per bot). Every ADR-030 target is met:

  | Bot                       | Win        | Target      | Before (P1-CON-05, local wiring) |
  | ------------------------- | ---------- | ----------- | -------------------------------- |
  | `no-cards`                | 19.9%      | at most 20% | 28.0%                            |
  | `random`                  | 10.3%      | 10–30%      | 21.8%                            |
  | `greedy-throughput`       | 58.5%      | at most 75% | 56.6%                            |
  | the five `archetype(tag)` | 45.0–56.4% | 35–65% each | 46.6–53.1%                       |

  By archetype: FLOW 45.0%, MASS 56.4%, TOLL 53.9%, CHAOS 53.3%, TEMPO 48.3%.

  `no-cards` and `random` are each within a point of their limits. `random` plays worse than
  playing nothing, by 6–10 points in every setting tried, so `no-cards` at most 20% and `random`
  at least 10% only overlap in a band about a point wide. The Lead may want to widen one of them.

- **Full run** (2,000 seeds per bot). The §11 gates hold: `random` 6.2% (under 10%), and all
  five archetypes are above 35% (FLOW 65.8%, MASS 74.1%, TOLL 68.4%, CHAOS 75.8%, TEMPO 58.9%).
  `greedy-throughput` wins 80.5% and `no-cards` 32.8%. With no cards, the rush rounds pass 64%
  (Market Day), 19% (Parade) and 5% (Festival). With greedy they pass 95%, 31% and 32%.

## Consequences

- The quota on the round screen now depends on the map. A map that carries more traffic gets a
  bigger quota. At round 1 the quota runs from 47 (d1-02) to 159 (d1-12).
- Every seeded round's demand changes. The golden determinism fixtures don't use content's
  demand, so they're unchanged. The clip tool's Market Day seed is content-dependent (ADR-028)
  and needs a new one: seed 4 passes with the director's cards and gridlocks with none, both
  with and without item 7.
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
