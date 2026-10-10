# Phase 1: Validation toy

Status: planned · 2026-10-10 · Lead. Starts when Phase 0's gate holds (CI green on the empty sim
on GitHub, and Idan has `docs/setup/accounts.md`).

**Deliverable (GDD §13):** headless sim + minimal renderer + 20 cards, no meta, 3-minute itch
build; `packages/balance` with `random` and `greedy` bots; GIF + Reddit copy.

**Gate (GDD §13; two of four must pass; Idan decides go/no-go):**

1. 200+ itch plays with median session > 2 min.
2. 5 archetypes with 35–65% win rates in sim.
3. 500 Steam wishlists in 14 days (needs Steamworks in Phase 1, ADR-006).
4. Poki player-fit ≥ 25% at 3 min.

## Scope decisions for Phase 1 (ADR-007)

- **The toy is a 5-round run on District 1** (round 5 is a rush round with Market Day), about
  3 minutes at 1×. The balance runner still plays full 12-round District 1 runs headless, since
  that is what the archetype criterion measures.
- **No shop and no funds sink** (shop is Phase 2). So funds-only cards are out of the 20, and the
  Phase 1 starting deck swaps Grant for Pilot Program. Everything else in the starting deck is as
  written in §4.
- **Archetype bots** (`archetype(tag)`) are built in Phase 1 alongside `random` and `greedy`,
  because gate criterion 2 cannot be measured without them. `mcts-lite` stays in Phase 2.
- **The deterministic run controller** (draw, energy, plays, offers, approval, quotas) lives in
  `packages/app/src/run/`, pure and DOM-free so the balance runner and the game share it. The Sim
  Engineer owns it in Phase 1 (logic and determinism), then it moves to the UI Engineer.
- **Session-length measurement** for gate criterion 1 uses a minimal `/ingest` Worker with only
  the §10 events `app_open`, `run_start`, `round_end`, `run_end`; itch's own stats do not report
  session length. Needs Idan's Cloudflare account (free).
- **Audio** is optional in the toy: off by default, five SFX, must not delay anything.

### The 20 Phase 1 cards (4 per archetype)

| Tag   | Cards (GDD §4 numbers)                                                   |
| ----- | ------------------------------------------------------------------------ |
| FLOW  | Smart Signal (2), One-Way (3), Turn Lane (6), Speed Limit Up (5)         |
| MASS  | Bus Priority (8), Express Stop (9), Bus Lane (10), Fare Holiday (14)     |
| TOLL  | Detour (16), Toll Booth (18), Staggered Hours (19), Delivery Window (20) |
| CHAOS | Roundabout (22), Yield Culture (24), No Heavy (25), Remove Signal (26)   |
| TEMPO | Overtime (30), Second Shift (31), Pilot Program (33), Recount (36)       |

Primitives these need: `setController`, `setSignalPhase` (adaptive), `setLaneCount`,
`setSpeedLimit`, `banType`, `preferType`, `addBusStop` (dwell), `setOneWay`, `reroute`,
`spawnModifier`, `scoreModifier`, `fundsModifier` (Toll Booth still counts funds for the report),
`yieldRule`, `drawModifier`, `energyModifier`.

## Team for Phase 1

| Agent            | Roles held                                         | Why paired                                            |
| ---------------- | -------------------------------------------------- | ----------------------------------------------------- |
| Sim              | Sim Engineer (+ balance, + run controller for now) | Critical path; one owner for determinism              |
| Content          | Content Designer                                   | Data, schema, maps, tuning                            |
| Render/UI        | Render Engineer + UI Engineer                      | Minimal renderer and one run screen; split in Phase 2 |
| Platform/Backend | Platform Engineer + Backend Engineer               | itch/portal builds and the tiny `/ingest`             |
| Audio            | Audio Engineer                                     | Optional toy SFX; starts synth core early             |
| QA/Release       | QA / Release                                       | E2E, GIF tool, all copy and packages                  |
| Reviewer         | Reviewer                                           | Reviews every PR; never builds                        |

