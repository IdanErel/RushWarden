# ADR-036: Full-run quota as a share of the round's spawned score

Status: Proposed · 2026-10-14 · Content Designer. Changes GDD §2 (quota formula), so it needs
Idan's answer. It goes with the Phase 2 plan and does not gate the toy release candidate.

## Context

ADR-035 (trips without a route divert) made runs easier and took the full-run GDD §11 gate out
of range (greedy-throughput 75.7%, archetype(MASS) 77.7%, archetype(TEMPO) 31.0%). The Lead asked
Content to bring §11 back with the GDD §2 quota knobs only: `BASE_QUOTA` and
`ROUND_GROWTH_PERMILLE`. The toy already uses a share of the spawned score (ADR-032); this ADR
proposes the same rule for full runs.

All numbers below are District 1, 12 rounds, the `full` balance preset, 300 seeds per bot, on
main 01b1265 (ADR-035) with #94's sim change (ADR-033 gridlock rule, d8a8ef4) applied locally.
`mcts-lite` does not exist yet, so greedy-throughput stands in for it (ADR-010).

### Base and growth cannot reach §11 without breaking slack

The full-run quota is `base * (1 + 0.11*(r-1)) * rushMult`. The spawned score grows at nearly
the same rate, so the quota is an almost flat share of a plain round's score. Boss rounds spawn
far more than `rushMult` covers:

| Round | Boss       | Spawned score | Quota at base 83 | Base 88   | Base 93    | 0.88 share |
| ----- | ---------- | ------------- | ---------------- | --------- | ---------- | ---------- |
| 1     | –          | 93            | 83 (89%)         | 88 (95%)  | 93 (100%)  | 82         |
| 2     | –          | 102           | 92 (90%)         | 98 (96%)  | 103 (101%) | 90         |
| 3     | –          | 113           | 101 (89%)        | 107 (95%) | 113 (100%) | 99         |
| 4     | Market Day | 256           | 177 (69%)        | 187 (73%) | 198 (77%)  | 225        |
| 5     | –          | 132           | 120 (91%)        | 127 (96%) | 134 (102%) | 116        |
| 6     | –          | 142           | 129 (91%)        | 136 (96%) | 144 (101%) | 125        |
| 7     | –          | 155           | 138 (89%)        | 146 (94%) | 154 (99%)  | 136        |
| 8     | Parade     | 262           | 235 (90%)        | 249 (95%) | 263 (100%) | 231        |
| 9     | –          | 174           | 156 (90%)        | 165 (95%) | 175 (101%) | 153        |
| 10    | –          | 184           | 165 (90%)        | 175 (95%) | 185 (101%) | 162        |
| 11    | –          | 195           | 174 (89%)        | 185 (95%) | 195 (100%) | 172        |
| 12    | Festival   | 598           | 293 (49%)        | 311 (52%) | 329 (55%)  | 526        |

At base 83, plain rounds already ask for 89–91% of the spawned score, which is the 10% slack
floor (ADR-030). Raising the base breaks slack in every plain round before it touches Market Day
(69%) or Festival (49%), which are where runs are easy. Base 93 asks for 100% or more, and no
bot wins a run. Growth moves plain and boss rounds together, and `ROUND_GROWTH_PERMILLE` also
drives demand volume (`roundVehicles`), so changing it moves the toy too.

Win rates (300 seeds per bot):

| Quota rule | no-cards | random | greedy   | FLOW    | MASS     | TOLL    | CHAOS   | TEMPO    |
| ---------- | -------- | ------ | -------- | ------- | -------- | ------- | ------- | -------- |
| §11 target | –        | < 10   | 55–65    | 35–65   | 35–65    | 35–65   | 35–65   | 35–65    |
| base 83    | 19.0     | 9.0    | **75.7** | 61.3    | **77.7** | 62.3    | 56.7    | **31.0** |
| base 88    | 14.7     | 5.7    | **70.7** | 53.3    | **68.3** | 56.3    | 53.0    | **28.0** |
| base 93    | 0.0      | 0.0    | **0.0**  | **0.0** | **0.0**  | **0.0** | **0.0** | **0.0**  |
| 0.86 share | 10.0     | 5.7    | 62.0     | 46.3    | **67.0** | 46.3    | 49.3    | **16.3** |
| 0.88 share | 9.7      | 4.3    | 59.7     | 45.3    | 62.3     | 45.0    | 46.7    | **15.7** |
| 0.90 share | 9.3      | 3.7    | 57.0     | 45.0    | 59.7     | 45.0    | 45.7    | **14.7** |

Base 88 already has about 4% slack in plain rounds and still leaves greedy and MASS high.
Between 83 and 93 there is no base where greedy is in 55–65% and every plain round keeps 10%
slack.

## Decision (proposed)

1. **Full-run quota is a share of the spawned score.** For District 1,
   `quota = round(0.88 * roundScore(d, r, rush, boss) * mayorModifier)`, rounded half up, with
   `roundScore` as defined for the toy (ADR-032: exact §5 score values of the round's vehicle
   mix, Market Day trucks included). It replaces `base[d] * (1 + 0.11*(r-1)) * rushMult` in
   GDD §2. `BASE_QUOTA` and `RUSH_PERMILLE` stop setting the quota for District 1;
   `ROUND_GROWTH_PERMILLE` keeps driving demand volume.
2. **Slack.** Every round keeps 12% slack against the no-card spawned score, boss rounds
   included.
3. **Scope.** District 1 only, as for the toy. Districts 2 and 3 have no demand data yet and
   keep the GDD formula until they do.
