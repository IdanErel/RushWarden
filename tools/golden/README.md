# @gridlock/golden

The golden determinism suite (GDD sections 3 and 11). 200 seeded rounds are simulated and their
final hashes compared with `fixtures/hashes.json`. A mismatch fails CI.

| Command              | What it does                                                                          |
| -------------------- | ------------------------------------------------------------------------------------- |
| `pnpm test`          | Node run (every PR).                                                                  |
| `pnpm test:browsers` | Bundles the runner and checks Chromium, WebKit and Firefox via Playwright (every PR). |
| `pnpm update`        | Regenerates the fixture. Sim Engineer only, in a PR that says why every hash changed. |

Mobile WebView runs (Android emulator, iOS simulator) are nightly; see ADR-003.
