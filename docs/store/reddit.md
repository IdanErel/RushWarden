# Reddit posts (Phase 1)

> **DRAFT: pending the GIF (P1-QA-02).** Idan posts all of these from his own account; the team
> never posts (GDD §13). See the rules and the "can say" list in [README.md](README.md).

How to use this file:

- Each post is a **GIF post** with the title below. Right after posting, Idan adds the
  **first comment**, which has the link and the details. Most of these subreddits prefer the link
  in a comment, or require it there. Check each sub's rules.
- Space the four posts over at least a few days, not all on one day. That way each sub's
  feedback can change the next post.
- The share strip in each first comment is the illustrative one from the README. Replace it with
  a real one from the build before posting.

## Fit notes Idan should read first

The brief (§12) names these four subreddits. Two of them are a weak fit for this game. QA flags
it here; the choice is Idan's:

- **r/roguelikes** is mostly about traditional roguelikes. A roguelite deckbuilder may be off-topic
  or limited to a weekly self-promotion thread. Check the sidebar before posting. If the post is
  not allowed, the same draft works for a sub about roguelites or deckbuilders, which QA can
  adapt on request.
- **r/incremental_games** is about incremental and idle games, and Rushwarden is neither. The
  draft below says that openly instead of pretending. A rule-based "Feedback" thread, if the sub
  has one, may be the safer place.
- **r/IndieGaming** and **r/WebGames** fit as they are. r/WebGames expects the link to be playable
  in the browser with no download, which the itch build is.

---

## r/WebGames

**Title**

> Rushwarden: play traffic rule cards on a live street grid, press Go, and watch rush hour decide
> if the city keeps moving (browser, ~3 min)

**Post:** `[GIF]` the Market Day rush round, 9:16.

**First comment**

> Play rule cards onto a live street grid, press Go, and watch 15 seconds of rush hour decide
> whether enough cars get through.
>
> Play it here (in the browser, phone or desktop, no account, no ads): `[itch link]`
>
> One run is 5 rounds, about 3 minutes. Each round you get 5 cards and 3 energy, and you can play
> up to 2: put a Smart Signal on a junction, make a street one-way, give buses a lane, swap a
> signal for a roundabout. You can see where traffic will come from before you commit. After you
> press Go, nothing is random. If nothing moves for 3 seconds, the round is gridlocked.
>
> At the end you get a line you can paste:
>
> ```
> Rushwarden · Old Town · 🟩🟩🟨🟩🟥 · 190 through
> ```
>
> This is an early prototype. I'd love to know which card you ended up leaning on, and whether
> you could tell why a jam happened.

---

## r/IndieGaming

**Title**

> I'm making a deckbuilder where your cards are traffic rules and every turn is 15 seconds of
> live rush hour

**Post:** `[GIF]` the Market Day rush round, 9:16.

**First comment**

> Play rule cards onto a live street grid, press Go, and watch 15 seconds of rush hour decide
> whether enough cars get through.
>
> The idea: you're the city's traffic commissioner. Cards are rules like Smart Signal, One-Way,
> Bus Lane, Detour and Roundabout. You place up to 2 per round, then watch the simulation play
> out. Pass the quota to draft a new card; miss it and you lose approval. The jams are
> the content: every jam has a cause you can point at.
>
> There are 20 cards in 5 styles: smooth signals (FLOW), buses and bikes (MASS), rerouting
> demand (TOLL), roundabouts and removing signals (CHAOS), and extra energy and draw (TEMPO).
>
> A run in the prototype is 5 rounds, about 3 minutes, and ends with a share line like this:
>
> ```
> Rushwarden · Old Town · 🟩🟩🟨🟩🟥 · 190 through
> ```
>
> Plays in the browser, no account, no ads: `[itch link]`. It's an early build, and I'm testing whether the core loop
> is fun before going further, so honest feedback helps a lot.

---

## r/roguelikes

**Title**

> Rushwarden: a short roguelite deckbuilder prototype where the "combat" is a deterministic
> traffic simulation

**Post:** `[GIF]` the Market Day rush round, 9:16. Or a text post with the GIF linked, if the sub
prefers text posts.

**First comment / body**

> Play rule cards onto a live street grid, press Go, and watch 15 seconds of rush hour decide
> whether enough cars get through.
>
> I know this sub is mostly about traditional roguelikes, so to be upfront: this is a run-based
> deckbuilder, not a dungeon crawler. The parts that may interest you:
>
> - **Deterministic resolution.** The traffic is a cell-based simulation. You see where demand
>   will come from before you place cards, and after Go nothing is random. When a round fails,
>   you can usually point at the card that caused it, or the one that was missing.
> - **Permadeath-style runs.** You have 3 approval. Each missed quota costs 1, and at 0 the run is
>   over. Passing lets you draft 1 of 3 cards.
> - **Combos from the sim, not from text.** For example, Bus Lane plus Bus Priority, or removing
>   signals and leaning into roundabouts. There are 20 cards across 5 styles in the prototype.
>
> The prototype is a 5-round run (about 3 minutes) with a rush round at the end. It runs in the
> browser: `[itch link]`.
>
> ```
> Rushwarden · Old Town · 🟩🟩🟨🟩🟥 · 190 through
> ```
>
> Feedback I'm after: does it read like a strategy game, or does the outcome feel out of your
> hands?

---

## r/incremental_games

**Title**

> Not an idle game, but it's built on watching numbers go up: a traffic deckbuilder where you
> tune a city grid one rule card at a time (browser prototype)

**Post:** `[GIF]` the Market Day rush round, 9:16.

**First comment**

> Play rule cards onto a live street grid, press Go, and watch 15 seconds of rush hour decide
> whether enough cars get through.
>
> Fair warning: this isn't an incremental or idle game. I'm posting here because the
> satisfaction is similar: you make small changes, watch the throughput number climb, and push
> to beat the next quota. Every round the quota goes up. Your deck grows by one card each time
> you pass, so the run becomes about stacking rules that work together (signals plus one-ways,
> or buses plus bus lanes).
>
> A run is 5 rounds, about 3 minutes, in the browser with no account: `[itch link]`
>
> ```
> Rushwarden · Old Town · 🟩🟩🟨🟩🟥 · 190 through
> ```
>
> I'm testing whether the loop holds up before building more. Did you want to go again after
> the first run?
