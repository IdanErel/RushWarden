# @rushwarden/platform-web

Vite web entry with Poki, CrazyGames and itch adapters and the Stripe unlock.

Owner: Platform Engineer. See GDD section 6 for this package's responsibilities and section 13 for ownership.

## Public API

Phase 0: `src/main.ts` boots the bundle and runs the sim once. `pnpm build` produces `dist/`;
`pnpm e2e` runs the Playwright boot test. Portal adapters land here in Phase 1.

## itch build (P1-PLT-01)

`pnpm package:itch` builds the itch flavour into `dist/` (`VITE_PORTAL=itch`), runs the ADR-004 size
budget, and writes `itch/rushwarden-itch.zip` (git-ignored). The script checks that `index.html`
sits at the zip root, that all URLs are relative (itch serves the game from a CDN subfolder inside an
iframe), that there are at most 1000 files, and that the zip is within the 7.5 MB budget. The zip is
deterministic (sorted entries, fixed timestamps) and written by `scripts/zip.mjs` with no
dependencies. CI uploads it as an artifact; the butler deploy is the Lead's (P1-LEAD-02). The itch
page settings (embed 390×844, fullscreen button, mobile friendly) are in
`docs/setup/accounts.md` §3.
