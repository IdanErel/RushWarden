# ADR-027: Nightly balance report is an artifact

Status: Accepted (Lead) · 2026-10-10 · recorded by the Sim Engineer for P1-LEAD-02 (#40). Number
assigned by the Lead.

The Phase 1 task table (P1-LEAD-02) says the nightly balance report is "committed to
`docs/balance/latest.md` by a bot PR". The Lead decided otherwise:

1. **Nightly runs upload the report and do not commit it.** `.github/workflows/nightly.yml` writes
   the GDD §11 report to the job summary and uploads it as a workflow artifact (kept 30 days). No
   workflow commits, pushes or opens a PR.
2. **`docs/balance/latest.md` is committed by the balance owner** in a normal reviewed PR whenever
   a tuning change lands (cards, quotas, demand). Every committed report is therefore tied to a
   reviewed change, and the §11 rule that a balance-affecting PR carries its report still holds.
3. **This replaces the task table's "bot PR".** No bot account or write token is needed, and
   ADR-005 (no self-merge) is unaffected.
