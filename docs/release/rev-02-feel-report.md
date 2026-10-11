# P1-REV-02: feel report on the toy (pillars 1, 2 and 5)

Reviewer (reviewer-2), 2026-10-11, `main` at `e3a9f93`. Task: adversarial playtest of the toy with
the bots (docs/tasks/phase-1.md). Verdict per pillar, then what to change. This is input for
Idan's own playtest and the gate page (P1-QA-04); it does not decide go/no-go.

## How it was tested

- **Real build, phone size.** The hooks build of `packages/platform-web` (`build:e2e`: the public
  build plus H1/H2), Playwright Chromium at 390×844, DPR 1. Four toy runs (seeds 1, 2, 3, 7),
  played by script at 1×: up to two cards a round on the middle highlighted target, Go, take the
  first offered card. Screenshots at 2.5, 7 and 11 s of each Go and on each result. Headless
  WebGL is software-drawn (about 17 fps, see `playwright.config.ts`), so smoothness and fine
  detail are left to Idan's devices; timings are wall clock since #56.
- **Bot traces.** The seven Phase 1 bots on the toy preset, seeds 1–300 each (9,550 rounds), and
  on the full 12-round run, seeds 1–100 each (7,589 rounds), using `@rushwarden/balance`'s bots
  and the run controller. For every gridlocked round I re-ran the round's sim input with no
  cards, and with each placed card removed in turn; for every round the bare map would have
  locked, with each card alone. The jam spot is the tile holding most stopped vehicles in the
  last frame (`roundWorld` + `locateCell`). The scripts are scratch and not committed.

## Pillar 1: can you name the card that caused or cured a jam? **Cured: often. Caused: no.**

- **Jams are the round's demand, not the cards.** 38% of toy rounds gridlock (every toy round is
  a rush round, ADR-030). In 99% of them the same round with no cards also locks. When a bot
  played cards in a jammed round, removing any one of them cleared the jam in 1% of cases (3% in
  full runs). There is no card to name as the cause, and the result screen says only
  "Gridlock · 17 through · quota 293".
- **Cures are legible, and mostly One-Way.** The bare toy map locks in 56% of rounds; the bots'
  cards prevent 34% of those, and in 82% of prevented jams one card alone does it. One-Way is
  that card half the time (51%; 41% in full runs), then Smart Signal and Detour.
- **You can't point at the jam and see your card.** The jam spot is a median of 3 tiles from the
  nearest placed card (33% within 1 tile). During Go, placed cards show only as an 8 px dot,
  and the One-Way arrow is drawn under the vehicles (`markLayer` sits below `vehicleLayer` in
  `scene.ts`), so a queue on that segment hides its own arrow (seed 1 round 3).
- **Card names clip in the hand at 390 px:** "Roundabou" (seed 7 round 3).

## Pillar 2: one decision per 10 s? **On average yes; in practice in bursts.**

- A round has 2.55 decisions (scripted run; bots: 1.76 plays plus a pick on the 48% of toy rounds
  that pass) and about 6 taps. Go takes 15.2 s on a pass and 10.5 s on a gridlock at 1×; the
  scripted runs took 92–105 s with ~3.4 s of placing a round.
- With a human placing in ~10 s, a round is ~27 s: about one decision per 10–11 s, or one per
  8 s holding 2×. But the decisions all come in the place phase and the offer; Go is the
  longest stretch, 15 s with nothing to decide.
- No menus inside the loop: a failed round costs one extra tap ("Next round"). A full run at
  1× with a human is about 2.5–3 min, in line with ADR-007's "about 3 minutes" and the test
  plan's risk note.

## Pillar 5: is Go watchable? **Passes are; jams are short and abrupt.**

- First vehicle out at 0.6–1.6 s, the progress bar fills steadily, and a pass runs the full 15 s.
- A jam locks early: in the bot traces the board stops at a median 6.3 s (lock time is the end
  tick minus the 3 s rule), and 29% of toy jams lock in the first 5 s. In the real build, seed 1
  round 3 stopped scoring at 2.3 s and ended at 10.2 s. The board then turns red all over, with
  no single junction picked out to read or clip.
- The toy is jam-heavy for a first impression: 38% of toy rounds lock (11% of full-run rounds),
  and three of my four runs had at least two gridlocks.

## Recommendations

1. **Show the cause of a gridlock** (UI, Render): on gridlock, mark the junction or segment that
   locked first and the edge feeding it, and say it on the result card ("Gridlock at the north
   junction"). The sim knows where it stopped. Pillar 1 needs this more than any card change.
2. **Keep placed cards readable during Go** (Render): draw One-Way arrows and card badges above
   vehicles, or outline the placed target, so a player can link a queue to a card.
3. **Soften the toy's first rush round** (Content, Lead, ADR-030): consider a first toy round
   whose bare map does not lock most of the time, so the first Go a player sees is a full 15 s.
4. **Fit card names** (UI): no clipping at 390 px.
5. **Re-check on Idan's devices** (QA, test plan §3.2): frame rate and whether the jam reads at
   phone size, which headless Chromium can't judge.
