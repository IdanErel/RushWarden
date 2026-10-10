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

`pnpm package:itch` builds the itch flavour (`VITE_PORTAL=itch`) into `node_modules/.itch-dist`,
never `dist/`, so it cannot change what `pnpm e2e` previews. It runs the ADR-004 size budget and
writes `itch/rushwarden-itch.zip` (git-ignored). The script pins `VITE_TEST_HOOKS` empty: Vite
never lets a `.env` file override a variable already set in the process, so test hooks (#22)
cannot reach a public build. `scripts/itch-checks.mjs` then fails the build, and writes no zip,
when:

- `index.html` is not at the zip root;
- any URL in `index.html` is root-absolute (itch serves the game from a CDN subfolder inside an
  iframe);
- there are more than 1000 files;
- the zip is over the 7.5 MB budget;
- there is any `*.map` file or `sourceMappingURL`;
- any test-hook marker (`__portalCalls`, `portalSpy`) is present.

The zip is written by `scripts/zip.mjs` with no dependencies. It is byte-identical for the same
build on the pinned Node (`.nvmrc`), because entries are sorted and timestamps fixed; deflate output
can differ between Node majors. CI uploads it as an artifact. The butler deploy is the Lead's
(P1-LEAD-02). The itch page settings (embed 390×844, fullscreen button, mobile friendly) are in
`docs/setup/accounts.md` §3.
