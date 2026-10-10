# Gridlock Royale

A traffic-simulation deckbuilding roguelite for web (Poki, CrazyGames, itch.io), iOS, Android and
Steam, from one TypeScript codebase. The binding specification is [`docs/gdd.md`](docs/gdd.md).

## Quick start

```sh
corepack enable
pnpm install
pnpm lint && pnpm typecheck && pnpm test   # what CI runs first
pnpm golden                                # 200-round determinism suite on Node
pnpm golden:browsers                       # same on Chromium, WebKit, Firefox
pnpm size                                  # web build + 7.5 MB gzipped budget
pnpm --filter @gridlock/platform-web dev   # run the web build locally
```

## Layout (GDD section 6)

| Path                        | Owner     | Contents                                           |
| --------------------------- | --------- | -------------------------------------------------- |
| `packages/sim`              | Sim       | Deterministic integer-only simulation              |
| `packages/content`          | Content   | Cards, maps, districts, mayors (JSON + schema)     |
| `packages/balance`          | Sim       | Headless runner, bots, balance report              |
| `packages/render`           | Render    | Pixi scene, interpolation, procedural sprites      |
| `packages/audio`            | Audio     | Synth, SFX, music                                  |
| `packages/ui`               | UI        | Preact menus, share card, i18n                     |
| `packages/app`              | Lead / UI | State machine, saves, entitlement, `PortalAdapter` |
| `packages/platform-web`     | Platform  | Vite entry, portal adapters, Stripe unlock         |
| `packages/platform-mobile`  | Platform  | Capacitor shell                                    |
| `packages/platform-desktop` | Platform  | Electron + Steamworks                              |
| `packages/backend`          | Backend   | Cloudflare Workers                                 |
| `tools/golden`              | Sim       | Golden determinism suite                           |
| `tools/size-budget`         | Lead      | Web download budget check                          |
| `docs/`                     | Lead      | GDD, ADRs, tasks, standups, balance, setup         |

## How we work

Read [`CONTRIBUTING.md`](CONTRIBUTING.md). In short: one PR per task, conventional-commit titles,
the PR template filled in, Reviewer approval plus green CI before the Lead squash-merges, and an
ADR in `docs/decisions/` for anything the brief does not decide.

Copyright © 2026 Idan Erel. All rights reserved.
