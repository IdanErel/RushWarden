# ADR-021: Round demand model, seed salts and District 1 bosses

Status: Proposed · 2026-10-10 · Content Designer (P1-CON-04; the Lead asked for this ADR)

GDD §2, §3 and §5 fix the demand mix, the quota formula, the rush multiplier, the heat-strip and
the boss names. They leave open how many vehicles a round spawns, when and where they spawn, how
the seed is split, and what the bosses do in data. `packages/content/src/demand.ts` and
`src/parade.ts` read them as follows.

**All numbers below are untuned starting values.** The sim did not spawn vehicles when they were
set, so P1-CON-05 tunes them from the P1-BAL-02 report. Changing a value is a content change with
a balance report; changing a rule needs a new ADR.

1. **Entry point.** `setupRound({ round, seed, rush?, boss?, district? })` returns:
   - the map
   - `demandProfile`
   - `heatStrip`
   - `quota`
   - `districtRules`
   - `closedSegments`

   It is a pure function of its argument. The argument has the same shape as the run
   controller's `RunEnv.setupRound` (ADR-018). `rush` and `boss` default to rounds 4, 8 and 12
   and the district's §5 bosses.

2. **Quota.** `roundQuota` is the single source (Lead decision): `base[d] * (1000 + 110*(r-1)) *
rush * mayor`, in per-mille integers and rounded half up (ADR-018 item 5).
3. **Volume.** A round spawns `baseVehicles * (1 + 0.11*(r-1)) * rush * festival` vehicles,
   rounded half up. It grows with the quota, while the map's capacity stays fixed, so congestion
   rises each round. In District 1:
   - `baseVehicles` is 28. With the mean score of 1.4 per vehicle, that is about 39 points
     against a round-1 quota of 26.
   - Round 12 under rush is 99 vehicles. With Festival it is 158. That is spawns over 15 s, not
     vehicles on screen at once.
4. **Mix.** Each type gets exact counts from the district's per-mille mix: shares are rounded
   down, and the leftovers go to the largest remainders (ties in `VehicleType` order). The order
   of types is then shuffled. District 1 is 700 car, 150 bus, 100 truck and 50 bike (GDD §5).
5. **Timing and place.**
   - Each vehicle draws its second from `SECOND_WEIGHTS`, a rush-hour curve over the 15 seconds
     (2, 4, 6, 8, 9, 10, 10, 9, 8, 7, 5, 4, 3, 2, 1). Its tick is then uniform within that
     second.
   - Its spawn edge is drawn from per-round edge weights. Each edge gets a seeded weight of 1–3,
     so the heat-strip shows hot edges to plan around.
   - Its destination is uniform over the other edges. ADR-016 guarantees every pair is routable.
   - (tick, edge) is unique: a taken tick probes forward, wrapping over the round.
   - The profile is sorted by (tick, edge).
6. **Heat-strip.** Spawns per edge per second, in `map.edges` order, plus the maximum for
   scaling. It is derived from the profile, so it can't disagree with it.
7. **Seed salts.** The round seed is XORed with a fixed salt for each use:
   - map pick: `0x6d617073` ("maps")
   - demand: `0x64656d64` ("demd")
   - Parade closure: `0x70617264` ("pard")

   The sim uses the round seed unsalted. So no two uses share a PRNG stream, and changing one
   (for example the demand volume) doesn't change the map or the closure.

8. **Market Day** (round 4): +2 trucks in every one of the 15 seconds (30 in all), on top of the
   rush round's demand and mix. Each truck's tick is uniform within its second. Its edge and
   destination are drawn as in item 5.
9. **Parade** (round 8): `closedSegments` holds one segment, picked uniformly with the parade
   salt. The demand is the plain rush demand.
   - **Candidates:** each maximal straight piece of a link between two intersections, so links to
     an edge are excluded. A piece is a candidate only if closing it leaves every edge able to
     reach every other.
   - **Type:** the sim's `SegmentId` (`{ from, to }`, ADR-022). Content re-exports it, and every
     candidate is a run of plain road tiles that `Sim.init` accepts.
   - **Map pool:** Parade rounds pick only from maps with at least one candidate. Tree-shaped
     maps have none. In District 1 those are d1-02, d1-05, d1-09 and d1-10, leaving 24 of 38
     maps. Other rounds pick from all maps.
   - **Sim support:** the sim closes the links of `RoundInput.closedSegments` for the round
     (ADR-022). The run controller must copy `closedSegments` from `setupRound` into the round
     input; until it does, a Parade has no effect in runs.
10. **Festival** (round 12): data only.
    - Volume is ×1.6 on top of the rush ×1.6.
    - The mix gives 5% to emergency vehicles, taken from cars (650 car, 150 bus, 100 truck,
      50 bike, 50 emergency). The 5% is District 3's emergency share (GDD §5).
11. **Other bosses.** Bosses outside District 1 throw "not implemented yet" until their district
    lands.
