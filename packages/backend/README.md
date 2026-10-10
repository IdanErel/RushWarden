# @rushwarden/backend

Cloudflare Workers: /daily, /leaderboard, /verify, /ingest, /license, /sync.

Owner: Backend Engineer. See GDD section 6 for this package's responsibilities and section 13 for ownership.

Phase 1 ships only the minimal `/ingest` Worker (P1-BE-01). It is not deployed yet; Idan's
steps are in `docs/setup/accounts.md` §6.1.

## Public API

| Export                                | What it does                                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `validateEvent(body)`                 | Accepts only `app_open`, `run_start`, `round_end`, `run_end` (ADR-007) with exactly the GDD §10 fields. Unknown fields are errors.           |
| `createIngestClient(options)`         | Browser client: random install ID in local storage, one `POST` per event (ADR-009), invalid events dropped. `offIngestClient` sends nothing. |
| `handleIngest(request, env, { now })` | The Worker logic. See the routes below.                                                                                                      |
| `D1EventStore`                        | D1 storage of events: receipt time plus the event; no IP column.                                                                             |
| `sessionLengths`, `summarizeSessions` | ADR-010 sessions: from `app_open` to the last event before a gap of more than 30 minutes, timed by receipt time.                             |

Routes (`src/worker.ts`):

| Route                                            | Behaviour                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /ingest`                                   | One event per request, from an `ALLOWED_ORIGINS` origin. Stores it with the server's receipt time. 503 while `INGEST_ENABLED` is not `"true"` (the default). |
| `DELETE /ingest/:install`                        | Deletes every event of one install ID (GDD §10 delete-my-data). Always on.                                                                                   |
| `GET /ingest/sessions?platform=itch&from=…&to=…` | With `Authorization: Bearer <STATS_TOKEN>`: session count, installs, median and quartile session length. Aggregates only. 404 when `STATS_TOKEN` is unset.   |

Privacy rules the tests enforce: the Worker never reads or stores an IP address or any other
request header. The client sends no timestamp. Any field outside GDD §10 is rejected. Adding an
event or a field needs an ADR and a `docs/legal/privacy.md` update in the same PR.

Tests run the real migration and SQL on Node's built-in `node:sqlite` behind a fake D1 binding,
so there is no Wrangler or Miniflare dependency (`test/fake-d1.ts`).

## Example

```ts
import { createIngestClient } from '@rushwarden/backend';

const analytics = createIngestClient({
  endpoint: 'https://api.rushwarden.com/ingest',
  platform: 'itch',
  version: '0.1.0',
  locale: navigator.language,
  deviceClass: 'mid',
  storage: localStorage,
});
analytics.track('run_start', { mayor: 'ada', district: 1, daily: false });
```
