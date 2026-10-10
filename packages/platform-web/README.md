# @rushwarden/platform-web

Vite web entry with Poki, CrazyGames and itch adapters and the Stripe unlock.

Owner: Platform Engineer. See GDD section 6 for this package's responsibilities and section 13 for ownership.

## Public API

| Export (`src/portal/index.ts`)                    | What it does                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `createPortalAdapter({ shareUrl, env? })`         | Returns the `WebPortalAdapter` for this build's `VITE_PORTAL` flag. Other adapters are tree-shaken out. |
| `PokiAdapter`, `CrazyGamesAdapter`, `ItchAdapter` | `PortalAdapter` implementations (GDD §6, §9). They never show ads (ADR-013).                            |
| `WebPortalAdapter`                                | `PortalAdapter` plus `loadingFinished()`, which only `main.ts` calls.                                   |
| `parsePortalFlag`, `PORTAL_FLAGS`                 | Validates the build flag; `vite.config.ts` uses it to fail a build with an unknown portal.              |
| `loadScript`, `AdapterEnv`                        | Runtime `<script>` loader and the injection point that tests use for fake SDK globals.                  |

Build flavours (the SDK is loaded at runtime from its official URL and never bundled):

| Command                 | `VITE_PORTAL` | SDK URL loaded at runtime                          |
| ----------------------- | ------------- | -------------------------------------------------- |
| `pnpm build`            | `none`        | none                                               |
| `pnpm build:itch`       | `itch`        | none (itch has no game SDK)                        |
| `pnpm build:poki`       | `poki`        | `https://game-cdn.poki.com/scripts/v2/poki-sdk.js` |
| `pnpm build:crazygames` | `crazygames`  | `https://sdk.crazygames.com/crazygames-sdk-v3.js`  |

`VITE_SHARE_URL` overrides the fallback share URL (default `https://rushwarden.com/`).

`pnpm test` runs the adapter unit tests against fake SDK globals. `pnpm e2e` runs the boot tests
on phone and desktop viewports, including a boot inside a cross-origin sandboxed iframe.

## Example

```ts
import { DEFAULT_SHARE_URL, createPortalAdapter } from './portal/index.js';

const portal = createPortalAdapter({ shareUrl: DEFAULT_SHARE_URL });
await portal.init(); // resolves even if the SDK is blocked
portal.loadingFinished();
await portal.commercialBreak(); // before a run: never shows an ad
portal.gameplayStart(); // round begins
portal.gameplayStop(); // round ends
portal.happyTime(); // district win
```

## itch build (P1-PLT-01)

`pnpm package:itch` builds the itch flavour into `dist/` (`VITE_PORTAL=itch`), runs the ADR-004 size
budget, and writes `itch/rushwarden-itch.zip` (git-ignored). The script checks that `index.html`
sits at the zip root, that all URLs are relative (itch serves the game from a CDN subfolder inside an
iframe), that there are at most 1000 files, and that the zip is within the 7.5 MB budget. The zip is
deterministic (sorted entries, fixed timestamps) and written by `scripts/zip.mjs` with no
dependencies. CI uploads it as an artifact; the butler deploy is the Lead's (P1-LEAD-02). The itch
page settings (embed 390×844, fullscreen button, mobile friendly) are in
`docs/setup/accounts.md` §3.
