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
pnpm --filter @rushwarden/clip store-assets --only steam-header-460x215,itch-cover-630x500
```

It takes about 40 s. Set `PW_CHROMIUM_PATH` to use a local Chromium. The output is git-ignored,
like every generated image (§7). Two runs on the same machine and Chromium give byte-identical
PNGs, and `manifest.json` lists each file's sha256, the frames used, and the Chromium version.

- Layout: `tools/clip/src/store.ts` (unit-tested in `test/store.test.ts`).
- Drawing: `tools/clip/page/store.ts`.
- Driver: `tools/clip/cli/store.ts`.

## What it makes

All frames come from seed 4. "With cards" is the Market Day round with the clip director's plays
(Delivery Window and Fare Holiday, 155 through against a quota of 60). "No cards" is the same
round with nothing played, which gridlocks.

| File                               | Size      | Content                                                                |
| ---------------------------------- | --------- | ---------------------------------------------------------------------- |
| `steam-header-460x215.png`         | 460×215   | Map crop (no cards, queues building) + wordmark plate                  |
| `steam-small-231x87.png`           | 231×87    | Same, wordmark filling the capsule                                     |
| `steam-main-616x353.png`           | 616×353   | Same                                                                   |
| `steam-vertical-374x448.png`       | 374×448   | Same, wordmark on two lines                                            |
| `steam-hero-3840x1240.png`         | 3840×1240 | Map only, rendered at 10× (Steam: no text or logo on the library hero) |
| `steam-logo-1280x720.png`          | 1280×720  | Wordmark on transparent background (library logo)                      |
| `steam-screenshot-1-1920x1080.png` | 1920×1080 | "Place the rules": with cards, just after Go                           |
| `steam-screenshot-2-1920x1080.png` | 1920×1080 | "Watch rush hour": with cards, mid-round                               |
| `steam-screenshot-3-1920x1080.png` | 1920×1080 | "Beat the quota": with cards, last frame (Quota met)                   |
| `steam-screenshot-4-1920x1080.png` | 1920×1080 | "Name the jam": no cards, mid-round                                    |
| `steam-screenshot-5-1920x1080.png` | 1920×1080 | "Gridlock ends it": no cards, last frame (Gridlock)                    |
| `steam-screenshot-6-1920x1080.png` | 1920×1080 | "Read the demand": round 2, mid-round, heat strips on the edges        |
| `itch-cover-630x500.png`           | 630×500   | Map crop + two-line wordmark                                           |

No frame is enlarged (the manifest's `maxUpscale` is at most 0.914), so nothing is soft.

## Checks before upload (Idan)

- [ ] **Sizes.** The sizes are the GDD §12 table. Steam has since changed some capsule sizes;
      for example, newer Steamworks pages ask for a 920×430 header and a 600×900 library
      capsule. Check the sizes Steamworks asks for on the day. A new size is one line in
      `storeAssets()`.
- [ ] **Screenshots show the clip HUD, not the run screen.** The map is the game's renderer,
      but the captions around it are the clip tool's. Steam asks for screenshots of actual
      gameplay. Once P1-WEB-01 puts the run screen in the web build, QA can add screenshots
      captured from the real build (Playwright at 1920×1080). Until then, Idan decides whether
      these are close enough for the "Coming soon" page.
- [ ] **Taste.** Idan reviews the wordmark (a transit-line style on a 4×6 grid, GDD §7) and the
      palette (Old Town).
- [ ] **Same build.** The images, the GIF and the build on itch come from the same commit
      (`manifest.json` and the clip sidecar both record their inputs).
