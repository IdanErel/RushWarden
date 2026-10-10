# ADR-009: How the Phase 1 gate criteria are measured

Status: Proposed · 2026-10-10 · QA / Release · needs Idan

GDD §13 sets the four Phase 1 gate criteria but not their exact definitions. Those details decide
pass or fail, and the gate is Idan's call, so QA proposes them here. They apply unless Idan
changes them before the gate page (P1-QA-04) is written. The full method is in
`docs/release/phase-1-test-plan.md` §4.

1. **itch window and session.** Criterion 1 counts the 14 days from Idan's first public post of the
   itch link. A session is the events from one install UUID with `platform=itch`, from `app_open`
   to the last event before a gap of more than 30 minutes. Sessions with only `app_open` count as
   0 s. Pass: at least 200 plays (itch's own count) and a median session longer than 120 s. If
   `/ingest` is off in public builds (ADR-007), criterion 1 is "not measured", not "failed".
2. **Archetype win rates.** Criterion 2 uses 10,000 full 12-round District 1 runs per
   `archetype(tag)` bot at the itch build's commit. All five bots must be within 35–65%
   inclusive.
3. **Steam wishlists.** Criterion 3 counts **net** wishlists (additions minus deletions) at the
   end of day 14 after the "Coming soon" page is publicly visible. Gross additions are reported
   too. It applies only if ADR-006 keeps the criterion.
4. **Poki player-fit.** Criterion 4 uses Poki's own report, read as the share of players still
   playing at 3 minutes. If the report uses another measure, QA reports what it says and Idan
   decides whether it counts; QA does not convert it.

Alternatives considered: measuring itch plays only from our own `/ingest` data. This was
rejected because the brief says "itch plays", and itch's count is the number Idan can check
himself. Counting gross wishlists was rejected because deletions are real lost interest and
Steam's report shows both.
