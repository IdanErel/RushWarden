import { handleIngest, type IngestEnv } from './ingest/handler.js';
import { nightly } from './ingest/retention.js';
import { D1EventStore } from './ingest/store.js';

/** Cloudflare Worker entry (`wrangler.toml` `main`). Phase 1 serves only `/ingest`. */
export default {
  async fetch(request: Request, env: IngestEnv): Promise<Response> {
    const response = await handleIngest(request, env, { now: () => Date.now() });
    return response ?? new Response('not found', { status: 404 });
  },
  /** Daily cron (`wrangler.toml` `[triggers]`): roll-up of yesterday, then the 90-day purge. */
  async scheduled(
    _controller: unknown,
    env: IngestEnv,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<void> {
    ctx.waitUntil(nightly(new D1EventStore(env.DB), Date.now()));
  },
};
