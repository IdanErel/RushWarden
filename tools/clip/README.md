# @rushwarden/clip

Renders one round of a seeded toy run, from its replay, to a 9:16 MP4 (1080×1920, 30 fps) and a
GIF (540×960, 15 fps), plus a `.json` sidecar that reproduces it. Task P1-QA-02; decisions in
[ADR-028](../../docs/decisions/ADR-028-clip-tool.md). Owner: QA / Release.

```sh
pnpm clip --spec tools/clip/clips/market-day.json        # seed 11, round 5 Market Day, with cards
pnpm clip --spec tools/clip/clips/market-day-none.json   # the same round with no cards: gridlock
pnpm clip --seed 17 --speed 2 --formats gif              # any seed; 2× speed; GIF only
pnpm clip --spec tools/clip/out/rushwarden-s11-r5.json   # re-render from a sidecar (actions pinned)
pnpm clip --help
```

Outputs go to `tools/clip/out/` (git-ignored). It needs ffmpeg on `PATH`. Set `PW_CHROMIUM_PATH`
to use a local Chromium; otherwise Playwright's own browser is used. A full 1080×1920 clip takes
2–4 minutes on 4 cores, because it is software WebGL by design. `--scale 1` is about 6× faster
for drafts.

## Store images

`pnpm --filter @rushwarden/clip store-assets` renders the Steam capsules, library hero and logo,
six 1920×1080 screenshots and the itch cover (P1-QA-03) to `out/store/`, with a
`manifest.json` of sha256 sums. It uses frames from this page and composes them on a 2D canvas
(`src/store.ts` for the layout, `page/store.ts` for the drawing, `cli/store.ts` for the driver).
See [docs/store/assets.md](../../docs/store/assets.md).

## How it works

| Part               | What it does                                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/director.ts`  | Builds the toy run (ADR-007) from the seed and replays its actions; with no actions, plays it with a fixed one-round lookahead. Not a balance bot (ADR-028 point 2). |
| `src/clip.ts`      | Steps the round tick by tick (snapshots, controller frames, throughput) and gives each frame its HUD state. Pure; runs in Node and the browser.                      |
| `src/timeline.ts`  | Video frame → released tick, as `SimClient` releases them (lead, play, hold).                                                                                        |
| `src/hud.ts`       | Captions as rectangles: round and boss, card chips in tag colours, throughput bar against the quota, outcome.                                                        |
| `src/font.ts`      | The in-repo 5×7 pixel font (ADR-028 point 4).                                                                                                                        |
| `page/main.ts`     | The game's `TrafficScene` plus the HUD, on a virtual clock; `prepare(job)`, `seek(i)`, `frame(i)` → PNG.                                                             |
| `cli/render.ts`    | Builds and serves the page, renders frame ranges in parallel headless Chromiums (SwiftShader), then encodes with ffmpeg (single-threaded, bitexact).                 |
| `e2e/clip.spec.ts` | Two renders with 1 and 3 browsers must be byte-identical; the browser's round hash must equal Node's `Sim.simulate`.                                                 |

## Checks

- `pnpm --filter @rushwarden/clip test`: unit tests (font, timeline, HUD layout, director, clip model, CLI options).
- `pnpm --filter @rushwarden/clip e2e`: the determinism check above, about 1 minute.
- CI: the `Clip` workflow runs both, renders the two Market Day clips, and uploads them as an
  artifact (`rushwarden-clips-<sha>`, kept 14 days).
