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
4. **GDD §11 is met.** §11 has the nightly job produce `docs/balance/latest.md`. Every nightly run
   produces that report as the `latest.md` file in its artifact, and the committed copy is updated
   on every tuning PR, so this is not a deviation from the brief, only from the task table's
   delivery mechanism.
5. **Amendment (2026-10-11, Lead): the report is also pushed to a branch.** Some agents cannot
   download workflow artifacts (their network blocks the artifact storage host). On runs on
   `main`, a separate `publish-report` job runs after the balance job: it downloads the report
   artifact and force-pushes a single orphan commit holding `latest.md` to the dedicated branch
   `reports/balance-nightly`. Only that job has `contents: write` (5-minute timeout, no install or
   repo code; the token is passed to the push command only). The workflow pushes only that ref;
   `GITHUB_TOKEN` itself cannot be limited to one branch, so keeping `main` unwritten relies on
   its branch protection. The artifact upload stays, and committing `docs/balance/latest.md` is
   still a reviewed PR by the balance owner (point 2), copied from that branch.
