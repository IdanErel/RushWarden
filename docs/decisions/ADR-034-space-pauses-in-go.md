# ADR-034: Space pauses and resumes during the Go phase

Status: Proposed · 2026-10-13 · Render/UI (#96, playtest U3). Number to be confirmed by the Lead.

## Context

GDD §8's keyboard map says "Space = Go" and lists Esc for pause. In the Go phase the round is
already running, so Space had no action there. The run screen left the key unclaimed, and the
browser then pressed whichever button had focus. In the 2026-10-13 playtest that meant pause
(or the menu, or sound) depending on what the player had last clicked. Idan saw one press that
did nothing and one "freeze" with no paused state. He expected Space to pause, as it does in
most games and video players.

## Decision

1. **In the place phase, Space is Go**, as in the GDD.
2. **In the Go phase, Space pauses the board, and Space again resumes it.** The menu does not
   open. The board shows "Paused", and the bar's button reads "▶ Resume". Esc and P still open
   the pause menu as before.
3. **Space never answers a result or run-end sheet with Retry.** Only Enter retries, and only
   0.8 s after the sheet appears (U2). A stray Space press from the Go phase cannot skip the run
   summary.
4. The GDD text is left as it is. This ADR records the Go-phase meaning of Space until the GDD's
   §8 map is next revised.

## Consequences

- One key starts a round and pauses it. Players coming from other games find it where they
  expect it.
- In the Go phase the browser never sees Space, so a focused button is no longer pressed by it.
- e2e: `packages/ui/e2e/controls.spec.ts` covers Space pause and resume, and the Space and Enter
  rules on the run end.
