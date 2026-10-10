# ADR-000: Stack and tooling versions

Status: Accepted · 2026-10-10 · Lead

## Context

GDD section 6 fixes the stack. This records the concrete versions chosen on 2026-10-10 and the
few choices the brief leaves open.

## Decision

| Layer           | Choice                                                                                | Version policy                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Runtime         | Node 22 LTS (`.nvmrc`)                                                                | Bump with an ADR                                                                                                  |
| Package manager | pnpm 10 workspaces (`packageManager` pinned)                                          |                                                                                                                   |
| Monorepo        | Turborepo 2                                                                           |                                                                                                                   |
| Language        | TypeScript 5.9, strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, ESM | The brief says 5.x; TypeScript 7 (native) is not adopted until the brief changes                                  |
| Lint/format     | ESLint 9 flat config + typescript-eslint strict + Prettier 3                          |                                                                                                                   |
| Unit/property   | Vitest 4 + fast-check 4; v8 coverage (sim 90%, others 70%)                            |                                                                                                                   |
| Browser tests   | Playwright (Chromium, WebKit, Firefox)                                                | Pinned exactly; bump in its own PR                                                                                |
| Web build       | Vite 7                                                                                |                                                                                                                   |
| Rendering       | PixiJS 8                                                                              | Added by Render Engineer in Phase 1                                                                               |
| Menus           | Preact                                                                                | Added by UI Engineer in Phase 1                                                                                   |
| Mobile          | Capacitor, current major at Phase 2 start                                             | Brief names Capacitor 6; Platform Engineer picks the current major so the Android target-SDK rule is met, via ADR |
| Desktop         | Electron, current major at Phase 2 start, + steamworks.js                             |                                                                                                                   |
| Backend         | Cloudflare Workers + D1 + KV, Wrangler                                                | Phase 3                                                                                                           |
| Commits         | Conventional commits; squash merge; PR title linted by commitlint in CI               |                                                                                                                   |

Package scope is `@rushwarden/*`. Packages export TypeScript source (`exports: ./src/index.ts`);
bundlers and Vitest compile it, so there is no per-package build step until a package needs one.

Non-null assertions (`!`) are allowed only in `packages/sim` and tests, where typed-array hot loops
under `noUncheckedIndexedAccess` need them; the Reviewer checks each one is in bounds.

The sim's integer-only rule is enforced by ESLint in `packages/sim/src`: no `Math.random`, no
clock, no float typed arrays, no `/` or `**` (use `idiv` in `math.ts`), no non-integer literals.

## Consequences

Everyone codes against `packages/sim/src/types.ts` and `packages/app/src/{portal,entitlement,save}.ts`.
Changing them follows GDD section 13 rule 6.
