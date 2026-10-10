# ADR-029: Toy e2e in CI, E2E-18 tracking, and store-asset rules

Status: Accepted · 2026-10-10 · Lead (recorded by QA / Release, P1-QA-01 and P1-QA-03)

GDD §11 makes E2E a gate on every PR, on Chromium and WebKit. Once P1-WEB-01 (#50) mounts the
run screen, the toy specs (P1-QA-01, `packages/platform-web/e2e/toy`) switch on. Measured
against #50's build, phone and desktop together took 11–14 minutes with 2 workers. The CI `web`
job already takes about 6 minutes and has a 15-minute limit. The brief does not say how to fit
that in.

The store-asset work (P1-QA-03, #51) also raised three questions the brief leaves open: where
the generator lives, which Steam sizes apply, and what a Steam screenshot may show.

## Decision

1. **Toy e2e in CI.**
   - Specs that play whole rounds or runs carry the Playwright tag `@full`: E2E-06, E2E-09,
     E2E-10, E2E-11/12/15 and E2E-13.
   - The `web` job runs the rest (`--grep-invert @full`) on `phone` and `desktop`, as before.
   - A new `toy-e2e` job in `ci.yml` runs the `@full` specs on the `phone` project (390×844
     Chromium), in parallel with the `web` job, with `timeout-minutes: 20`.
   - The `phone-webkit` project (390×844 WebKit) runs the whole toy suite only in the Nightly
     workflow (`toy-webkit` job), which installs WebKit. The per-PR jobs install only Chromium,
     so the config leaves `phone-webkit` out there.
2. **E2E-18 is a tracked bug.** At 1280×720 the run screen stays a portrait column and the hand
   is below the fold (§8 "landscape rearranges HUD to the right"). Itch and desktop players will
   hit it. The spec stays and is marked `test.fixme` with the reason "landscape layout pending
   render-ui fix (Lead, ADR-029)". render-ui fits the portrait column to the viewport height and
   removes the fixme in the same PR.
3. **E2E-04 compares pixels with reduced motion on.** The §7 queue pulse keeps running on the
   wall clock while the game is paused, by design. QA confirmed against #50 that the only pixels
   that change while paused are a queued vehicle's pulse outline: positions and throughput do not
   change. So E2E-04 emulates `prefers-reduced-motion: reduce` (§8 steady outline instead of the
   pulse), checks that throughput is unchanged, and checks that the map's pixels are unchanged.
4. **Store-asset generator.** It lives in `tools/clip`, run with the `store-assets` script,
   because it reuses the clip page and replay (ADR-028). It is not split out into the
   `tools/store-assets` that §7 names.
5. **Steam sizes.** Steam's current published sizes replace the GDD §12 table. They are taken
   from Steamworks' "Graphical Assets" pages (store assets and library assets):

   | Asset            | Size      |
   | ---------------- | --------- |
   | Header capsule   | 920×430   |
   | Small capsule    | 462×174   |
   | Main capsule     | 1232×706  |
   | Vertical capsule | 748×896   |
   | Page background  | 1438×810  |
   | Library capsule  | 600×900   |
   | Library header   | 920×430   |
   | Library hero     | 3840×1240 |
   | Library logo     | 1280×720  |

   This is public documentation; it does not need Idan's decision.

6. **Steam screenshots show real gameplay.** After P1-WEB-01 they are captured from the run
   screen (hand, map, HUD) at 1920×1080. Steam's page says screenshots must show gameplay only,
   without marketing copy. The captioned clip-HUD images are kept as extras for itch, press and
   social posts. They are not uploaded as Steam screenshots.
7. **`.prettierignore`** lists `tools/clip/out`, where generated sidecars and manifests are written.

## Consequences

- Per-PR CI time stays bounded: the slow specs run in their own job, and WebKit only nightly.
- A WebKit-only regression shows up the next morning instead of on the PR. That is accepted for
  Phase 1; revisit when the suite is faster or CI has more runners.
- Main goes red if E2E-18's fixme is removed before the layout fix lands. render-ui owns both.
