# ADR-010: How the Phase 1 gate criteria are measured

Status: Accepted · 2026-10-10 · Lead (proposed by QA / Release; Idan can override at the gate review)

GDD §13 sets the four Phase 1 gate criteria but not their exact definitions. Those details decide
pass or fail. This ADR fixes them as measurement definitions; it does not change the gate. The
go/no-go stays Idan's call, and he can override any definition at the gate review (P1-QA-04). The full method is in
`docs/release/phase-1-test-plan.md` §4.

1. **itch window and session.** Criterion 1 counts the 14 days from Idan's first public post of the
   itch link. A session is the events from one install UUID with `platform=itch`, from `app_open`
   to the last event before a gap of more than 30 minutes. Sessions with only `app_open` count as
   0 s. Times are the server's receipt times (ADR-009). Pass: at least 200 plays (itch's own count)
   and a median session longer than 120 s. If `/ingest` is still off when the window opens (the
   privacy policy is not yet published, ADR-007), criterion 1 is "not measured", not "failed".
2. **Archetype win rates.** Criterion 2 uses 10,000 full 12-round District 1 runs per
   `archetype(tag)` bot at the itch build's commit. All five bots must be within 35–65%
   inclusive.
3. **Steam wishlists.** Criterion 3 counts **net** wishlists (additions minus deletions) at the
   end of day 14 after the "Coming soon" page is publicly visible. Gross additions are reported
   too (ADR-006 keeps the criterion).
4. **Poki player-fit.** Criterion 4 uses Poki's own report, read as the share of players still
   playing at 3 minutes. If the report uses another measure, QA reports what it says and Idan
   decides whether it counts; QA does not convert it.

Alternatives considered: measuring itch plays only from our own `/ingest` data. This was
rejected because the brief says "itch plays", and itch's count is the number Idan can check
himself. Counting gross wishlists was rejected because deletions are real lost interest and
Steam's report shows both.
