import { handleIngest, type IngestEnv } from './ingest/handler.js';

/** Cloudflare Worker entry (`wrangler.toml` `main`). Phase 1 serves only `/ingest`. */
export default {
  async fetch(request: Request, env: IngestEnv): Promise<Response> {
    const response = await handleIngest(request, env, { now: () => Date.now() });
    return response ?? new Response('not found', { status: 404 });
  },
};
