# ADR-009: Analytics event time is the server's receipt time

Status: Accepted · 2026-10-10 · Lead

§10 lists the analytics fields "and nothing else" and requires an ADR for new analytics data.
Measuring session length (Phase 1 gate criterion 1) needs to know when events happened. The
client sends no timestamp; `/ingest` sends each event when it happens (no batching in the toy)
and stores the time the server received it. That reveals nothing the server did not already
see, and the privacy policy discloses it. Retention, consent in the EU/UK and opt-out are settled
with the published policy (`docs/legal/privacy.md`), which Idan approves.

## Consequences

- Duplicates are accepted: the client never retries and §10 allows no event id, so `POST /ingest`
  is not idempotent and a rare duplicate event is stored twice (Lead, P1-BE-01).
