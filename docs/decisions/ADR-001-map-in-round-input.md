# ADR-001: The sim receives a resolved map in RoundInput

Status: Accepted · 2026-10-10 · Lead

The brief defines `RoundInput = { seed, mapId, demandProfile, placements, cardState, districtRules }`
and requires `simulate` to be pure and `packages/sim` to have no content dependency. A `mapId`
alone cannot be simulated without loading data. `RoundInput` therefore also carries `map: GridMap`,
resolved by `packages/content`; `mapId` stays and must equal `map.id`. Likewise each `Placement`
carries its resolved `effects`, so the sim never reads card JSON. Hashing the input covers both,
so the leaderboard verifier re-simulates exactly what the client ran.
