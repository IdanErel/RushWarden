# @rushwarden/ui

Preact screens for a run: the run screen (place, Go, result, offer, end), pause, and About and
privacy. Also covers i18n, the share line, and test hooks H2, H3 and H5.

Owner: UI Engineer. Section 8 of the GDD defines the screens, and section 13 defines ownership.

## Public API

| Export                                                                    | What it is                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mountGame(el, opts)` / `Game`                                            | Mounts the run screen. Returns an unmount function.                                                                                                                                                                                                |
| `GameOptions`                                                             | `run`, `spawnWorker`, `layout?`, `config?` (`UiConfig`), `privacy?`, `unlock?`, `sound?` (omitted: `createGameSound()`; `null`: no sound), `testHooks?`, `reducedMotion?`, `events?`                                                               |
| `ControllerRun`                                                           | A `RunPort` over the P1-BAL-01 `RunController`. Go sends `roundInput()` to the sim worker and passes the worker's `RoundResult` to `resolve(result)`. The controller emits `run_start`, `round_end` and `run_end` to the `track()` it receives.    |
| `ControllerRunOptions`                                                    | `config` (`RunConfig`), `env` (`RunEnv`), `catalog` (`CardCatalog`: card id and tier to name and text), `analytics?` (`{ track }`, structurally the ingest client)                                                                                 |
| `RunPort`, `RunState`, `UiCard`, ...                                      | The screen's view of a run, from `run/port.ts`                                                                                                                                                                                                     |
| `candidateTargets`, `segmentAt`, `toSimTarget`, `markOf`, `DISTRICT_NAME` | Pure helpers for target and share-mark logic                                                                                                                                                                                                       |
| `UiConfig`, `DEFAULT_CONFIG`                                              | `privacyUrl` and `shareUrl`. Both are empty by default. An empty privacy URL shows "coming soon".                                                                                                                                                  |
| `PrivacyControls`                                                         | The ingest client's consent surface (ADR-025): `install`, `consent`, `setConsent(yes)`, `deletePending?`, `deleteData()`. Pass it only when collection is on; the Privacy panel shows the install ID from it. The UI never makes an ID of its own. |
| `SoundControl`                                                            | `muted`, `started?`, `setSoundOnFromGesture(on)` and `play?(id, options)`. The toggle calls `setSoundOnFromGesture` inside its own click, tap or key handler.                                                                                      |
| `createGameSound`, `SOUND_KEY`, `loadSoundOn`, `saveSoundOn`              | The default `SoundControl` (P1-AUD-01): an `AudioEngine` that starts muted, keeps the on/off choice in localStorage (guarded), unlocks on a gesture and mutes in the background.                                                                   |
| `shareLine`, `shareText`, `copyText`, `MARK_GLYPH`                        | The §5 share line                                                                                                                                                                                                                                  |
| `keyAction`                                                               | The §8 keyboard map: 1–5 select a card, the arrows move the cursor, Enter places, Space is Go, Esc undoes or pauses                                                                                                                                |
| `stateAttributes`                                                         | The pure H2 attribute map                                                                                                                                                                                                                          |
| `ExitCounter`, `t`, `format`, `setLanguage`, `TAG_COLOR`                  | The live counter, i18n (`i18n/en.json`) and tag colours                                                                                                                                                                                            |

### Test hooks (ADR-010, docs/release/phase-1-test-plan.md §2.1)

- **H2:** with `testHooks: true`, a hidden `#game-state` node carries `data-phase`, `data-round`,
  `data-approval`, `data-energy`, `data-hand`, `data-throughput`, `data-quota`, `data-speed`,
  `data-paused`, `data-round-hash`, `data-placed`, `data-selected`, `data-cursor`,
  `data-reduced-motion`, `data-audio`, `data-muted` and, after a gridlock, `data-gridlock-origin`
  (`x,y` of the junction where it started).
- **H3:** every control has an accessible name, and the e2e finds them all by role and name.
- **H5:** `data-target-rects` lists the selected card's valid targets as canvas-relative CSS px
  rects. The keyboard path does the same placements without a pointer.

## Example

```ts
import { toyRunConfig } from '@rushwarden/app';
import { spawnSimWorker } from '@rushwarden/render';
import { ControllerRun, mountGame } from '@rushwarden/ui';

const run = new ControllerRun({
  config: toyRunConfig({ seed, cards }),
  env,
  catalog,
  analytics: ingest,
});
mountGame(document.getElementById('app')!, {
  run,
  spawnWorker: spawnSimWorker,
  // The consent surface, only when collection is on (ADR-025); platform-web builds it with
  // `privacyControlsFor(ingest)`. Sound defaults to `createGameSound()`.
  ...(privacy ? { privacy } : {}),
  config: { privacyUrl: '', shareUrl: '' },
});
```

## Dev page and e2e

- `pnpm --filter @rushwarden/ui dev` serves `dev/`. It runs the real run controller with
  dev-only stand-in cards (`dev/cards.ts`), which are not shipped, on the plus map with fake
  demand. Add `?source=sim` to use the sim worker and its lanes. The page records `track()`
  calls and sound-toggle calls on `window`.
- `pnpm --filter @rushwarden/ui e2e` runs `e2e/run.spec.ts` at phone (390 px) and desktop sizes.
  It covers a full run with the keyboard and pointer, the H2, H3 and H5 hooks, analytics order,
  the sound gesture, and About. Set `PW_CHROMIUM_PATH` to point at a local Chromium.

## Status

UI-01 is done. It still needs these before release:

- content's cards and card text (#12, #14) in place of the dev stand-ins;
- district maps (#19);
- the analytics client (#20).

platform-web does the wiring. It must:

- pass content cards, `catalog` and `env`;
- pass `() => ingest.install`;
- call `setMuted` at boot from saved settings.
