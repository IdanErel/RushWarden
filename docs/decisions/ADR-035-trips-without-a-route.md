# ADR-035: Trips without a route divert or wait; they are never dropped

Status: Accepted (Lead) · 2026-10-14 · Sim Engineer (N1). Number assigned by the Lead.
Supersedes the dropped-trip rule in ADR-022 (closures, "Cut-off trips never start") and
ADR-023 point 8 (and the same sentence in points 19 and 20).

## Context

QA's re-check (N1) found a toy round that failed on an empty board. On seed 11, round 4 (map
d1-05), a One-Way on the bend at (3,2)–(4,2)–(4,3) scored 164 against a quota of 181. With no cards,
150 vehicles spawn and the round scores 205. That bend is the only link between the north-west
part of the map (edges 0 and 1) and the rest. Pointed south-east, it left 29 trips into edges 0
and 1 without a route.

The sim looks up a trip's route when it is due to spawn (`traffic.ts`, `spawn`). With no route,
the trip never started: it counted as neither spawned, arrived nor on the road. This followed
ADR-022 and ADR-023; the GDD says nothing about trips without a route. The toy quota is a share
of the no-card spawned score (#100), so it still counted those trips.

Trips whose entry cell is occupied were already held in a per-edge queue and spawned when the
cell freed. No trip was ever dropped for queue overflow.

Measured on toy bot runs (500 seeds per bot, main ed4f8a7). "Cut rounds" are rounds where the
bot's cards left trips without a route and the same round with no cards did not:

| Bot               | Rounds | Cut rounds | Failed | Failed cut rounds |
| ----------------- | ------ | ---------- | ------ | ----------------- |
| random            | 1,885  | 399        | 1,443  | 350               |
| greedy-throughput | 2,426  | 482        | 748    | 356               |
| archetype(FLOW)   | 2,348  | 545        | 1,031  | 406               |
| archetype(MASS)   | 2,400  | 511        | 910    | 404               |
| archetype(TOLL)   | 2,414  | 391        | 864    | 288               |
| archetype(CHAOS)  | 2,400  | 430        | 902    | 295               |

One-Way caused most of them, then Bus Lane on a one-lane road (a car ban in practice) and No
Heavy. On District 1, 376 of 686 possible One-Way placements cut some edge-to-edge route, and
on 15 of the 38 maps every One-Way does. Refusing such placements would make One-Way
unplayable on those maps.

## Decision

1. **Divert.** A trip with no route to its destination (because of a one-way, a closure, a ban
   or a reserved lane) drives to the nearest exit it can reach instead. "Nearest" means the
   fewest tiles of route, with ties going to the lower map edge id. It scores like any other
   exit. The choice is made once, when the trip is due, and cached per (vehicle type, origin)
   for the round.
2. **Wait.** A trip that can reach no exit at all waits in its edge queue for the rest of the
   round. This happens, for example, when its own entry road is one-way out of the map, or when
   its type is banned from the only road. Placements are fixed for the round, so it never
   spawns. It does not hold up the trips queued behind it, so a truck ban never blocks the cars
   at that edge.
3. **Results.** `RoundResult` gains:
   - `diverted`: trips that spawned diverted.
   - `waiting`: per map edge, in `GridMap.edges` order, the trips that came due but never
     spawned. That covers trips queued behind an occupied entry cell and trips that cannot
     enter.
4. **Live frames.** Worker protocol version 2 (`SIM_PROTOCOL_VERSION`) adds `waiting` to
   `frames` messages: one `waitingSnapshot` (`Uint16Array`, map edge order) per tick, beside
   `controllers`. It is display data and is not part of the state hash.
5. **Ghost check.** `cutRoutes(input, candidate)` is a pure function that reports what a
   placement would cut off this round, given the placements already made. It returns
   `{ cuts, exits, entries }`, or null when the placement is invalid:
   - `cuts`: one `{ vehicleType, from, to }` per trip that loses its route (map edge ids);
   - `exits`: edge ids that lose a route into them;
   - `entries`: edge ids from which some type can no longer reach any exit.

   It runs the round setup with no demand, once with and once without the candidate (about
   0.1 ms on a District 1 map), so the run screen can call it on every cursor move.

6. **Hash.** A round that diverts or strands a trip mixes `diverted` and the per-edge stranded
   counts into the final hash. Other rounds hash exactly as before.

## Balance impact

Diverting trips instead of dropping them makes runs easier, and on the full-run gate
configuration (GDD §11, ADR-010) it takes two bots out of their bands. The Lead accepts this
interim §11 break (2026-10-14): silently dropping trips was a fairness bug, and the numbers
should be tuned on top of the fixed rule. Note (2026-10-14): the toy release candidate is gated
on the toy bands only (ADR-030), which Content re-tunes. The full-run §11 break is tracked under
ADR-036 (Proposed): the GDD §2 base and growth values cannot bring it back without breaking
quota slack.

**Full runs** (12-round District 1, 300 seeds, main ed4f8a7 vs this change), measured by the
reviewer and reproduced exactly by the Sim Engineer with the balance report
(`--seeds 300 --preset full`):

| Bot               | Win rate before | Win rate after | §11 band | After in band    |
| ----------------- | --------------- | -------------- | -------- | ---------------- |
| random            | 2.7%            | 9.0%           | ≤ 10%    | yes (close)      |
| greedy-throughput | 60.7%           | 75.7%          | 55–65%   | no               |
| archetype(FLOW)   | 42.3%           | 61.3%          | 35–65%   | yes              |
| archetype(MASS)   | 45.0%           | 77.7%          | 35–65%   | no               |
| archetype(TOLL)   | 55.3%           | 62.0%          | 35–65%   | yes              |
| archetype(CHAOS)  | 50.3%           | 56.7%          | 35–65%   | yes              |
| archetype(TEMPO)  | 25.0%           | 31.0%          | 35–65%   | no (also before) |

Every card's drafted win-rate delta stays within +12 / −8 points in both reports.

**Toy runs** (5 rounds, 500 seeds per bot, same commits). Each bot plays more rounds after the
change because runs last longer. "Cut rounds" are rounds where cards left trips without a route
(before) or where trips diverted or waited (after):

| Bot               | Round pass rate (before → after) | Run win rate (before → after) | Failed cut rounds (before → after) |
| ----------------- | -------------------------------- | ----------------------------- | ---------------------------------- |
| random            | 23.4% → 30.3%                    | 10.0% → 17.8%                 | 350 → 234                          |
| greedy-throughput | 69.2% → 79.4%                    | 82.4% → 93.6%                 | 356 → 131                          |
| archetype(FLOW)   | 56.1% → 65.1%                    | 61.4% → 77.0%                 | 406 → 178                          |
| archetype(MASS)   | 62.1% → 73.8%                    | 71.2% → 87.4%                 | 404 → 151                          |
| archetype(TOLL)   | 64.2% → 71.0%                    | 75.0% → 85.4%                 | 288 → 118                          |
| archetype(CHAOS)  | 62.4% → 69.1%                    | 71.8% → 83.6%                 | 295 → 165                          |

## Consequences

- See Balance impact above. Content re-runs the toy and full reports and re-tunes after this
  and ADR-033 land.
- Golden hashes change for the 6 of 200 golden rounds that divert or strand a trip (rounds 7,
  19, 67, 87, 171 and 199, all card rounds). The others are unchanged.
- The run screen can show stranded and queued trips at each edge, live and on the result
  screen, and can warn before a placement cuts routes. Render/UI owns that.
- Render's fake worker (`fake-handler.ts`) reports `diverted: 0` and `waiting: []` and sends no
  `waiting` frames.
