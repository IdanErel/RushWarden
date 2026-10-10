# ADR-018: Run controller rule readings

Status: Accepted · 2026-10-10 · Lead (proposed by Platform Engineer)

Task: P1-BAL-01 (moved from Sim to Platform by the Lead).

GDD §2 and §4 fix the core loop and draft rules but leave some mechanics open. The run controller
(`packages/app/src/run/`) reads them as follows. Content and balance tuning may change the numbers;
changing a rule needs a new ADR.

1. **Deck model.** A run has a draw pile, a hand, the cards played this round, and a spent pile.
   Hands are drawn from the top of the draw pile. Unplayed cards go back to the bottom of the draw
   pile ("unplayed cards return to the deck", §2). Played cards go to the spent pile, which is
   shuffled into the draw pile when it runs out ("deck shuffles when empty", §4). There is no
   discard pile in the player's view.
2. **Picked offer cards** are shuffled into the draw pile at a random position, so they can show
   up next round. Skipping gives +2 funds (§2). Offers come only after a passed round and never
   after the last round.
3. **Run-duration cards** stay in the deck. Their placement joins `CardState.runEffects` from the
   next round on, and their `perRound` energy applies every later round.
4. **Stacking** (§4): playing the same card on the same target as an earlier placement this round
   or in `runEffects` is refused, so energy is not wasted. **Conflicting controllers**: when a
   card with `setController` lands on an intersection that already received one this round, the
   earlier card's paid energy is refunded. Its placement stays, and the sim lets the later one
   win by `order`. The refunded card still counts toward the 2-play limit. **Refunds don't stack
   (Lead ruling):** when the conflict refund and a `replaced-signal` refund (Remove Signal) both
   trigger on one play, only the larger applies. Targets are compared structurally: key order
   never matters, and a segment is the same target in either direction (it covers the same
   tiles). A placement the sim would reject (`placementError`, ADR-014) is refused at play time,
   so Go never throws.
5. **Quota** is `base[d] * (1000 + 110*(r-1)) * rush * mayor`, computed in per-mille integers and
   rounded half up. **Funds** for a pass are +4, plus +1 per full 10% over quota with that bonus
   capped at +6, plus `RoundResult.fundsDelta`, plus flat `fundsModifier`s (point 7). Funds
   never go below 0.
6. **Offers** roll rarity 60/30/10 per slot. They fall back to any eligible card when that rarity
   has none, and never repeat a card within an offer. The pity rule replaces the
   last slot with a random card of the deck's dominant tag if none was offered. **Lead ruling:** pity
   applies from the offer made after passing round 3 (`round >= 3`). Ties for the
   dominant tag go to FLOW, MASS, TOLL, CHAOS, TEMPO in that order.
7. **Run effects.**
   - `drawModifier` adds cards to the next round's draw, once.
   - `energyModifier` adds energy `now`, or once `next-round`, or every round (`perRound`). With
     `replaced-signal`, it applies only when the intersection's controller **before this round's
     cards** (run effects over the map default; maps author none yet) is a signal. This is the
     sim's reading in `resolvePlacements().replacedController` (#32), so a signal played earlier
     in the same round is not "replaced": Remove Signal over it gets the conflict refund only.
   - `costModifier` with `next` + `cost` makes the next N plays this round cost exactly `cost`.
     With `delta`, it changes costs (never below 0) for the rest of the round, or for the run if
     the card's duration is `run`.
   - `redraw` puts the rest of the hand at the bottom of the draw pile and draws the same number.
     With `keep: 1`, the player first picks one card to keep.
   - **`fundsModifier` (Lead ruling):** a per-vehicle form (`per` set, Toll Booth) is applied by
     the sim into `RoundResult.fundsDelta`; a flat form (no `per`; Grant, Public Hearing) is
     applied by the run controller at round end, from this round's plays and from `runEffects`.
   - **Bounds (ADR-014):** `startRun` throws if any card, at tier 1 or 2, has a run-level effect
     outside content's schema bounds: `drawModifier` and `energyModifier` ±1..5,
     `costModifier.delta` ±1..3 or `next` 1..2 with `cost` 0..3 (one form, never both),
     `redraw.keep` 0..1, `fundsModifier.delta` ±1..20 with `per` 1..100. In-round energy never
     goes below 0.
   - Unspent energy does not carry over.
8. **Undo** before Go restores the exact earlier state, including the PRNG. **Lead ruling:** undo
   is not allowed past a Recount/redraw, so the draw pile is never revealed for free.
9. **Seeds.** One xoshiro128** stream from the run seed drives shuffles, offers and round seeds.
   Each round's seed is the next uint32 at round start. Map and demand are set up from that seed
   at round start, so the heat-strip can be shown before placement (§2). The round setup's `districtRules.pSlowPermille` and `closedSegments` (Parade) are kept
   in the run state and passed to the sim in `RoundInput`; the quota stays the controller's.
10. **Win and loss.** Approval 0 ends the run as a loss immediately. Surviving the last round
    (5 in the toy, 12 in a full run, ADR-007) is a win.
