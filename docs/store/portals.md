# Poki and CrazyGames (Phase 1)

> **Ready for Idan's review; not submitted.** Idan submits to Poki (player-fit test) and to
> CrazyGames (Basic Launch) himself (`docs/setup/accounts.md` step 5), and only after both
> portals have answered the ADR-024 questions below. The team never acts in a portal console
> (GDD §13). The package is P1-PLT-02's; this file is its text and its checklist.

## The package

| Item                        | File                           | Made by                                                                       |
| --------------------------- | ------------------------------ | ----------------------------------------------------------------------------- |
| Poki build zip              | `rushwarden-poki.zip`          | `pnpm --filter @rushwarden/platform-web package:poki`                         |
| CrazyGames build zip        | `rushwarden-crazygames.zip`    | `pnpm --filter @rushwarden/platform-web package:crazygames`                   |
| Thumbnail 512×512           | `portal-thumbnail-512x512.png` | `pnpm --filter @rushwarden/clip store-assets --only portal-thumbnail-512x512` |
| Cover 16:9                  | `portal-cover-1920x1080.png`   | `pnpm --filter @rushwarden/clip store-assets --only portal-cover-1920x1080`   |
| Description, tags, controls | this file                      |                                                                               |

The zips land in `packages/platform-web/portals/` and every CI run uploads both as the
`rushwarden-portals-<sha>` artifact (kept 14 days). The images land in `tools/clip/out/store/`
([assets.md](assets.md)). Both portals get the same two images.

What the package build and its test check (details in `packages/platform-web/README.md`):

- **SDK events (GDD §9).** `pnpm e2e:portals` plays a whole run from each zip against a stub SDK
  that records every call: the loading event once (Poki `gameLoadingFinished`, CrazyGames
  `loadingStart` then `loadingStop`), then exactly one `gameplayStart`/`gameplayStop` pair per
  round. CrazyGames gets `happytime` only on a district win.
- **No ads (ADR-013, ADR-024 decision 1).** The game keeps `commercialBreak` hooks before and
  after a run, as §9 asks, but they resolve without calling the SDK. The test fails on any call
  to `commercialBreak`, `rewardedBreak` or `SDK.ad.*`, and the package fails if an ad API name is
  in the bundle.
- **Sound after a gesture.** The toy has no audio yet. The test fails if an `AudioContext` is
  created before the player's first tap or click.
- **Links (ADR-024 point 5).** The bundle may contain no URL except its own portal's SDK and the
  privacy policy. The share line uses the portal's own URL from its SDK, and no link at all if
  the SDK is blocked. No itch, website, Steam or store links. The test fails on any request
  outside the zip's files and the SDK.
- **No own analytics (ADR-024 point 4).** The build fails if `VITE_INGEST_URL` is set.
- **Size.** About 0.22 MB; the budget is 7.5 MB (Poki asks for under 8 MB).

Portal rules that shape this copy (§9):

- **No external links** in the description, so there's no itch link and no website. In the game,
  the only links are the portal's own share URL and the privacy policy (ADR-024 point 5).
- No prices or unlock talk: the toy has no unlock, and Poki forbids external payments.
- Portal players skim, so the description is short and the controls are spelled out.

## Poki

**Description**

> Play rule cards onto a live street grid, press Go, and watch 15 seconds of rush hour decide
> whether enough cars get through.
>
> You're the traffic commissioner. Each round, play up to 2 rule cards: traffic signals,
> one-way streets, bus lanes, detours, roundabouts. Then press Go and watch the traffic flow, or
> jam. Beat the quota to win a new card. Miss it 3 times and you're out.
>
> Can you get Old Town through Market Day, the Parade and the Festival? Finish a run and share your result:
>
> ```
> Rushwarden · Old Town · 🟩🟩🟨🟩🟥 · 190 through
> ```

**Controls**

> Tap or click a card, then tap or click a road or junction to place it. Tap it again to undo.
> Press Go to start the traffic. Hold anywhere to speed it up.
>
> Keyboard: 1–5 pick a card, arrow keys move, Enter places, R turns a one-way round, Space is
> Go, Esc undoes (or pauses during Go).

**Tags (suggested; Poki assigns its own categories)**: strategy, card, traffic, puzzle,
simulation, cars.

## CrazyGames

**Description**

> Play rule cards onto a live street grid, press Go, and watch 15 seconds of rush hour decide
> whether enough cars get through.
>
> Rushwarden is a short traffic strategy game with a deck of rule cards. Place signals,
> one-ways, bus lanes and roundabouts on a city grid, then watch 15 seconds of rush hour play
> out. If nothing moves for 3 seconds, it's gridlock. Pass the quota to add a new card to your
> deck; miss it and you lose approval.
>
> ```
> Rushwarden · Old Town · 🟩🟩🟨🟩🟥 · 190 through
> ```
>
> **Features**
>
> - 20 rule cards in 5 play styles: smooth flow, buses and bikes, rerouting, roundabout chaos, and
>   extra energy and cards
> - See where traffic will come from before you place your cards
> - A run takes about 3 minutes: five rush hours, from Market Day to the Festival
> - Share your result as a line of coloured squares
> - Works on phone and desktop

**Controls**

> - Select a card: click or tap it, or press 1–5
> - Choose where it goes: click or tap a junction or road, or use the arrow keys
> - Place: click or tap again, or press Enter
> - Undo before Go: tap the placed card, or press Esc
> - Turn a one-way street round: its ⇄ button, or press R
> - Start the traffic: Go button or Space
> - Speed up: hold anywhere during Go
> - Pause: pause button, or Esc or P during Go

**Tags (suggested)**: strategy, card, traffic, simulation, puzzle, casual.

## Before submitting

- [x] Controls match the build (`packages/ui/src/keys.ts`: Esc undoes while placing and pauses
      during Go; R turns a one-way; speed-up is hold only, no key).
- [x] Share line: the toy shares the portal's own URL (Poki `shareableURL`, CrazyGames
      `inviteLink`) after the strip, never our website.
- [x] SDK events, no ad calls, sound after gesture, links: checked on the zips by
      `pnpm e2e:portals` in CI.
- [ ] **ADR-024 questions answered in writing** (Idan asks): Poki (a) a game that never calls
      `commercialBreak()` or `rewardedBreak()` passes QA; CrazyGames (a) a game that never
      requests ads is eligible. If either portal requires ad calls, that portal is dropped for
      Phase 1 (ADR-024 decision 1); the game does not add ads.
- [ ] "Works on phone and desktop": the §3.2 device checks in `docs/release/phase-1-test-plan.md`
      have passed.
- [ ] Privacy policy: if `VITE_PRIVACY_URL` is published by then, rebuild both zips with it set
      so the Privacy panel links it (ADR-025; the package check allows that one URL).
