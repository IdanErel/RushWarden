# itch.io page (Phase 1 toy)

> **DRAFT: pending the GIF (P1-QA-02).** Idan pastes this into the draft project and publishes it
> himself (`docs/setup/accounts.md` step 3). See the "can say" list in [README.md](README.md).

## Fields

| Field                        | Value                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Title                        | Rushwarden                                                                                                              |
| Short description or tagline | Play traffic rule cards, press Go, and watch rush hour decide.                                                          |
| Kind of project              | HTML (embed 390×844, mobile friendly, fullscreen button on; see `docs/setup/accounts.md`)                               |
| Release status               | Prototype                                                                                                               |
| Pricing                      | No payments (Idan's call; the toy has no unlock)                                                                        |
| Genre                        | Strategy                                                                                                                |
| Tags (itch allows up to 10)  | deckbuilding, roguelite, traffic, simulation, strategy, card-game, short, singleplayer, minimalist, mobile              |
| Input methods                | Mouse, Keyboard, Touchscreen                                                                                            |
| Cover image (630×500)        | Generated later from the game (P1-QA-03, assets part)                                                                   |
| Screenshots                  | `[GIF]` first, then three still frames: placing a card with the ghost preview, the Go phase, and the run-end share line |

## Body

> **Play rule cards onto a live street grid, press Go, and watch 15 seconds of rush hour decide
> whether enough cars get through.**
>
> `[GIF]`
>
> ```
> Rushwarden · Old Town · 🟩🟩🟨🟩🟥 · 190 through
> ```
>
> You're the city's traffic commissioner. Each round:
>
> 1. **Draw** 5 rule cards. You have 3 energy.
> 2. **Place** up to 2 of them on junctions, streets, a map edge, or the whole district. You can
>    see where traffic will come from before you commit, and you can undo before Go.
> 3. **Go.** Watch 15 seconds of simulated traffic. Hold to run it at 2×. Nothing is random
>    after you press Go.
> 4. **Score.** Beat the quota to add 1 of 3 new cards to your deck. Miss it and you lose
>    approval. Lose all 3 and the run is over.
>
> If nothing moves for 3 seconds, the junction is gridlocked and the round ends on the spot.
>
> **This prototype** is one 5-round run in Old Town (about 3 minutes). Round 5 is Market Day, a
> rush round full of trucks. There are 20 cards in 5 styles:
>
> - **FLOW:** Smart Signal, One-Way, Turn Lane, Speed Limit Up
> - **MASS:** Bus Priority, Express Stop, Bus Lane, Fare Holiday
> - **TOLL:** Detour, Toll Booth, Staggered Hours, Delivery Window
> - **CHAOS:** Roundabout, Yield Culture, No Heavy, Remove Signal
> - **TEMPO:** Overtime, Second Shift, Pilot Program, Recount
>
> At the end of a run you get a share line, like the one above, to paste anywhere.
>
> No ads. No account.
>
> **This is an early test build.** We want to know whether the core loop is fun. Leave a
> comment: which card saved your run, and which jam made no sense?

## Controls (paste under the body, or in itch's "Controls" section)

| Action             | Touch / mouse                  | Keyboard   |
| ------------------ | ------------------------------ | ---------- |
| Select a card      | Tap / click the card           | 1–5        |
| Choose a target    | Tap / click a junction or road | Arrow keys |
| Place              | Tap / click the target         | Enter      |
| Undo (before Go)   | Tap the placed card again      | Esc        |
| Go                 | Go button                      | Space      |
| 2× speed during Go | Hold anywhere                  | n/a        |
| Pause              | Pause button                   | Esc        |

Before publishing, QA checks this table against the build. P1-UI-01 decides the final key for
holding 2× on a keyboard, and whether Esc pauses during Go.

## Optional: privacy line

Use this line only if `/ingest` is on in the public build (ADR-007). Add it at the end of the
body:

> The game sends four anonymous gameplay events (app open, run start, round end, run end) so we
> can see how long sessions last. They carry a random install ID that the game makes up
> locally, and nothing that identifies you. No account, no ads. Privacy policy:
> `[privacy policy link]`.

The wording must match the published policy (`docs/legal/privacy.md`, PR #5); if they differ, the
policy wins.
