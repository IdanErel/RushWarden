# Phase 1 gate: go / no-go

**DRAFT (P1-QA-04).** Evidence as of 2026-10-11, `main` at db960e4. QA keeps this page current until the
gate review. It does not recommend go or no-go.

GDD §13: the validation toy passes when **two of the four criteria pass. Idan decides go/no-go.**
How each number is measured is fixed in [ADR-010](../decisions/ADR-010-phase1-gate-measurement.md) and the
[test plan §4](phase-1-test-plan.md#4-measuring-the-phase-1-gate). Numbers from a store, portal or analytics
console come from Idan as an export or a screenshot. QA commits each one under `docs/release/evidence/phase-1/`
and never reads a console itself.

## Before anything is public

Idan plays the itch build and signs off on it before any public step: the itch page going public, the
Reddit posts, the Steam page, and the portal submissions. Criteria 1, 3 and 4 only start counting
after those steps, so his sign-off comes first.

| Step                                                                                                               | Status                                                           | Owner                   |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------- |
| Itch release bar (test plan §5): CI green, E2E-01–13 and 15–16 pass, 500-run soak, 3 "Must" devices, no open P0/P1 | Partly met, see below                                            | QA                      |
| Reviewer's adversarial playtest and feel report (P1-REV-02)                                                        | Pending                                                          | Reviewer                |
| **Idan's playtest sign-off** on the itch build                                                                     | Pending                                                          | Idan                    |
| Privacy policy published (lets `/ingest` run; ADR-007 point 5)                                                     | Pending: draft in [`docs/legal/privacy.md`](../legal/privacy.md) | Idan publishes; Backend |

## The four criteria

| #   | Criterion (GDD §13)                       | Bar                                                                                                | Status today                      | Evidence                                                                                                                                                                                                                            | Next step and owner                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 200+ itch plays, median session > 2 min   | ≥ 200 plays (itch's count) and median session > 120 s, over 14 days from the first public post     | **Pending** (needs real players)  | Nothing yet. `/ingest` and the session query exist (#20). Analytics stay off until the policy is published (#77).                                                                                                                   | **Idan:** publish the privacy policy, make the itch page public, post. **Backend:** deploy `/ingest` on Idan's Cloudflare account and run the session query on day 15. **Idan:** export itch's play count. If the window opens before the policy is live, this is "not measured", not "fail".                                                                                       |
| 2   | 5 archetypes with 35–65% win rates in sim | All five `archetype(tag)` bots in 35–65%, 10,000 12-round D1 runs each, at the itch build's commit | **Provisional pass (5 of 5)**     | [`docs/balance/latest.md`](../balance/latest.md) at `28f6aee` (#76): FLOW 43.4%, MASS 45.3%, TOLL 51.3%, CHAOS 50.8%, TEMPO 37.7%. TEMPO has the least margin, 2.7 points above the floor.                                          | **QA:** re-run the report at the commit of the itch build Idan signs off (the 10,000-seed nightly takes about 1 h 05 min on the CI runner, run 38098907063). Check it is byte-identical to the nightly's, and add the purity flags. **Reviewer:** sign the re-run (§14). Any content or sim change after `28f6aee` (for example #75, CON-06) needs a new report before this counts. |
| 3   | 500 Steam wishlists in 14 days            | Net wishlists ≥ 500 at day 14 after the "Coming soon" page is public                               | **Pending** (needs a public page) | Copy: [`docs/store/steam.md`](../store/steam.md). Run-screen screenshots: #80. Capsules, library art and background: generated by `pnpm --filter @rushwarden/clip run store-assets` ([`docs/store/assets.md`](../store/assets.md)). | **QA:** run-screen screenshots at 1920×1080 in the landscape layout (#72) are in review (#80). **Idan:** Steamworks account and app fee (ADR-006), page review with Valve, then the day-15 wishlist export.                                                                                                                                                                         |
| 4   | Poki player-fit ≥ 25% at 3 min            | Share of players still playing at 3:00, from Poki's report                                         | **Pending** (needs a submission)  | Poki adapter and build (`build:poki`, #16). Free-demo terms accepted (ADR-024 decision 2). Description: [`docs/store/portals.md`](../store/portals.md).                                                                             | **Platform:** a Poki submission package (zip and checks, like `package:itch`). **Idan:** ask Poki the open questions in ADR-024, then submit. **QA:** copy the report's figures without converting them. Risk (test plan §4.4): a run lasts about 3 min, so the retry must be the obvious next action.                                                                              |

**2 of 4 needed; Idan decides go/no-go.** Today, criterion 2 is a provisional pass, and the other
three need real players or public pages.

## Deliverables checklist

| Deliverable                | State                                                                                                                                                                                                                                                                                 | Owner              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| itch build                 | - [x] Zip is built and size-checked on every push (`package:itch`, `rushwarden-itch-<sha>` artifact, #25, #59).<br>- [x] Manual deploy to the draft channel exists (`itch-deploy.yml`, #40).<br>- [ ] Release bar met (below).<br>- [ ] Idan's sign-off.<br>- [ ] Page public (Idan). | Platform, QA, Idan |
| `docs/balance/latest.md`   | - [x] 10,000-seed report, 5 of 5 archetypes in range (#76, `28f6aee`).<br>- [ ] Re-run at the itch build's commit, with the reviewer's byte-identical check.                                                                                                                          | QA, Reviewer       |
| GIF                        | - [x] Market Day clip from the replay: seed 93, round 1, 9:16 MP4 and GIF. CI uploads both (ADR-028).<br>- [ ] Rendered from the same commit as the signed-off build.                                                                                                                 | QA                 |
| Reddit copy                | - [x] Drafts for the four subs in [`docs/store/reddit.md`](../store/reddit.md).<br>- [ ] Idan's voice pass.<br>- [ ] The example share line replaced with a real one.<br>- [ ] Posted by Idan.                                                                                        | QA, Idan           |
| Steam copy and assets      | - [x] Copy draft, current Steam sizes (ADR-029).<br>- [ ] Run-screen screenshots (#80, in review).<br>- [ ] Page submitted by Idan.                                                                                                                                                   | QA, Idan           |
| Poki / CrazyGames packages | - [x] Adapters and `build:poki` / `build:crazygames` (#16).<br>- [x] Portal rules: no ads, no own analytics, no sales (ADR-024, #39).<br>- [x] Descriptions drafted.<br>- [ ] Submission packages (zip and checks).<br>- [ ] Portal questions answered.<br>- [ ] Submitted by Idan.   | Platform, QA, Idan |

## Itch release bar (test plan §5)

| Item                                   | State                                                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI green on `main`                     | **No** at db960e4: the web job failed on the UI touch e2e (`packages/ui` run.spec.ts:115), flaky since #72. Needs a fix or a tracked issue (UI) before the itch upload; every other job is green. |
| E2E-01–13 and 15–16 pass               | Yes. The `web` and `toy-e2e` jobs run them on every PR. The only open fixme is E2E-14 (audio wiring). E2E-17 (#73) and E2E-18 (#72) now run.                                                      |
| 500-run soak                           | Built in #83 (`tools/soak`, run by the itch deploy workflow). Clean at db960e4: 500 of 500 runs, heap growth 0.4 MB.                                                                              |
| 3 "Must" devices (test plan §3.2)      | **Pending.** Idan runs the device checklist with QA, recorded in `docs/release/phase-1-devices.md`.                                                                                               |
| No open P0 / P1                        | None open as of this draft.                                                                                                                                                                       |
| Privacy policy live if `/ingest` is on | Analytics are off until it is published (#77).                                                                                                                                                    |

## Caveats Idan should read

- **Criterion 2 is measured on 12-round runs**, but the toy players see is 5 rounds sampled from that curve (ADR-030). A pass means
  the archetypes are viable in the sim, not that the toy is balanced.
- **The toy run lasts about 3 minutes.** Poki's 3-minute mark falls at the end of a first run, so criterion 4 depends on how many
  players start a second run.
