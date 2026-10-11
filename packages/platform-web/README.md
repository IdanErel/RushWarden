# @rushwarden/platform-web

Vite web entry with Poki, CrazyGames and itch adapters and the Stripe unlock.

Owner: Platform Engineer. See GDD section 6 for this package's responsibilities and section 13 for ownership.

## Public API

| Export (`src/portal/index.ts`)                    | What it does                                                                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createPortalAdapter({ shareUrl, env? })`         | Returns the `WebPortalAdapter` for this build's `VITE_PORTAL` flag. Other adapters are tree-shaken out.                                                                                                      |
| `PokiAdapter`, `CrazyGamesAdapter`, `ItchAdapter` | `PortalAdapter` implementations (GDD §6, §9). They never show ads (ADR-013).                                                                                                                                 |
| `WebPortalAdapter`                                | `PortalAdapter` plus `loadingFinished()`, which only `main.ts` calls, and `openExternalLink(url)`: https only; Poki goes through `PokiSDK.openExternalLink`, everything else opens a new tab with no opener. |
| `parsePortalFlag`, `PORTAL_FLAGS`                 | Validates the build flag; `vite.config.ts` uses it to fail a build with an unknown portal.                                                                                                                   |
| `loadScript`, `AdapterEnv`                        | Runtime `<script>` loader and the injection point that tests use for fake SDK globals.                                                                                                                       |

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

`pnpm e2e:itch` (after `pnpm package:itch`) is the smoke test of the artifact itself. It serves the
zip's bytes from a CDN-like subfolder (`/html/1234567/`), embeds it the way itch does (a 390×844
cross-origin iframe), and plays one round. It fails on any page error, any missing file or any
request outside the game's own folder. No upload: publishing to itch waits for Idan's playtest
sign-off.

## Poki and CrazyGames packages (P1-PLT-02)

`pnpm package:poki` and `pnpm package:crazygames` build each portal's flavour into
`node_modules/.<portal>-dist` with test hooks pinned off, run the size budget, and write
`portals/rushwarden-<portal>.zip` (git-ignored). `scripts/portal-checks.mjs` runs the itch checks
above and also fails the package, writing no zip, when:

- the bundle has any URL other than its own portal's SDK, the privacy policy (`VITE_PRIVACY_URL`,
  when set) and a short list of inert identifiers (JSON Schema ids, XML namespaces, Pixi's console
  banner). Our website, itch, the stores, the ingest endpoint and the other portal's SDK all fail it
  (ADR-024 points 4 and 5);
- its own SDK URL is missing (the wrong flavour was built);
- any ad API name is present: `rewardedBreak`, `requestAd(`, `requestBanner`,
  `requestResponsiveBanner` (ADR-013, ADR-024 decision 1).

Portal builds start with no share URL: the adapter takes the portal's own (`PokiSDK.shareableURL`,
CrazyGames `inviteLink`), and if the SDK is blocked the result line is shared with no link. The
build fails if a portal build sets `VITE_SHARE_URL`.

`pnpm e2e:portals` (after both package scripts) serves each zip from a subfolder in a 390×844
iframe, answers its SDK URL with a stub that records every call, and plays a whole run with no
cards. It fails unless every round is wrapped in exactly one `gameplayStart`/`gameplayStop` pair
after the loading event, no ad call is made, no `AudioContext` is created before a user gesture,
and nothing is requested beyond the zip's files and the SDK. CI uploads both zips as an artifact.
Uploading them to the portals is Idan's (`docs/store/portals.md`).

## Test hooks (H1, H4)

From `docs/release/phase-1-test-plan.md` §2.1. They exist only in builds made with
`VITE_TEST_HOOKS=1` (`pnpm build:e2e`, served on port 4174 by the Playwright config). Vite
inlines the flag, so public builds drop the hook code and ignore the URL parameters.

| Hook | Use                                                                                                                                                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1   | `?seed=<u32>` fixes the seed (`seedOverride(location.search)`); `#app[data-seed]` shows it. The run controller will take its seed the same way.                                                                                  |
| H4   | Every `PortalAdapter` call is recorded in order on `window.__portalCalls`. `?portalSpy=poki\|crazygames\|itch` swaps in a stand-in with that portal's identity and no SDK, so a spec checks the §9 call pattern without network. |
