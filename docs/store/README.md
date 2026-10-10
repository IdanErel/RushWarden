# Store and community copy (Phase 1)

> **DRAFT: pending the GIF (P1-QA-02).** None of this is final. Every `[GIF]` placeholder is
> filled once the clip tool has rendered a seeded rush round. Idan edits the voice (GDD §12) and
> posts everything himself; the team never posts (§13).

Task: P1-QA-03, text part. The Steam capsules, the itch cover and the portal thumbnails are
generated in code later, after P1-QA-02 lands.

| File                     | What                                                                   |
| ------------------------ | ---------------------------------------------------------------------- |
| [reddit.md](reddit.md)   | Posts for r/incremental_games, r/roguelikes, r/IndieGaming, r/WebGames |
| [itch.md](itch.md)       | itch.io page: tagline, body, controls, metadata                        |
| [steam.md](steam.md)     | Steam "Coming soon": short and long descriptions, tags, AI disclosure  |
| [portals.md](portals.md) | Poki and CrazyGames: description and controls text                     |

## Rules every draft follows

1. **Lead with the mechanic in one sentence and show the share strip** (GDD §12).
2. **Claim only what the Phase 1 toy has** (ADR-007). The list below is the source of truth for
   the copy. If a line is not in "can say", it does not go in.
3. The name is **Rushwarden** (ADR-008). The word "gridlock" appears only as the game mechanic.
4. No prices and no "free" (the full game will have a paid unlock, §9), no release dates, no "coming to mobile/Steam Deck" promises.
   Those are Idan's calls (§13).

### The mechanic sentence (shared by every draft)

> Play rule cards onto a live street grid, press Go, and watch 15 seconds of rush hour decide
> whether enough cars get through.

### The share strip (illustrative)

```
Rushwarden · Old Town · 🟩🟩🟨🟩🟥 · 190 through
[itch link]
```

🟩 passed · 🟨 passed under 110% of quota · 🟥 failed · ⬛ gridlock. There is one glyph per round,
so the toy's 5-round run has 5 glyphs (§5 shows 12 for the full game). The numbers are worked out
from the §2 quota formula: rounds 1–4 pass and the Market Day rush round fails. Before posting,
QA replaces this example with a real share line from the build. The exact format is
P1-UI-01's, and the daily number (`#212` in §5) is not in the toy.

### What the copy can say (in the toy)

- One run is 5 rounds in District 1, Old Town, and takes about 3 minutes. Round 5 is a rush
  round, "Market Day", with extra trucks.
- Each round: draw 5 cards, 3 energy, play up to 2 cards onto intersections, road segments, an
  edge of the map, or the whole district, then press Go.
- The Go phase is 15 seconds of simulated traffic. You can hold for 2× speed or pause, but you
  cannot change anything.
- Cars, buses, trucks and bikes. Buses count for 3, trucks for 2.
- The demand for the coming round is shown on the map's edges before you place cards. Nothing is
  random after Go.
- Gridlock: if nothing moves for 3 seconds, the round ends where it is.
- Pass the quota to pick 1 of 3 new cards (or skip). Fail and you lose 1 of 3 approval; at 0 the
  run is over.
- 20 rule cards in 5 styles: FLOW (signals, one-ways), MASS (buses, bikes), TOLL (rerouting
  demand), CHAOS (roundabouts, removing signals), TEMPO (energy and draw). Example cards: Smart
  Signal, One-Way, Bus Lane, Detour, Roundabout, Remove Signal, Overtime.
- The game plays in the browser on phone and desktop, with touch, mouse or keyboard. There are no
  ads and no account.
- A text share line at the end of a run (the strip above).
- It is an early prototype, and feedback is wanted.

### What the copy must not say (not in the toy)

Shop, upgrades, funds you can spend, mayors, other districts, 12-round runs, 40 cards, the daily
seed, leaderboards, share images or video, endless mode, the tutorial, codex, run history,
gamepad or Steam Deck, mobile apps, the unlock or any price, music, achievements, cloud saves,
languages other than English. Sound stays out of the copy until the audio task ships it.

### GIF needed (from P1-QA-02)

- Content: one seeded Market Day rush round. A queue builds, one placed card visibly clears it,
  and the quota bar fills. It must still be readable at phone size.
- Formats: 9:16 for Reddit mobile and Shorts, and a square or 16:9 crop for itch and Steam if the
  tool supports it.
- Length 6–15 s, looping cleanly. The seed is recorded next to the file so it can be reproduced.

## Before Idan posts: checklist

- [ ] The GIF is rendered and placed in every `[GIF]` slot.
- [ ] The share strip is replaced with a real one from the build. The example's glyphs are
      hand-computed; only a real strip guarantees each glyph means what §5 says (🟨 = passed
      under 110%).
- [ ] The itch page is live and `[itch link]` is filled in.
- [ ] Every claim is re-checked against the build that is live (not this list). The pillar-style
      claims ("5 styles", "you can usually point at the card") are re-checked against gate
      criterion 2 and the Reviewer's feel report (P1-REV-02).
- [ ] Each subreddit's current rules are read (self-promotion ratio, flair, title format, days
      for promotion) and the draft is adjusted. See the notes in `reddit.md`.
- [ ] If `/ingest` is on, the privacy policy is published and linked from the itch page
      (ADR-007).
- [ ] The trademark clearance on "Rushwarden" is done before any paid listing (ADR-008).
