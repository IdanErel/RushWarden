# ADR-033: Gridlock is no progress, not zero speed

Status: Accepted (Lead) · 2026-10-13 · Sim Engineer (B3). Number assigned by the Lead.

## Context

GDD §3 defines the gridlock detector as "the sum of `v` across all vehicles is 0 for 60
consecutive ticks" ("no vehicle moves for 3 consecutive sim seconds"). In the 2026-10-13 playtest
(triage item B3) a board that was visibly frozen ran to the end of Go and showed "Quota missed"
instead of the gridlock ending. The cause: once the junctions lock up, newly spawned vehicles
still drive up their spawn road to the back of the queue. Each of those ticks has a speed sum
above 0 and resets the 60-tick window, so the detector fires late or not at all.

Measured on toy runs (150 seeds, no cards played, 685 rounds, main at c9e3806): 189 rounds end in
gridlock, declared a median 4.5 s after the last exit (p90 7.7 s, max 11.5 s). Another 63 rounds
had no exit for at least the last 3 s and still ran to tick 300 without a gridlock, 58 of them
ending as "Quota missed".

## Decision

1. **Gridlock is no progress.** The round ends as gridlock after `GRIDLOCK_TICKS` (60, 3 s)
   consecutive ticks in which at least one vehicle is on the map, no vehicle exits, and no vehicle
   enters a junction box. Movement anywhere else, such as creeping along a spawn road or up a
   queue, no longer resets the window.
2. A tick with no vehicle on the map still does not count and resets the window, as before.
3. The sim counts junction entries in `Traffic.boxEntries` (incremented in `enterBox`) and keeps
   `exited + boxEntries` from the previous tick in `State.lastProgress`. Both are sim-internal; the
   `RoundResult` and the frame protocol are unchanged.
4. This supersedes the two gridlock sentences in GDD §3 (Scoring and quotas, Timing). The Lead
   owns the GDD edit.

## Consequences

- Same 685 rounds after the change: 235 gridlocks (+46), declared a median 3.3 s after the last
  exit (p90 5.7 s, max 8.9 s). Frozen but not gridlocked drops from 63 to 20 (Quota missed among
  them 58 to 15). The 20 left all had 57 to 95 junction entries after their last exit: vehicles
  were still moving through junctions, so they are not frozen under this rule.
- Rounds that miss quota stay at 415 of 685. A gridlock can only end a round earlier, so no round
  turned from pass to fail; the change only moves frozen failures from "Quota missed" to
  "Gridlock".
- Golden hashes are unchanged: none of the 200 golden rounds gridlocks under either rule. New sim
  tests cover the spawn-road case and a junction entry resetting the window.
- Balance numbers that count gridlocks change; Content re-tunes after this merges.
- Known edge: a single slow vehicle on a route with no junction (a straight edge-to-edge road)
  could take more than 3 s to cross with heavy p_slow and be called gridlock. It did not occur in
  the sample above: every gridlock had at least 14 vehicles on the map.
