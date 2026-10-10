# ADR-028: The clip tool: replay rendering, determinism, captions and CI

Status: Accepted · 2026-10-10 · Lead (proposed by QA / Release, P1-QA-02)

P1-QA-02 asks for a tool that records "a seeded rush round to a 9:16 GIF and MP4 from the
replay" with "deterministic output from a seed". GDD §2 pillar 5 says the Go phase "must clip
well for a 9:16 video". The brief does not say how the round is chosen and played, how a
browser renderer is made deterministic, how captions are drawn before the §7 font atlas exists,
or where the tool runs in CI. This ADR fixes those details. The tool lives in `tools/clip`.

## Decision

1. **The replay is a run, not a hand-built round.** A clip is a toy run (ADR-007) given by its
   seed plus an optional action list, which is the same thing a save stores (§6: "nothing is
   recorded but inputs"). It is replayed with the run controller (`@rushwarden/app`) and content's
   `setupRound`. By default the clip shows the first rush round: round 5, Market Day.
2. **A clip-local director, not a balance bot.** When a spec has no actions, `src/director.ts`
   plays the run with a fixed one-round lookahead. Each round it plays the card and target that
   most raise that round's throughput (ties go to hand order, then target order), up to the max
   plays. It then presses Go and takes the first offered card. `plays: "none"` leaves the shown
   round unplayed (the "jam" clip). The director exists only to make a deterministic, watchable
   round. It is not one of the §11 drafter bots (`packages/balance`, BAL-02) and its choices say
   nothing about balance. Every render saves its full action list in a `.json` sidecar. Passing
   that sidecar back as `--spec` pins the replay, even if the director or the bots change later.
3. **Determinism.** Frame _i_ is the same picture on every run:
   - **No wall clock.** The clip page replaces `performance.now` with a virtual clock, stops the
     Pixi ticker, and steps it once per video frame (`Ticker.update(now)`).
   - **No worker.** The sim runs on the page thread from the replay. Snapshots are released
     against the virtual clock exactly as `SimClient` releases them (one per 50 ms of sim time,
     or 25 ms at 2×), into the game's own `TrafficScene`.
   - **No GPU differences.** Chromium uses SwiftShader (software WebGL).
   - **No encoder variation.** ffmpeg runs single-threaded with bitexact flags and without
     metadata; libx264 encodes the MP4, and the GIF uses one palette with no dithering.
   - **Parallel rendering is exact.** Frames are rendered in contiguous ranges across several
     browsers. Each browser fast-forwards its scene to its first frame without drawing (the
     Application's render listener is removed for the seek), so the pixels do not depend on the
     worker count.
   - **Checked.** An e2e renders the same clip with 1 and 3 browsers and requires identical frame
     hashes, MP4 bytes and GIF bytes. It also requires the browser's round to have the same final
     hash as `Sim.simulate` in Node.
   - **Limit.** The bytes are reproducible for a given Chromium build (pinned by Playwright) and
     ffmpeg version. Across different CPUs or ffmpeg versions the pixels may differ slightly. The
     round itself (the sim hash) never does.
4. **Captions use an in-repo 5×7 pixel font drawn as rectangles** (`src/font.ts`). §7 names an
   OFL geometric sans rendered to a bitmap atlas by the tooling, and that atlas does not exist
   yet. System fonts differ between machines and would break point 3. The font is authored in
   the repo (§1 constraint 3), so there is no licence to record. It is swapped for the §7 atlas
   when one exists.
5. **What the clip shows.** The frame is 432×768 logical pixels (9:16). It renders at 2.5× to
   1080×1920 for the MP4 (30 fps) and is scaled to 540×960 for the GIF (15 fps). The map is the
   game's own scene with the game's effects (trails, queue pulse, gridlock red and shake,
   heat-strips). Around it the clip shows: the wordmark and district; the round and boss; the
   cards played as chips in their tag colours (so a viewer can name the cause, pillar 1); and
   throughput filling a bar towards the quota mark, with the clock. The clip has a 0.5 s lead on
   the pre-Go map and a 1.5 s hold on the result: "Quota met", "Quota missed" or "Gridlock".
6. **CI.** A separate `Clip` workflow (`.github/workflows/clip.yml`) runs on PRs that touch
   `packages/{sim,render,ui,app,content}`, `tools/clip` or the lockfile, and on every push to
   `main`.
   It has a 15-minute timeout. It installs ffmpeg with apt when the image lacks it, runs the
   determinism e2e, and renders the two Market Day clips. The MP4, GIF and sidecars are uploaded
   as a 14-day artifact. It is a separate workflow because GitHub Actions can path-filter
   workflows, not single jobs, and a full 1080×1920 render (2–4 minutes on a 4-core runner)
   should not eat the `web` job's 15 minutes. There is no apt cache: the only ready-made cache
   step is a third-party Action, which is not worth it in a public repo to save about 30 s.

## Consequences

- When PR #34 adds `TrafficScene.setRound` and `pushControllers`, the clip page uses them
  automatically (it checks for them). Clips then show per-round lanes, closures and live signal
  state like the run screen. The pixels change, and the determinism check is unaffected.
- `TAG_COLOR` in `src/hud.ts` copies the run screen's values (PR #31) until it can be imported.
- Clips are not committed (§7: no image files in the repo). They come from CI artifacts or a
  local `pnpm clip`. Idan posts them; the team never does (§13).
- Content changes (quotas, demand) change what a seed's clip shows. Committed specs
  (`tools/clip/clips/*.json`) hold only a seed, so after content tuning QA re-checks that seed 4
  still shows a jam without cards and a pass with them, and picks a new seed if not.

Alternatives considered: recording the live game with Playwright's video capture. It was
rejected because it is tied to wall-clock time and drops frames, so it is not deterministic.
A GIF encoder written in TypeScript was also considered. It was rejected because ffmpeg is
already needed for the MP4 and its palette quantisation is better.
