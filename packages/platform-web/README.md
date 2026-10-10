# @rushwarden/platform-web

Vite web entry with Poki, CrazyGames and itch adapters and the Stripe unlock.

Owner: Platform Engineer. See GDD section 6 for this package's responsibilities and section 13 for ownership.

## Public API

Phase 0: `src/main.ts` boots the bundle and runs the sim once. `pnpm build` produces `dist/`;
`pnpm e2e` runs the Playwright boot test. Portal adapters land here in Phase 1.