## Tasks

Estimates are agent working days (d). Any task past 2× its estimate stops and is re-planned.
Acceptance criteria quote the brief; "§" is the GDD section.

### Lead

| ID         | Task                                                                                                                       | Est     | Depends              | Acceptance criteria                                                                                                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1-LEAD-01 | Worker protocol interface: `RoundInput` in, per-tick `Uint16Array` snapshots out                                           | 0.5     | —                    | "The main thread sends `RoundInput` and receives per-tick `Uint16Array` snapshots (vehicle id, lane, cell, speed, type) via transferable buffers." (§6) Typed messages, doc comments, a Node test with `worker_threads`. |
| P1-LEAD-02 | Nightly workflow (balance + golden) and itch deploy workflow (draft channel via butler, only when `BUTLER_API_KEY` exists) | 0.5     | P1-BAL-02, P1-PLT-01 | "balance sim (nightly)" (§6 CI row). Report committed to `docs/balance/latest.md` by a bot PR.                                                                                                                           |
| P1-LEAD-03 | ADR-007 (Phase 1 scope above); daily standups; merges per ADR-005                                                          | ongoing | —                    | §13 rules 1–8.                                                                                                                                                                                                           |

### Sim Engineer

| ID        | Task                                                                                                                                                        | Est | Depends        | Acceptance criteria                                                                                                                                                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-SIM-01 | World: tiles, lanes (4 cells per tile, 1–2 per direction), intersections (3–4 road neighbours), edges, BFS routes at spawn                                  | 1   | —              | "Grid of 7×9 tiles (portrait)… each lane is 4 cells long per tile." "follow the pre-computed route (BFS shortest path at spawn; taxis recompute on entry using time-weighted costs)." (§3)                                                                             |
| P1-SIM-02 | Vehicles and tick rules 1, 2, 4, 6 for all six types; fixed update order                                                                                    | 1.5 | SIM-01         | "all vehicles update in a fixed deterministic order each tick, sorted by (laneId, cellIndex) descending so downstream moves first." Vehicle table (length, vmax, behaviour, score) exactly as §3.                                                                      |
| P1-SIM-03 | Controllers: uncontrolled, signal (phases, adaptive), roundabout (cap 4), stop-all, priority(dir); turn-reservation cell                                    | 1.5 | SIM-02         | "signals by phase; uncontrolled by 'first at line, then rightmost'; roundabouts by 'inside has priority, max occupancy 4'; priority(dir) by direction." (§3 rule 5)                                                                                                    |
| P1-SIM-04 | Demand spawning, p_slow via PRNG, gridlock detector, throughput scoring                                                                                     | 0.5 | SIM-02         | "if the sum of `v` across all vehicles is 0 for 60 consecutive ticks, the round ends." "`p_slow`… driven by the seeded PRNG only." (§3)                                                                                                                                |
| P1-SIM-05 | Effect primitives for the 20 cards, each with a unit test; stacking and controller-conflict rules                                                           | 1.5 | SIM-03, CON-01 | "Stacking: same card on same target does not stack; different cards do. Conflicting controllers: the last played wins and the earlier card is refunded." "a unit test of each primitive used" (§4)                                                                     |
| P1-SIM-06 | Snapshots, property tests, golden regen, perf bench                                                                                                         | 1   | SIM-04         | fast-check: "no two vehicles share a cell, vehicles never move backward, throughput ≤ spawned, hash stable under re-run" (§11). "at least 2,000 full 300-tick rounds per second… single core, with up to 150 vehicles" (§3). Coverage ≥ 90%.                           |
| P1-BAL-01 | Run controller in `packages/app/src/run/`: hand 5, energy 3, max 2 plays, unplayed return, offers (rarity 60/30/10, pity after round 3), approval 3, quotas | 1   | SIM-04, CON-04 | §2 core loop steps 1–4 and §4 draft rules; "quota = base[d] * (1 + 0.11*(r-1)) * rushMult" computed in integers (per-mille). Pure and seeded.                                                                                                                          |
| P1-BAL-02 | Balance runner + bots `random`, `greedy-throughput`, `archetype(tag)`; parallel workers; report generator                                                   | 1.5 | BAL-01         | Report per §11: "win rate per district and mayor per bot; drafted win-rate delta per card…; pick-rate when offered; archetype purity vs win rate; round-of-death histogram; gridlock frequency; median run length; the top 20 decks." Writes `docs/balance/latest.md`. |

