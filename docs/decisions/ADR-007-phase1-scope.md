# ADR-007: Phase 1 scope

Status: Accepted · 2026-10-10 · Lead

The brief fixes the Phase 1 deliverable but not these details. Full task list: `docs/tasks/phase-1.md`.

1. The itch toy is a 5-round District 1 run, about 3 minutes. (Amended 2026-10-11 by ADR-030:
   every toy round is a rush round with an event, rounds `[4, 8, 12, 8, 12]`.) The balance runner plays full 12-round District 1 runs.
2. No shop in Phase 1 (it is a Phase 2 deliverable), so funds have no sink: the 20 cards exclude
   funds-only cards, and the Phase 1 starting deck replaces Grant with Pilot Program. This is a Phase-1-only scope label, not a content value change: the Content Designer
   co-signs it in P1-CON-05, and §4's starting deck applies unchanged from Phase 2.
3. `archetype(tag)` bots are built in Phase 1 with `random` and `greedy`, since gate criterion 2
   ("5 archetypes with 35–65% win rates in sim") needs them.
4. The deterministic run controller lives in `packages/app/src/run/`, owned by the Sim Engineer
   in Phase 1.
   Amended 2026-10-10 (Lead): P1-BAL-01 moved to the Platform Engineer so Sim stays on SIM-02–06; rule readings in ADR-018.
5. A minimal `/ingest` Worker with four of the §10 events measures itch session length for gate
   criterion 1; it is pulled forward from Phase 3 and needs Idan's Cloudflare account.
   **It stays switched off in any public build until a privacy policy (§10) is published on the
   website.** The team drafts `docs/legal/privacy.md` in Phase 1 (task P1-BE-02); publishing it,
   and whether to collect at all in the toy, is Idan's call (§13: legal/policy).
   Idan, 2026-10-10: collecting the four events in the toy is approved once the policy is
   published. Event time is the server's receipt time only (ADR-009).