4. **Mayors.** The mayor modifier still multiplies the quota. The Intern's +15% then asks for
   1.012 of the spawned score; at base 83 it already asks for about 1.03 in plain rounds. That
   is left for the mayor pass.

With 0.88, greedy-throughput, FLOW, MASS, TOLL and CHAOS are in band and random stays under 10%.
The GDD §2 aim, "the median well-drafted deck wins District 1 at a 55–65% rate", holds for
greedy at 59.7%. TEMPO stays out of band under every quota rule, so quota alone cannot meet the
§11 "5 archetype bots above 35%" criterion. That needs a card or rule change; see below.

## TEMPO

TEMPO's four cards change resources, not traffic: Overtime (+1 energy next round), Second Shift
(cost 2, draw +2), Pilot Program (next card costs 0) and Recount (redraw the hand). With energy
3 and a cap of 2 plays a round (GDD §2/§4, `DEFAULT_RULES`), a TEMPO card uses one of the two
plays and scores nothing itself. The extra energy, cards or discount it buys can only go into
the one play left. The archetype(TEMPO) bot plays its tag first, so a TEMPO card in hand takes one of its two plays
from a traffic card.

Options, measured on the same setup (C was measured per archetype bot; greedy doesn't prefer a
tag, so its numbers are today's):

| Option (300 seeds per bot)                              | Quota      | greedy | FLOW | MASS | TOLL | CHAOS | TEMPO |
| ------------------------------------------------------- | ---------- | ------ | ---- | ---- | ---- | ----- | ----- |
| Today                                                   | base 83    | 75.7   | 61.3 | 77.7 | 62.3 | 56.7  | 31.0  |
| Today                                                   | 0.88 share | 59.7   | 45.3 | 62.3 | 45.0 | 46.7  | 15.7  |
| A. Overtime +2 energy (upgrade +3), Second Shift cost 1 | base 83    | 76.0   | 61.3 | 77.7 | 62.3 | 56.7  | 30.3  |
| A. same                                                 | 0.88 share | 60.0   | 45.3 | 62.3 | 45.0 | 46.7  | 15.7  |
| B1. TEMPO cards don't count toward the 2-play cap       | base 83    | 81.7   | 62.0 | 83.3 | 63.0 | 58.0  | 50.3  |
| B1. same                                                | 0.88 share | 68.3   | 45.7 | 72.7 | 49.3 | 46.3  | 32.3  |
| B1. same                                                | 0.91 share | 66.3   | 43.7 | 69.3 | 46.7 | 44.3  | 30.7  |
| B2. One TEMPO card a round doesn't count toward the cap | 0.88 share | 65.3   | 43.0 | 69.7 | 46.0 | 44.0  | 32.3  |
| B2. same                                                | 0.90 share | 64.0   | 41.0 | 68.7 | 45.3 | 42.7  | 31.0  |
| C. Archetype bots draft their tag but play greedily     | base 83    | 75.7   | 73.7 | 86.7 | 71.0 | 72.7  | 65.0  |
| C. same                                                 | 0.88 share | 59.7   | 52.7 | 78.3 | 53.3 | 60.7  | 43.7  |

Read each row against 55–65 for greedy and 35–65 for the archetypes. `random` and `no-cards`
move by at most 0.4 points under every option. The random bot plays at most 2 cards under B as
well, so B's effect on a human who plays freely is not in these numbers.

- **A. Card numbers** (Content can do it, no rule change). No measurable effect. Under the 2-play
  cap, 18 of 20 cards cost 1 and energy is 3, so more energy or cheaper cards buy nothing while
  the TEMPO card itself still uses one of the two plays. This is the E1 finding (ADR-032
  Amendment 1) again.
- **B. Relax the cap for TEMPO** (a rule change to GDD §2/§4, Sim/App work). TEMPO roughly doubles
  (15.7% to 32.3% at 0.88), but every bot that drafts TEMPO cards gains too: greedy and MASS leave
  their bands and need a higher share, which pulls TEMPO back under 35%. Allowing one free TEMPO
  play a round (B2) instead of any number (B1) costs TEMPO nothing and gives greedy and MASS back
  about 3 points. A card-level version would be a new effect, "+1 play this round", on Second
  Shift and Pilot Program; it is not measured but should land between B2 and B1.
- **C. Bot rule** (Balance tooling, no game change). GDD §11 defines `archetype(tag)` as "prefers
  its tag". The bots read that as drafting only their tag and also playing their tag's cards
  first, so the TEMPO bot spends a play every round on a card that scores nothing. With the
  preference applied to drafting only, TEMPO wins 43.7% at 0.88 (65.0% at base 83), in band
  without touching a card. The same change lifts MASS to 78.3% at 0.88, out of band, so C needs a
  MASS look too (MASS has been the highest archetype in every report since ADR-035).

None of A, B or C brings all five archetypes and greedy into band on its own at 0.88. C is the
cheapest and the closest; B is the design answer if TEMPO is meant to be a way to win rather than
a support tag. The two can be combined; that is not measured.

## Consequences

- GDD §2's quota line changes for District 1. Content updates `roundQuota` to the share rule
  for full runs, the content tests, and the full balance report, in one PR after Idan accepts.
- ADR-035's full-run §11 break is tracked here. The toy release candidate is gated on the toy
  bands only (ADR-030), not on this ADR.
- The TEMPO decision is separate from the quota rule and can be taken either way. Without one,
  §11's archetype criterion fails on TEMPO whatever the quota.
- Every quota change attaches the full report (GDD §11). The tables above are probes at 300
  seeds, not the official report; the official run follows the implementation PR.