### Content Designer

| ID        | Task                                                                      | Est          | Depends | Acceptance criteria                                                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------- | ------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-CON-01 | Card JSON schema, loader, validator, text generated from effects          | 1            | —       | Card anatomy fields per §4; "Card text is generated from the effect data by a template, never hand-written." Flavor ≤ 60 chars. Schema validation in CI.                                                                            |
| P1-CON-02 | The 20 cards with tier-2 `upgrade` data                                   | 0.5          | CON-01  | Effects and upgrades match §4 list items exactly; deviations need an ADR.                                                                                                                                                           |
| P1-CON-03 | District 1: 12 map templates with mirrored and rotated variants           | 1            | SIM-01  | "District 1 maps have 4–6 intersections" (§3); "1 lane each way, 2 bus stops" (§5). Every map connected; every edge reachable.                                                                                                      |
| P1-CON-04 | D1 demand generator and heat-strip data; quotas; Market Day boss          | 0.5          | SIM-01  | Mix "70% car, 15% bus, 10% truck, 5% bike"; "Market Day (+2 truck spawns/s)"; base quota 26 (§2, §5).                                                                                                                               |
| P1-CON-05 | Toy starting deck and 5-round script; tune quotas from the balance report | 0.5 + tuning | BAL-02  | Targets: "median unupgraded starting deck fails at round 6–7 of District 1 and the median well-drafted deck wins District 1 at a 55–65% rate" (§2), using greedy as the proxy until mcts-lite exists. Every PR attaches the report. |

### Render + UI Engineer

| ID        | Task                                                                                                                | Est | Depends                               | Acceptance criteria                                                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-REN-01 | Pixi 8 scene: roads, intersections with controller glyphs, vehicles by type; sim in a Web Worker; interpolation     | 2   | LEAD-01 (stub snapshots until SIM-06) | §7 shape rules ("signal = three dots, roundabout = ring, stop = octagon, priority = chevron"; vehicles by length and stripe; "readable at 12 px"). "The renderer interpolates between the last two snapshots… it never predicts." |
| P1-REN-02 | Readability: queue pulse, 1–3 cell trails, gridlock red + 4 px shake for 300 ms, demand heat-strips; reduced motion | 1   | REN-01, CON-04                        | §7 motion feedback; §8 reduced-motion mode; "Any visual effect that makes the traffic state harder to read on a 6-inch screen is cut."                                                                                            |
| P1-UI-01  | Run screen, Go phase, round result with 3-card offer, run end with text share line                                  | 2   | CON-01, BAL-01                        | §8 screens 3, 4, 5, 7 (minimal). Ghost preview, tap-to-undo before Go, hold for 2×, pause. Touch, mouse, keyboard (1–5, arrows, Enter, Space, Esc). 44 px targets, 14 px text. Portrait 390×844.                                  |
| P1-UI-02  | Card frame and glyph v0 generated from primitives                                                                   | 0.5 | CON-01                                | "48×48 generated from the card's primitives (controller glyph + target shape + tag color)" (§7).                                                                                                                                  |

### Platform + Backend Engineer

