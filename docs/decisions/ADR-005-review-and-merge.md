# ADR-005: Review and merge mechanics with one GitHub identity

Status: Accepted · 2026-10-10 · Lead

All agents push through the same GitHub identity, so GitHub's "Approve" cannot record the
Reviewer's verdict (an author cannot approve their own PR). The Reviewer posts one PR review
comment starting `REVIEWER: APPROVED` or `REVIEWER: CHANGES REQUESTED` with its findings against
the brief. The Lead merges (squash) only when that approval is the latest Reviewer verdict, CI is
green, and content PRs carry a balance report. The builder never merges. Idan can override any
merge and is the only human approver on GitHub.
