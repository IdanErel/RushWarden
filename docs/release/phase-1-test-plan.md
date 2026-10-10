# Phase 1 test plan: the Rushwarden validation toy

Status: draft for review · 2026-10-10 · QA / Release · task P1-QA-01 (plan part)

This plan covers what QA tests in Phase 1 and how the Phase 1 gate is measured. It covers three
things:

1. The end-to-end (e2e) flow of the toy and the Playwright specs that cover it.
2. The device and browser matrix for Phase 1.
3. How each of the four gate criteria is measured.

The specs themselves land in a second P1-QA-01 PR once P1-UI-01 gives us a playable run screen.

Sources: GDD §2 (core loop), §8 (screens, input), §9 (portal rules), §11 (test layers, device
matrix, bug policy), §13 (Phase 1 gate); ADR-006 (Steam gate, accepted); ADR-007 (Phase 1 scope); ADR-008 (name); ADR-009 (event time
is the server's receipt time, in PR #8); [ADR-010](../decisions/ADR-010-phase1-gate-measurement.md) (gate measurement
definitions, proposed in this PR).

## 1. What the toy is, and what it is not

The toy is what ADR-007 and `docs/tasks/phase-1.md` define. QA tests only this:

| In the toy                                                                                                                           | Not in the toy (do not test, do not claim)                                            |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| One 5-round run on District 1 (Old Town); round 5 is a rush round with Market Day                                                    | Rounds 6–12, Districts 2–3, endless                                                   |
| 20 cards, 4 per tag (FLOW, MASS, TOLL, CHAOS, TEMPO); starting deck per §4 with Pilot Program for Grant                              | The other 20 cards, upgrades (tier-2 data exists but no shop to buy them)             |
| Draw 5, energy 3, max 2 plays, ghost preview, tap to undo before Go, Go phase of 15 s with hold-for-2× and pause                     | Shop, funds spending, card removal                                                    |
| Round result: pass/fail, 3-card offer or skip, approval 3 → 0 ends the run                                                           | Mayor choice (default mayor only), meta-progression, codex, run history               |
| Run end with a text share line                                                                                                       | Share PNG, share video, daily seed, leaderboard                                       |
| Touch, mouse, keyboard (1–5, arrows, Enter, Space, Esc); portrait 390×844                                                            | Gamepad, Steam Deck layout, tutorial (§8 onboarding is Phase 2)                       |
| itch HTML5 zip; Poki and CrazyGames adapters (`gameplayStart/Stop`, `commercialBreak`, `happyTime`)                                  | Purchases, unlock screen, restore, entitlement, any store build (iOS, Android, Steam) |
| Optional: 5 SFX, off by default, start only after a gesture                                                                          | Music                                                                                 |
| Optional: `/ingest` with only `app_open`, `run_start`, `round_end`, `run_end`, off in public builds until the privacy policy is live | Any other analytics event                                                             |

The §11 e2e row ("Title → tutorial → run → unlock screen → purchase → restore → daily → share")
shrinks to **boot → run → round result → run end → share text** for Phase 1. The other steps come
into the e2e in the phase that builds them.

## 2. Toy e2e flow

### 2.1 What the specs need from the build (requests, not decisions)

The run screen is a Pixi canvas, so Playwright cannot read cards or vehicles from the DOM. The
specs need these hooks. They live in packages owned by Render/UI and Platform, so the Lead decides
how they are provided. QA proposes:

- **H1. Seed in the URL.** `?seed=<u32>` fixes the run seed in dev and e2e builds, so a spec can
  pick a run that passes, one that fails, and one that gridlocks. Public builds ignore it.
- **H2. Test state on a DOM node**, in the same style as the existing `#app[data-hash]` in
  `packages/platform-web`: `data-phase` (`place` | `go` | `result` | `end`), `data-round`,
  `data-approval`, `data-energy`, `data-hand` (card ids), `data-throughput`, `data-quota`,
  `data-speed` (`1` | `2`), `data-paused`, `data-round-hash` (the sim's 64-bit final-state hash
  for the round, as hex).
- **H3. Accessible names on the DOM controls** (Go, pause, offer cards, skip, share, retry). §8
  requires screen-reader labels anyway. Specs select by role and name, never by CSS class.
- **H4. A spy `PortalAdapter`** in e2e builds that records calls in order on `window`, so a spec
  can check the §9 call pattern without the real Poki or CrazyGames SDK.
