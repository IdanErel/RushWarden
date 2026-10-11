# Store images (Phase 1)

> **DRAFT for Idan's review.** Idan uploads these himself. The team never acts in Steamworks
> or on itch (GDD §13).

Task P1-QA-03. All images are made by code in this repo:

- The map, vehicles and HUD are frames of the game's own renderer (`TrafficScene`), taken from
  the clip tool's replay of a seeded run ([ADR-028](../decisions/ADR-028-clip-tool.md)).
- The wordmark is vector strokes.
- The captions use the clip tool's in-repo 5×7 pixel font.

There are no image files, no system fonts, no stock art and no AI-generated images (GDD §1
constraint 3; Steam AI disclosure in [steam.md](steam.md)).

## Making them

```sh
pnpm --filter @rushwarden/clip store-assets            # → tools/clip/out/store/*.png + manifest.json
pnpm --filter @rushwarden/clip store-assets --only steam-header-920x430,itch-cover-630x500
```

It takes about 40 s. Set `PW_CHROMIUM_PATH` to use a local Chromium. The output is git-ignored,
like every generated image (§7). Two runs on the same machine and Chromium give byte-identical
PNGs, and `manifest.json` lists each file's sha256, the frames used, and the Chromium version.

- Layout: `tools/clip/src/store.ts` (unit-tested in `test/store.test.ts`).
- Drawing: `tools/clip/page/store.ts`.
- Driver: `tools/clip/cli/store.ts`.

## Steam sizes and rules

Sizes and rules come from Steamworks' **Graphical Assets** documentation, which replaces the GDD
§12 table ([ADR-029](../decisions/ADR-029-toy-e2e-ci-and-store-assets.md)):

- Store assets: <https://partner.steamgames.com/doc/store/assets/standard>
- Library assets: <https://partner.steamgames.com/doc/store/assets/libraryassets>

Both pages were read on 2026-10-10 and agree with the Lead's list. The rules that shape the
layouts:

- **Capsules:** no text beyond the game's title, and the logo must be legible. The small
  capsule's logo should nearly fill it.
- **Library hero:** no text at all. Keep the key content inside the centred 860×380 safe area.
- **Library logo:** transparent PNG, logotype only.
- **Page background:** ambient, so it does not compete with the page.
- **Screenshots:** at least 5, 1920×1080 or larger at 16:9, showing gameplay only, with no
  marketing copy or written descriptions.

## What it makes

All frames come from seed 93 (`MARKET_DAY_SEED`). "With cards" is the Market Day round (round 1)
with the clip director's plays (Roundabout and Bus Priority, 246 through against a quota of 177).
"Read the demand" is round 2 of the same run, the Parade. "No cards" is the same
round with nothing played, which gridlocks. The capsules crop the "no cards" map mid-round,
when the queues are building.

| File                                | Size      | Content                                                      |
| ----------------------------------- | --------- | ------------------------------------------------------------ |
| `steam-header-920x430.png`          | 920×430   | Map crop + wordmark plate                                    |
| `steam-small-462x174.png`           | 462×174   | Same, wordmark nearly filling the capsule                    |
| `steam-main-1232x706.png`           | 1232×706  | Same                                                         |
| `steam-vertical-748x896.png`        | 748×896   | Same, wordmark on two lines                                  |
| `steam-background-1438x810.png`     | 1438×810  | Map crop, washed out; no text                                |
| `steam-library-capsule-600x900.png` | 600×900   | Map crop + two-line wordmark                                 |
| `steam-library-header-920x430.png`  | 920×430   | Same layout as the store header                              |
| `steam-library-hero-3840x1240.png`  | 3840×1240 | Map only, rendered at 10×; no text                           |
| `steam-library-logo-1280x720.png`   | 1280×720  | Wordmark on a transparent background                         |
| `promo-1…6-1920x1080.png`           | 1920×1080 | Captioned clip-HUD images for itch, press and social posts   |
| `itch-cover-630x500.png`            | 630×500   | Map crop + two-line wordmark                                 |
| `portal-thumbnail-512x512.png`      | 512×512   | Map crop + two-line wordmark (Poki and CrazyGames)           |
| `portal-cover-1920x1080.png`        | 1920×1080 | Clip frame (HUD) + large wordmark (Poki and CrazyGames 16:9) |

The promo images are **not Steam screenshots**: they carry captions, which Steam does not allow.
Their captions are "Place the rules", "Watch rush hour", "Beat the quota", "Name the jam",
"Gridlock ends it" and "Read the demand".

No frame is enlarged (the manifest's `maxUpscale` is at most 0.914), so nothing is soft.

## Steam screenshots

Steam screenshots must show real gameplay (ADR-029 point 6). They are captured from the run
screen of the web build in its landscape layout (P1-UI-03, #72), at 1920×1080 and device pixel
ratio 1, with no captions, and committed in [`screenshots/`](screenshots/):

```sh
pnpm --filter @rushwarden/platform-web run build        # the public build the preview serves
WEB_E2E_PORT=4831 CI=1 pnpm --filter @rushwarden/platform-web run store-shots
```

`store-shots` is a Playwright spec (`packages/platform-web/e2e/store/`) that plays the toy
through the test hooks, as the e2e does. It exists only with `STORE_SHOTS=1`, so CI never runs
it. The sim is seeded, but each moment is taken by wall-clock time, so a re-run gives the same
scenes, not byte-identical files. Re-capture after any visible UI or render change.

| File                                 | Scene                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `steam-run-1-place-1920x1080.png`    | Market Day, round 1 (seed 93): Roundabout selected, its targets highlighted, the hand and Go button |
| `steam-run-2-rush-1920x1080.png`     | The same round 6 s into Go, with the roundabout placed and the queues building                      |
| `steam-run-3-gridlock-1920x1080.png` | The same round's gridlock and its result: −1 approval                                               |
| `steam-run-4-offer-1920x1080.png`    | Another seed's round 1: quota met and the 3-card offer                                              |
| `steam-run-5-parade-1920x1080.png`   | Its round 2, the Parade, with a street closed                                                       |
| `steam-run-6-run-end-1920x1080.png`  | Its run end, "District held", with the share line                                                   |

The second seed is the lowest whose no-card run passes round 1 and gets furthest (the spec finds
it headlessly), so the run end shows a full row of squares. The cards in those shots are not
played; the first three show cards in use.

## Checks before upload (Idan)

- [ ] **Taste.** Idan reviews the wordmark (a transit-line style on a 4×6 grid, GDD §7) and the
      palette (Old Town).
- [ ] **Same build.** The images, the GIF and the build on itch come from the same commit
      (`manifest.json` and the clip sidecar both record their inputs).
