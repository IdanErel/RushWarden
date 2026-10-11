# Phase 1 test plan: the Rushwarden validation toy

Status: draft for review · 2026-10-10 · QA / Release · task P1-QA-01 (plan part)

This plan covers what QA tests in Phase 1 and how the Phase 1 gate is measured. It covers three
things:

1. The end-to-end (e2e) flow of the toy and the Playwright specs that cover it.
2. The device and browser matrix for Phase 1.
3. How each of the four gate criteria is measured.

The specs are in `packages/platform-web/e2e/toy/` (the second P1-QA-01 PR). Since P1-WEB-01 (#50)
mounts the run screen in the platform-web build, they run against it with no gate: a run screen
that fails to mount fails every spec. The only fixmes left name their own reason (E2E-14,
E2E-18).

Sources: GDD §2 (core loop), §8 (screens, input), §9 (portal rules), §11 (test layers, device
matrix, bug policy), §13 (Phase 1 gate); ADR-006 (Steam gate, accepted); ADR-007 (Phase 1 scope); ADR-008 (name); ADR-009 (event time
is the server's receipt time, in PR #8); [ADR-010](../decisions/ADR-010-phase1-gate-measurement.md) (gate measurement
definitions, accepted by the Lead; Idan can override them at the gate review).

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

### 2.1 What the specs need from the build (approved by the Lead)

The run screen is a Pixi canvas, so Playwright cannot read cards or vehicles from the DOM. The
specs need these hooks. The Lead approved H1–H5 and routes them to their owners. QA writes the
specs against them; the owners build them:

- **H1. Seed in the URL** (Platform, `packages/platform-web`). `?seed=<u32>` fixes the run seed in dev and e2e builds, so a spec can
  pick a run that passes, one that fails, and one that gridlocks. Public builds ignore it.
- **H2. Test state on a DOM node** (Render/UI, `packages/ui`), in the same style as the existing `#app[data-hash]` in
  `packages/platform-web`: `data-phase` (`place` | `go` | `result` | `end`), `data-round`,
  `data-approval`, `data-energy`, `data-hand` (card ids), `data-throughput`, `data-quota`,
  `data-speed` (`1` | `2`), `data-paused`, `data-round-hash` (the sim's 64-bit final-state hash
  for the round, as hex).
- **H3. Accessible names on the DOM controls** (Render/UI, `packages/ui`) (Go, pause, offer cards, skip, share, retry). §8
  requires screen-reader labels anyway. Specs select by role and name, never by CSS class.
- **H4. A spy `PortalAdapter`** (Platform, `packages/platform-web`) in e2e builds that records calls in order on `window`, so a spec
  can check the §9 call pattern without the real Poki or CrazyGames SDK.
- **H5. Canvas targets by keyboard** (Render/UI: the §8 keyboard path from P1-UI-01, plus
  `data-target-rects` on the H2 node). Specs place cards with the §8 keyboard path (1–5, arrows,
  Enter), because canvas pixel coordinates are fragile. One phone spec also taps the canvas at a
  target position that H2 exposes (`data-target-rects`), to cover touch.

Until a hook ships, the matching spec is marked `test.fixme` with the hook ID, and the check is
done by hand from the §3.3 list.

### 2.2 Specs

All specs run on every PR (§11: "E2E … Every PR"), on the `phone` and `desktop` Playwright
projects unless the row says otherwise, in `packages/platform-web/e2e/toy/`. Per
[ADR-029](../decisions/ADR-029-toy-e2e-ci-and-store-assets.md):

- The specs that play whole rounds or runs are tagged `@full` (E2E-06, 09, 10, 11/12/15, 13). They
  run in the `toy-e2e` CI job on `phone` only.
- The rest run in the `web` job.
- `phone-webkit` runs the whole suite nightly.

E2E-04 compares paused frames with reduced motion on, because the §7 queue pulse keeps animating
while paused. E2E-18 is fixme until render-ui's landscape fix lands (ADR-029).

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
| E2E-17 | Reduced motion                         | Emulate `prefers-reduced-motion: reduce` (or the in-game setting if it exists), reload, and press Go.           | H2 `data-reduced-motion` is `true` with the setting and `false` without it. No shake and no trails in that mode is render's unit test (`effects`, §8).               |
| E2E-18 | Landscape desktop                      | Desktop project at 1280×720 and 1920×1080.                                                                      | Run screen fits with the HUD rearranged to the right (§8); no clipped controls.                                                                                      |

The seeds S1–S3 are not hard-coded. A headless seed finder (`e2e/toy/headless.ts`) replays the
toy run in Node with the same wiring the game uses, `toyRunConfig({ seed, cards: loadCards(),
startingDeck: startingDeck() })` with content's `setupRound`, playing no cards. It scans seeds
1–600 once per Playwright worker and takes the lowest seed for each outcome:

| Seed | Outcome (no cards played)                | Used by                                            | At the time of writing  |
| ---- | ---------------------------------------- | -------------------------------------------------- | ----------------------- |
| S1   | Round 1 passes                           | E2E-01 to E2E-08, E2E-11 to E2E-13, E2E-16, E2E-18 | 1 (five passes, win)    |
| S2   | A round fails on quota, without gridlock | E2E-06, E2E-09                                     | 416 (round 5 fails)     |
| S3   | A round gridlocks                        | E2E-06, E2E-10                                     | 246 (round 5 gridlocks) |

The scan stops once S1–S3 are found (about 25 s on a dev container). A seed whose no-card run
ends on approval is used by E2E-09 if the scan meets one; with the current content none does, so
"zero approval ends the run" is covered by the run controller's unit tests until content tuning
(P1-CON-05) makes one. Content tuning changes which seed does what, which is why the seeds are
found when the specs run. If no seed in range gives S1, S2 or S3, the specs that need it fail with
a message that names the outcome. That is a signal to widen the range or script a play, not to
change the expected outcome.

The same headless runs give E2E-06 its reference hashes, so a wiring difference between the game
and `toyRunConfig` fails E2E-06 on the first round.

**Running the specs on another page.** `TOY_E2E_URL` points the specs at another page with the
hooks, such as the run screen's dev page in `packages/ui` (#31), with `TOY_E2E_TARGET=ui-dev`. That
page has stand-in cards and fake traffic, so E2E-06, E2E-09, E2E-10 and E2E-13 (real content or
the H4 spy) skip there and say why.

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
| Soak                                              | QA; `tools/soak`, in the itch deploy workflow                | 500 headless toy runs (5 rounds) without an exception before each itch upload       |

### 2.4 CI changes (approved by the Lead)

- Add a Playwright project at exactly **390×844** (the §2 design size). The current `phone`
  project uses Pixel 5 (393×851), which is close but not the spec size.
- Add a **WebKit phone** project (iPhone 12 profile, 390×844) to the `web` job, so Safari-family
  layout and input are covered on every PR, not only by Idan's phone.

Both projects are in `packages/platform-web/playwright.config.ts` (the specs PR). Notes:

- Both phone projects render at device pixel ratio 1. Headless browsers draw WebGL in software:
  at the Pixel 5's ratio of 2.75 the run screen measured 2 fps and a 15 s round took 31 s of wall
  time, against 17 fps and 16.8 s at ratio 1. Layout depends on CSS pixels, so 390×844 is still
  tested exactly; sharpness on real screens is item 9 of the §3.3 device checklist.
- The per-PR jobs install only Chromium, so the config leaves `phone-webkit` out wherever WebKit
  is not installed, and prints a warning. The Nightly `toy-webkit` job installs WebKit and sets
  `PW_WEBKIT=1`, so there a missing browser fails instead of being skipped (ADR-029).
- **Local runs:** with `reuseExistingServer`, Playwright reuses whatever already serves the
  preview ports. On a machine with several checkouts, set `WEB_E2E_PORT` (public build on it,
  hooks build on it + 1) and `CI=1`, which turns `reuseExistingServer` off, so the run tests
  this checkout's build (a port already in use then fails loudly instead of being reused).

## 3. Device and browser matrix (Phase 1)

Phase 1 ships one artifact: the web build, on itch.io and in the Poki and CrazyGames test
iframes. There are no store builds, so the §11 matrix is cut to what that build can run on.
Idan runs the real-device rows (§11: "Idan tests on real hardware; everything else on
emulators").

### 3.1 Automated (CI, every PR)

| Engine   | Viewport                       | Projects                                 |
| -------- | ------------------------------ | ---------------------------------------- |
| Chromium | Pixel 5 profile at 390×844     | `phone`, all specs                       |
| Chromium | Desktop 1280×720 and 1920×1080 | `desktop`, all specs except E2E-03       |
| WebKit   | iPhone 12 profile at 390×844   | `phone-webkit`, the toy specs (§2.2)     |
| Firefox  | n/a                            | Golden hashes only (already on every PR) |

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

The exact definitions below are fixed in ADR-010 (accepted by the Lead). They are measurement
definitions, not a gate change; Idan can override any of them at the gate review.

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
  3. The 500-run headless soak is clean (`pnpm --filter @rushwarden/soak run soak`; the itch
     deploy workflow runs it before the upload). It plays the toy with the seven Phase 1 bots in
     turn, checks every round's controller hash against the sim worker's real message handler,
     and fails on any exception, worker error or more than 2 MB of heap growth after run 50. It
     covers app, sim, content and the bots only; render and UI memory is the §3 device checklist.
  4. The three "Must" devices in §3.2 pass the checklist.
  5. There are no open P0 or P1 bugs.
  6. If `/ingest` is on, the privacy policy is live.

  QA records this in `docs/release/phase-1-devices.md` and links it from the gate page.

- Every fixed bug gets a regression test (§11). A bug Idan finds that a spec could have caught
  gets a spec and a line in the retro.

## 6. Open items

| Item                                             | Status / owner                                        | Blocks                    |
| ------------------------------------------------ | ----------------------------------------------------- | ------------------------- |
| Test hooks H1–H5 (approved)                      | Built by Render/UI (H2, H3, H5) and Platform (H1, H4) | Most of the specs in §2.2 |
| 390×844 and WebKit phone projects (approved)     | In the config; CI needs `webkit` installed (Lead)     | `phone-webkit` in CI      |
| Run screen in the platform-web build (P1-WEB-01) | Done (#50); QA removed the gate                       | Every toy spec in CI      |
| Measurement definitions (ADR-010, accepted)      | Idan may override at the gate review                  | The gate page             |
| Privacy policy published (enables `/ingest`)     | Idan (ADR-007)                                        | Criterion 1               |
