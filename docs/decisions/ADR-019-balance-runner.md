# ADR-019: Balance runner seeds, bots and report format

Status: Proposed · 2026-10-10 · Platform Engineer (P1-BAL-02; number assigned by the Lead)

GDD §11 names the bots, the nightly volume and the report contents, and ADR-010 point 2 fixes the
gate run (10,000 full 12-round District 1 runs per `archetype(tag)` bot). The brief does not say
how seeds are chosen, what exactly each bot does, or how the report stays comparable from night to
night. `packages/balance` reads them as follows.

1. **Fixed seed set.** Every bot plays run seeds `1..N` (default N = 10,000). All bots play the
   same seeds, so bots are compared on the same maps, demand and offers. A bot never draws from the
   run PRNG: it has its own stream seeded from (run seed, a hash of the bot's name), so adding a bot
   or changing one never changes another bot's runs.
2. **Determinism and parallelism.** A run record depends only on (bot, seed, preset, targets per
   kind, code). Work is split into plain-data jobs of (bot, seed chunk) and run on Node
   `worker_threads`; the records are sorted into a canonical order (bot order, then seed) before the
   report is written. Worker count and chunk size change only the wall-clock time, never the
   output; a test checks that 0 and 3 workers give a byte-identical report.
3. **Bots (Phase 1).**
   - `random`: plays a uniformly chosen number of cards (0 to the play limit), each a uniformly
     chosen legal (card, target), and picks uniformly among the offer and skip.
   - `greedy-throughput`: one-round lookahead. For each play it simulates the round with each
     legal (card, target) and takes the best, and stops when no play keeps the round's score
     at least as high. It picks the offered card that scores best when played alone on the round
     just played. The demand used for lookahead is the one shown to the player before placement
     (GDD §2), so the bot uses no hidden information.
   - `archetype(tag)`: `greedy-throughput`, but it plays its tag's cards when any are legal and
     drafts only cards carrying its tag (skipping otherwise).
   - Lookahead bots try at most 3 targets per card kind, spread evenly over the map's targets, to
     keep a run cheap; `--targets` raises it.
4. **Report format.** Markdown at `docs/balance/latest.md` with fixed sections in a fixed order
   (gate criterion 2, win rate per bot, per-card drafted delta and pick rate, archetype purity,
   round of death, gridlock frequency, top 20 decks). It contains no wall-clock time; it names the
   commit and is formatted with the repo's Prettier settings, so the same inputs give a
   byte-identical file and a nightly diff shows only real changes.
5. **Readings.** Win rates are rounded to the nearest per-mille before the 35–65% check, which is
   inclusive at both ends. The drafted delta is computed per bot: for each bot, (win rate of its
   runs that drafted the card) − (win rate of its runs that did not), averaged over bots weighted
   by drafting runs; a bot with no runs on one side is left out, and with none left the delta is
   n/a. Amended 2026-10-10 (Lead, from reviewer-2 on #29): the first reading compared against the
   win rate of all runs, which credited a card with the strength of the bots that draft it, e.g.
   −28 for One-Way when only `random` could draft it. Purity is the share of final-deck cards that carry the deck's most
   common tag. Watch time is simulated ticks ÷ 20 and excludes placement time.
6. **Caveats are labelled.** The runner plays content's cards, starting deck and `setupRound`
   (maps, demand, district rules, Parade closures); the stand-ins it used before #28 are gone (a
   small seeded environment remains as a test fixture only). Known caveats about the data, such as
   pre-tuning content during CON-05, are listed in a warning at the top of the report. When every
   round scores 0 throughput (the stub sim), the report says that its win rates mean nothing.

Alternatives considered: fresh random seeds each night (rejected: every diff would be noise), and
different seeds per bot (rejected: it adds variance to bot-to-bot comparisons). We also considered
spawning one process per core instead of worker threads, but rejected it because threads share
the loaded code and need no IPC framing.