| ID        | Task                                                         | Est | Depends            | Acceptance criteria                                                                                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------ | --- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-PLT-01 | itch build profile and zip artifact                          | 0.5 | UI-01              | "HTML5 upload zipped; embed size 390×844 and fullscreen button" (§9). Under the 7.5 MB budget. Works in an iframe.                                                                                                                                                                                                    |
| P1-PLT-02 | Poki and CrazyGames `PortalAdapter`s and submission packages | 1   | PLT-01             | §9 portal SDK requirements: `gameplayStart/Stop` around every round, `commercialBreak` before and after a run, `happytime` on win, sound after gesture, no external links beyond approved ones. Packages include build zip, 512×512 thumbnail, 16:9 cover, description, tags, controls text (§12).                    |
| P1-BE-02  | Privacy policy draft for the toy in `docs/legal/privacy.md`  | 0.5 | —                  | "plain language, listing exactly the data above" (§10). Idan publishes it; `/ingest` stays off in public builds until then.                                                                                                                                                                                           |
| P1-BE-01  | Minimal `/ingest` Worker + session-length query              | 1   | Cloudflare account | Events limited to `app_open`, `run_start`, `round_end`, `run_end` (§10 list); per-install random UUID; "no PII" (read as no directly identifying data; the install ID is pseudonymous personal data, `docs/legal/privacy.md`); IP addresses are never stored; median session length per surface for gate criterion 1. |

### Audio Engineer (optional for the toy)

| ID        | Task                                                                                     | Est | Depends | Acceptance criteria                                                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------- | --- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-AUD-01 | zzfx-class synth core and 5 SFX: card place, Go, vehicle exit, gridlock, quota pass/fail | 1   | —       | "SFX are parameter sets for an in-repo zzfx-class synthesizer"; "2–3 seeded variants"; starts only after a user gesture; mute toggle. No audio files. |

### QA / Release

| ID       | Task                                                                                                                                 | Est | Depends | Acceptance criteria                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ | --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-QA-01 | Phase 1 test plan and e2e of the toy flow on phone and desktop viewports                                                             | 1   | UI-01   | Toy subset of the §11 E2E row; runs on every PR.                                                                                                                           |
| P1-QA-02 | Clip tool: record a seeded rush round to a 9:16 GIF and MP4 from the replay                                                          | 1   | REN-02  | "The 15-second resolution phase must be fun to watch with no input and must clip well for a 9:16 video" (§2). Deterministic output from a seed.                            |
| P1-QA-03 | Copy and assets: Reddit posts for the four subs, itch page, Steam "Coming soon" page copy and capsules, Poki/CrazyGames descriptions | 1   | QA-02   | §12: "Every description leads with the mechanic in one sentence and shows the share strip." Steam capsule sizes per §12 table, generated in code. Idan posts; we never do. |
| P1-QA-04 | Phase 1 gate one-pager: go/no-go against the four criteria                                                                           | 0.5 | all     | One page in `docs/release/phase-1-gate.md` with the evidence for each criterion.                                                                                           |

### Reviewer

| ID        | Task                                                       | Est     | Depends       | Acceptance criteria                                                                                                 |
| --------- | ---------------------------------------------------------- | ------- | ------------- | ------------------------------------------------------------------------------------------------------------------- |
| P1-REV-01 | Review every PR against the brief (ADR-005)                | ongoing | —             | §13 rule 4. Verdict comment on each PR.                                                                             |
| P1-REV-02 | Adversarial playtest of the toy with the bots; feel report | 0.5     | UI-01, BAL-02 | Checks pillars 1, 2 and 5 (§2): can you name the card that caused a jam, one decision per 10 s, watchable Go phase. |

## Critical path

SIM-01 → SIM-02 → SIM-03 → SIM-05 → BAL-01 → BAL-02 → CON-05 tuning → gate report.
Render/UI, Platform and QA work in parallel against stub snapshots and the schema. Expected
duration: 7–9 working days of wall-clock time with the seven agents above. Task count: 31.