- **H5. Canvas targets by keyboard.** Specs place cards with the §8 keyboard path (1–5, arrows,
  Enter), because canvas pixel coordinates are fragile. One phone spec also taps the canvas at a
  target position that H2 exposes (`data-target-rects`), to cover touch.

If a hook is refused, the matching spec becomes a manual check in §3.3, and this plan is updated.

### 2.2 Specs

All specs run on every PR in the `web` CI job (§11: "E2E … Every PR"), on the `phone` and
`desktop` Playwright projects unless the row says otherwise. Planned location:
`packages/platform-web/e2e/toy/` (the Playwright config already lives in that package).

| ID     | Flow                                   | Steps                                                                                                           | Pass when                                                                                                                                                            |
| ------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E2E-01 | Boot to the run screen                 | Open `/?seed=S1`.                                                                                               | `data-phase=place`, round 1, approval 3, energy 3, 5 cards in hand, demand heat-strips drawn; no console errors; no failed requests.                                 |
| E2E-02 | Place, preview, undo                   | Select card 1 (key `1`); move the cursor to a valid target; check the ghost; Enter; then Esc.                   | Energy drops by the card's cost on place and is restored on undo; hand returns to 5; a third play is refused after two (max 2 plays).                                |
| E2E-03 | Touch path (phone only)                | Tap a card, tap a target from `data-target-rects`, tap it again to undo, tap Go.                                | Same state changes as E2E-02; every control is at least 44 px (§7).                                                                                                  |
| E2E-04 | Go phase, 2× and pause                 | Space (Go). Hold for 2× for 3 s, release, pause, check the round does not advance, resume.                      | `data-speed` follows the hold; paused time does not advance; the round ends at 300 ticks or on gridlock.                                                             |
| E2E-05 | Speed does not change the result       | Play the same seed and placements twice, once at 1× and once with 2× held throughout.                           | Both runs give the same `data-round-hash` and throughput ("identical results", §3 timing).                                                                           |
| E2E-06 | Rendered sim equals headless sim       | For seeds S1–S3, read each round's inputs and `data-round-hash`; run `Sim.simulate` in Node on the same inputs. | Hashes are equal (§1: zero desync between the headless and rendered sim). This is the toy-sized version of the 10,000-run desync check.                              |
| E2E-07 | Pass → offer → pick                    | Seed S1, a known passing first round. Pick offer card 2.                                                        | 3 cards offered with no duplicate of a `run`-duration card already in the deck; deck size +1; round 2 starts.                                                        |
| E2E-08 | Pass → skip                            | Same seed, choose Skip.                                                                                         | Deck unchanged; round 2 starts. (Skip's "+2 funds" has no use in the toy; the spec checks only that skip works.)                                                     |
| E2E-09 | Fail costs approval; zero ends the run | Seed S2, play no cards each round.                                                                              | Each failed round drops approval by 1; at 0 the run-end screen shows immediately with the rounds reached.                                                            |
| E2E-10 | Gridlock                               | Seed S3, a known gridlock round.                                                                                | The round ends early (no movement for 60 ticks, §3) with the current throughput, and that round's glyph is black in the share line.                                  |
| E2E-11 | Full run to the end and share          | Seed S1 with a scripted play; play all 5 rounds including the Market Day rush round.                            | Run-end screen shows result and rounds; the share line matches the agreed format (§5, ending in "N through" plus the link); clipboard fallback copies the same text. |
| E2E-12 | Retry                                  | From run end, press Retry.                                                                                      | A new run starts at round 1 with approval 3 and the starting deck, with no reload and no console errors.                                                             |
| E2E-13 | Portal call pattern (H4)               | Run E2E-11 with the spy adapter for `poki` and for `crazygames`.                                                | `commercialBreak` before run start and after run end; `gameplayStart`/`gameplayStop` around every round; `happyTime` only on a win (§9).                             |
| E2E-14 | Sound only after a gesture             | Load with audio enabled; check the `AudioContext` state before and after the first tap.                         | No audio before the first user gesture (Poki rule, §9). Skipped while audio is not built.                                                                            |
| E2E-15 | No network unless `/ingest` is on      | Record every request during E2E-11 on the itch build (portal builds also load their SDK).                       | With ingest off (the default), only same-origin static files are requested. With ingest on, only the four ADR-007 events, no other fields than §10 lists.            |
| E2E-16 | Embedded in an iframe at 390×844       | Load the itch build inside a test page with a 390×844 iframe; press fullscreen.                                 | Whole run screen visible with no scroll; fullscreen enters and exits; input works inside the frame (§9 itch and Poki).                                               |
| E2E-17 | Reduced motion                         | Emulate `prefers-reduced-motion: reduce` (or the in-game setting if it exists) and play a gridlock round.       | No camera shake and no trails (§8). Checked through an H2 attribute or a screenshot diff.                                                                            |
| E2E-18 | Landscape desktop                      | Desktop project at 1280×720 and 1920×1080.                                                                      | Run screen fits with the HUD rearranged to the right (§8); no clipped controls.                                                                                      |

The seeds S1–S3 are chosen by QA once the run controller (P1-BAL-01) exists, using the headless
runner to find seeds with the needed outcome. They are written into the spec with a comment that
says how they were found. If the content or sim changes and a seed no longer gives its outcome,
the spec fails with a message that names the seed. That is a signal to pick a new seed, not to
change the expected outcome.

### 2.3 Other automated checks QA relies on in Phase 1

These already exist or are owned elsewhere. QA checks they are green on the build that goes to
itch:

| Check                                             | Owner / where                                                | Phase 1 bar                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Unit and property tests                           | Sim, Content; `pnpm test`                                    | Green; `packages/sim` ≥ 90% lines                                                   |
| Golden hashes, Node + Chromium + WebKit + Firefox | Sim; `pnpm golden`, ADR-003                                  | Green on every PR                                                                   |
| Web download size                                 | Lead; `pnpm size`, ADR-004                                   | Initial ≤ 7.5 MB gzipped (also under Poki's 8 MB)                                   |
| Headless sim speed                                | Sim; P1-SIM-06 bench                                         | ≥ 2,000 rounds/s/core, reported in the PR                                           |
| Frame time                                        | QA; Playwright trace, 4× CPU throttle on the desktop project | Reported in the itch release notes; not a Phase 1 gate (the 60 fps gate is Phase 2) |
| Soak                                              | QA; headless runner                                          | 500 full toy runs (5 rounds) without an exception before each itch upload           |

### 2.4 Proposed CI changes (Lead owns CI)

- Add a Playwright project at exactly **390×844** (the §2 design size). The current `phone`
  project uses Pixel 5 (393×851), which is close but not the spec size.
- Add a **WebKit phone** project (iPhone 12 profile, 390×844) to the `web` job, so Safari-family
  layout and input are covered on every PR, not only by Idan's phone.

These change `packages/platform-web/playwright.config.ts` and `.github/workflows/ci.yml`. QA will
propose them in the specs PR for the Lead to approve.

## 3. Device and browser matrix (Phase 1)

Phase 1 ships one artifact: the web build, on itch.io and in the Poki and CrazyGames test
iframes. There are no store builds, so the §11 matrix is cut to what that build can run on.
Idan runs the real-device rows (§11: "Idan tests on real hardware; everything else on
emulators").

### 3.1 Automated (CI, every PR)

| Engine   | Viewport                         | Projects                                 |
| -------- | -------------------------------- | ---------------------------------------- |
| Chromium | Pixel 5 phone (390×844 proposed) | `phone`, all specs                       |
| Chromium | Desktop 1280×720 and 1920×1080   | `desktop`, all specs except E2E-03       |
| WebKit   | iPhone 12, 390×844 (proposed)    | `phone-webkit`, E2E-01 to E2E-12         |
| Firefox  | n/a                              | Golden hashes only (already on every PR) |

### 3.2 Real devices (Idan, before the itch build goes public and again before the Poki/CrazyGames submission)

| Priority | Device                                                         | Browser         | Surface to open                               |
| -------- | -------------------------------------------------------------- | --------------- | --------------------------------------------- |
| Must     | Mid-range Android from 2020–2021 (Pixel 4a / Galaxy A52 class) | Chrome          | itch page (embed), then fullscreen            |
| Must     | iPhone 11 or newer                                             | Safari          | itch page (embed), then fullscreen            |
| Must     | Windows 11 or macOS desktop                                    | Chrome          | itch page; Poki inspector; CrazyGames QA tool |
| Should   | macOS desktop                                                  | Safari          | itch page                                     |
| Should   | Any desktop                                                    | Firefox, Edge   | itch page                                     |
| Could    | iPad or Android tablet                                         | Safari / Chrome | itch page, portrait and landscape             |

Steam Deck, Ubuntu desktop builds, and the Electron and Capacitor shells are not in Phase 1.
Ubuntu is covered by CI (Chromium, Firefox and WebKit on Linux).

### 3.3 Real-device checklist (about 10 minutes per device)

QA writes the results into `docs/release/phase-1-devices.md`, one row per device, from what Idan
reports. Each item is pass, fail (with a bug), or n/a.

1. Page loads; time from tap to the first playable hand, measured with a stopwatch (budget: 3 s
   on phones, 1.5 s desktop, §6; reported, not gated in Phase 1).
2. One full run of 5 rounds with touch (phones) or mouse (desktop), plus keyboard on desktop.
3. Ghost preview is visible, and undo works before Go.
4. Hold for 2× and pause work. The traffic state stays readable at 2× on a 6-inch screen
   (pillar 1; §1 constraint 9).
5. Gridlock is obvious: red queue and shake, or no shake with reduced motion on.
6. Share line copies and pastes correctly into a chat app; the emoji strip renders.
7. Fullscreen enters and exits; rotating the phone does not lose the run.
8. Sending the tab to the background and back does not lose the run, and sound (if on) stops in
   the background.
9. Nothing is cut off by the notch, the home bar or the browser's toolbars.
10. Free text: anything that felt confusing, slow, or broken.

### 3.4 Portal harnesses

- **Poki:** before Idan submits, Idan opens the build in Poki's developer inspector, and QA
  checks the result against §9: SDK events fire, sound starts only after a gesture, there are no
  external links, the initial load is under 8 MB, and it works in an iframe.
- **CrazyGames:** the same check in the CrazyGames developer portal's QA tool:
  `sdkGameLoadingStart/Stop`, `gameplayStart/Stop`, and `happytime` on a win. IAP is not in the
  toy.

## 4. Measuring the Phase 1 gate

GDD §13: two of the four criteria must pass; **Idan decides go/no-go.** QA collects the evidence
into `docs/release/phase-1-gate.md` (task P1-QA-04) with a source for every number. QA never
reads a store, portal or analytics console itself: the Steam, itch, Poki and CrazyGames numbers
come from Idan as an export or screenshot, committed under `docs/release/evidence/phase-1/`.

The exact definitions below are proposed in ADR-010 for Idan to confirm. Where the brief leaves a
choice open, the ADR gives a default.

### 4.1 Criterion 1: 200+ itch plays with median session > 2 min

| Item        | Definition                                                                                                                                                                                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plays       | **Primary:** the play count on itch's analytics page for the project, as Idan exports it. **Cross-check:** the number of sessions (below) with `platform=itch`. If the two differ by more than 25%, the gate page reports both and says why.                                                                                                                              |
| Session     | Events from one install UUID with `platform=itch`, starting at `app_open` and ending at the last event before a gap of more than 30 minutes. Duration = server receive time of the last event minus server receive time of `app_open`. A session with only `app_open` counts, with duration 0 (players who bounce must pull the median down).                             |
| Median      | Median of all session durations in the window. Pass: strictly greater than 120 s, with at least 200 plays.                                                                                                                                                                                                                                                                |
| Window      | 14 days from Idan's first public post of the itch link (same length as criterion 3). Builds on the draft channel and local builds report `platform=web`, so team and QA play does not count.                                                                                                                                                                              |
| Data source | The minimal `/ingest` Worker and session-length query from P1-BE-01. Each event is sent when it happens and timed by the server's receipt time (ADR-009, no batching in the toy). QA checks that `round_end` really is sent per round, so a player who quits mid-run is not counted as a 0-second session.                                                                |
| Blocker     | ADR-007 as amended: Idan approved collecting the four events, but only once the privacy policy is published on the website. **Until then criterion 1 cannot be measured** (itch does not report session length). If the itch link is posted before the policy is live, the gate page marks criterion 1 "not measured", not "fail", and the gate rests on the other three. |

### 4.2 Criterion 2: 5 archetypes with 35–65% win rates in sim

| Item          | Definition                                                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bots          | `archetype(FLOW)`, `archetype(MASS)`, `archetype(TOLL)`, `archetype(CHAOS)`, `archetype(TEMPO)` from P1-BAL-02.                                                                                                                                                     |
| Run           | Full 12-round District 1 runs (ADR-007 item 1), the 20 Phase 1 cards, the Phase 1 starting deck, at the commit of the itch build. 10,000 seeded runs per bot (§11 nightly size). At that size the 95% interval on a win rate is about ±1 point.                     |
| Pass          | Every one of the five bots has a win rate between 35% and 65%, inclusive. Four out of five is a fail; the gate page names the missing archetype.                                                                                                                    |
| Also reported | Each bot's archetype purity (the share of its drafted cards that carry its tag) next to its win rate. A bot that wins with a mixed deck is not evidence that the archetype works, so QA flags purity under 50% for the Reviewer. This does not change pass or fail. |
| Verification  | §14 requires verification by an agent that did not build it. QA re-runs the runner at the same commit and seeds and checks that the report is byte-identical to `docs/balance/latest.md`. The Reviewer signs that check.                                            |
| Caveat        | The toy players see is 5 rounds; the sim criterion uses 12-round runs. The gate page says this plainly, so a pass on criterion 2 is not read as "the toy is balanced".                                                                                              |

### 4.3 Criterion 3: 500 Steam wishlists in 14 days

| Item       | Definition                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Depends on | ADR-006 (accepted: the criterion stays). Idan opens Steamworks, pays the app fee and submits the page for Valve's review during Phase 1; the team supplies the copy (P1-QA-03). |
| Window     | 14 days from the moment the "Coming soon" page is publicly visible, not from submission for review.                                                                             |
| Number     | **Net wishlists** at the end of day 14 (additions minus deletions) from Steamworks' wishlist report. Gross additions are reported next to it. Pass: net ≥ 500.                  |
| Evidence   | Idan exports the wishlist report (CSV or screenshot) on day 15; QA commits it under `docs/release/evidence/phase-1/`.                                                           |
| Note       | Activations from Steam key giveaways do not exist in Phase 1 (there is no build on Steam), so no adjustment is needed.                                                          |

### 4.4 Criterion 4: Poki player-fit ≥ 25% at 3 min

| Item                 | Definition                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source               | Poki's player-fit test report, as Poki sends it to Idan after submission. QA does not reproduce Poki's measurement.                                                                                                                                                                                                                                                                  |
| Number               | The share of players still playing at the 3-minute mark. Pass: ≥ 25%. If Poki's report does not give that exact figure, QA copies the figures it does give, says which one is closest, and Idan decides whether it counts. QA does not convert or estimate.                                                                                                                          |
| Risk                 | The toy run is about 3 minutes long (ADR-007). A player who finishes one run at 2:50 and leaves counts as gone at 3:00. So the run-end screen must make "play again" the most obvious action (E2E-12, one tap, no reload), and the Reviewer's feel report (P1-REV-02) should time a real run. QA will file this as a P1 if a typical first run ends before 3:00 with no clear retry. |
| Optional cross-check | If `/ingest` is allowed on Poki builds, the share of `platform=poki` sessions over 180 s, labeled as our number, not Poki's.                                                                                                                                                                                                                                                         |

### 4.5 Gate page

`docs/release/phase-1-gate.md` (P1-QA-04) has one row per criterion: the number, the pass bar,
pass / fail / not measured, the evidence link, and the date read. It ends with "2 of 4
needed; Idan decides go/no-go." QA does not recommend go or no-go. If a criterion fails, the page
shows the data next to the bar so Idan can see how close it was.

## 5. Bugs and the release bar for the itch build

- Bugs are GitHub issues labeled `bug` and `P0` / `P1` / `P2` per §11. In the toy, a P0 is a
  crash, a desync (E2E-06), or a stuck run. A P1 is a wrong rule, an unreadable state, or a stuck
  UI.
- The itch build can go public (Idan's action) when:
  1. CI is green.
  2. E2E-01 to E2E-13 and E2E-15 to E2E-16 pass.
  3. The 500-run soak is clean.
  4. The three "Must" devices in §3.2 pass the checklist.
  5. There are no open P0 or P1 bugs.
  6. If `/ingest` is on, the privacy policy is live.

  QA records this in `docs/release/phase-1-devices.md` and links it from the gate page.

- Every fixed bug gets a regression test (§11). A bug Idan finds that a spec could have caught
  gets a spec and a line in the retro.

## 6. Open items

| Item                                                       | Who decides                       | Blocks                      |
| ---------------------------------------------------------- | --------------------------------- | --------------------------- |
| Test hooks H1–H5                                           | Lead, with Render/UI and Platform | Most of the specs in §2.2   |
| 390×844 and WebKit phone projects in CI                    | Lead                              | §3.1 rows marked "proposed" |
| Measurement definitions (windows, sessions, net wishlists) | Idan (ADR-010)                    | The gate page               |
| Privacy policy published (enables `/ingest`)               | Idan (ADR-007)                    | Criterion 1                 |
