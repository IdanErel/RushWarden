import { MAX_BODY_BYTES, PLATFORMS, validateEvent, type Platform } from './events.js';
import { summarizeSessions } from './sessions.js';
import { D1EventStore, type D1Database, type EventStore } from './store.js';

/** Bindings and vars for the `/ingest` Worker (see `wrangler.toml`). */
export interface IngestEnv {
  /** D1 database with `migrations/0001_ingest_events.sql` applied. */
  DB: D1Database;
  /** "true" to accept events. Anything else (the default) answers 503 and stores nothing. */
  INGEST_ENABLED?: string;
  /** Comma-separated browser origins allowed to send, e.g. `https://*.itch.zone`. */
  ALLOWED_ORIGINS?: string;
  /** Secret for `GET /ingest/sessions` (Worker secret). Unset: the endpoint does not exist. */
  STATS_TOKEN?: string;
  /** Optional Workers rate-limiting binding, keyed by install ID (never by IP). */
  RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

export interface IngestDeps {
  /** The server's clock; its value is the only event time stored (ADR-009). */
  now: () => number;
  /** Defaults to D1 on `env.DB`. */
  store?: EventStore;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function originAllowed(origin: string, allowed: string | undefined): boolean {
  for (const raw of (allowed ?? '').split(',')) {
    const rule = raw.trim();
    if (!rule) continue;
    if (rule === origin) return true;
    // "https://*.itch.zone" matches any subdomain of itch.zone over https, not itch.zone itself.
    const star = rule.indexOf('://*.');
    if (star > 0) {
      const scheme = rule.slice(0, star + 3);
      const suffix = rule.slice(star + 4); // ".itch.zone"
      if (origin.startsWith(scheme) && origin.endsWith(suffix)) {
        const host = origin.slice(scheme.length, origin.length - suffix.length);
        if (/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host)) return true;
      }
    }
  }
  return false;
}

function corsHeaders(origin: string | null): Record<string, string> {
  return origin
    ? {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'POST, DELETE, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '86400',
        vary: 'Origin',
      }
    : { vary: 'Origin' };
}

function reply(status: number, body: string | null, origin: string | null, extra = {}): Response {
  return new Response(body, {
    status,
    headers: { 'cache-control': 'no-store', ...corsHeaders(origin), ...extra },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseTime(v: string | null): number | null {
  if (v === null) return null;
  const t = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * `/ingest` (GDD §10, P1-BE-01). Returns null for paths it does not own.
 *
 * - `POST /ingest`: one event per request (ADR-009: unbatched), validated against the four
 *   ADR-007 events, stored with the server's receipt time. IP addresses are never read or stored.
 * - `DELETE /ingest/:install`: deletes every event of that install (GDPR, GDD §10). Always on.
 * - `GET /ingest/sessions?platform=itch&from=…&to=…` with `Authorization: Bearer <STATS_TOKEN>`:
 *   session count and median length for gate criterion 1 (ADR-010). Aggregates only.
 */
export async function handleIngest(
  request: Request,
  env: IngestEnv,
  deps: IngestDeps,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/ingest' && !url.pathname.startsWith('/ingest/')) return null;
  const store = deps.store ?? new D1EventStore(env.DB);

  const requestOrigin = request.headers.get('origin');
  const origin =
    requestOrigin && originAllowed(requestOrigin, env.ALLOWED_ORIGINS) ? requestOrigin : null;
  if (requestOrigin && !origin) return reply(403, 'origin not allowed', null);

  if (request.method === 'OPTIONS') return reply(204, null, origin);

  if (url.pathname === '/ingest/sessions' && request.method === 'GET') {
    return sessions(request, url, env, store);
  }

  if (url.pathname.startsWith('/ingest/') && request.method === 'DELETE') {
    const install = url.pathname.slice('/ingest/'.length);
    if (!UUID_V4.test(install)) return reply(400, 'not an install id', origin);
    await store.deleteInstall(install);
    return reply(204, null, origin);
  }

  if (url.pathname !== '/ingest') return reply(404, 'not found', origin);
  if (request.method !== 'POST') return reply(405, 'method not allowed', origin, { allow: 'POST' });
  if (env.INGEST_ENABLED !== 'true') return reply(503, 'ingest is off', origin);
  // Browsers always send Origin on a cross-origin POST; requests without one are not the game.
  if (!origin) return reply(403, 'origin required', null);

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return reply(413, 'too large', origin);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES)
    return reply(413, 'too large', origin);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, 'not json', origin);
  }
  const result = validateEvent(body);
  if (!result.ok) return reply(400, result.error, origin);

  if (env.RATE_LIMITER) {
    const { success } = await env.RATE_LIMITER.limit({ key: result.value.install });
    if (!success) return reply(429, 'slow down', origin);
  }

  await store.insert(result.value, deps.now());
  return reply(204, null, origin);
}

async function sessions(
  request: Request,
  url: URL,
  env: IngestEnv,
  store: EventStore,
): Promise<Response> {
  const token = env.STATS_TOKEN;
  if (!token) return reply(404, 'not found', null);
  const auth = request.headers.get('authorization') ?? '';
  if (!timingSafeEqual(auth, `Bearer ${token}`)) return reply(401, 'unauthorized', null);

  const platform = url.searchParams.get('platform');
  const from = parseTime(url.searchParams.get('from'));
  const to = parseTime(url.searchParams.get('to'));
  if (
    !platform ||
    !(PLATFORMS as readonly string[]).includes(platform) ||
    from === null ||
    to === null
  )
    return reply(400, 'need platform, from and to', null);

  const summary = summarizeSessions(await store.listForSessions(platform as Platform, from, to));
  return reply(
    200,
    JSON.stringify({
      platform,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      ...summary,
      medianSeconds: Math.round(summary.medianMs / 1000),
    }),
    null,
    { 'content-type': 'application/json' },
  );
}
