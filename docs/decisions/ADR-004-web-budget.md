# ADR-004: Web initial download budget is 7.5 MB

Status: Accepted · 2026-10-10 · Lead

Section 1 says "under 8 MB gzipped"; section 6 says 7.5 MB with a 4 MB target. CI enforces the
stricter 7.5 MB initial limit and 12 MB total (`tools/size-budget/check.mjs`), warns above 4 MB,
and treats files under `dist/lazy/` as lazy-loaded. This keeps headroom under Poki's 8 MB rule.
