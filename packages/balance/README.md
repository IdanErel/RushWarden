# @rushwarden/balance

Headless balance runner, drafter bots and report generator (GDD §11, P1-BAL-02, ADR-019).

Owner: Sim Engineer (GDD §13); P1-BAL-02 was built by the Platform Engineer at the Lead's request.
See GDD section 6 for this package's responsibilities.

## Running it

```sh
pnpm --filter @rushwarden/balance run report                       # ADR-010 gate run: 10,000 seeds per bot
pnpm --filter @rushwarden/balance run report -- --seeds 200        # quick run
pnpm --filter @rushwarden/balance run report -- --preset toy --workers 0 --out /tmp/toy.md
```

| Flag        | Default                  | Meaning                                                                   |
| ----------- | ------------------------ | ------------------------------------------------------------------------- |
| `--seeds`   | `10000`                  | Every bot plays run seeds `1..N` (the fixed seed set).                    |
| `--preset`  | `full`                   | `full` = 12-round District 1 runs (gate); `toy` = the 5-round itch run.   |
| `--workers` | CPU count                | Worker threads; `0` runs in-process. The report is identical either way.  |
| `--out`     | `docs/balance/latest.md` | Where the Markdown report goes.                                           |
| `--commit`  | `git rev-parse HEAD`     | Commit named in the report header.                                        |
| `--targets` | `3`                      | Targets per card kind a lookahead bot tries (spread evenly over the map). |
| `--chunk`   | `100`                    | Seeds per worker job. Changes scheduling only, never the records.         |

`report` bundles `src/cli.ts` and `src/worker.ts` into `dist/` with esbuild, then runs them with Node.
The report is formatted with the repo's Prettier settings, so it is committed as generated.

## Public API

| Export                                                        | What it does                                                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `randomBot`, `greedyBot`, `archetypeBot(tag)`, `phase1Bots()` | The §11 Phase 1 drafter bots (ADR-019 point 3). A bot only chooses actions; `step` enforces rules. |
| `runOne(spec, seed)`, `runSeeds(spec, seeds)`                 | Plays full runs with the run controller (`@rushwarden/app`) and returns plain-data `RunRecord`s.   |
| `seedSet(n)`, `canonical(records, botOrder)`                  | The fixed seed set `1..n`; the canonical record order (bot, then seed).                            |
| `splitJobs`, `runJob`, `RunJob`                               | Plain-data jobs a worker thread can rebuild and run.                                               |
| `runJobs(jobs, concurrency, exec, botOrder)`, `workerPool`    | Parallel scheduling; results come back in canonical order whatever the worker count.               |
| `renderReport`, `buildReport`, `formatReport`                 | The §11 report as stable Markdown; `gateCriterion2` is the 35–65% check.                           |
| `CARDS`, `STARTING_DECK`, `CONTENT_ENV`                       | Content's cards, starting deck and `setupRound`, as the runner plays them.                         |

## Example

```ts
import { runSeeds, seedSet, specFor } from '@rushwarden/balance';

const spec = specFor({ bot: 'greedy-throughput', seeds: [], preset: 'full', targetsPerKind: 3 });
const records = runSeeds(spec, seedSet(100));
console.log(records.filter((r) => r.win).length, 'wins of', records.length);
```
