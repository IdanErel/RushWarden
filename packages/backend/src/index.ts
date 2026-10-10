/**
 * @rushwarden/backend — Cloudflare Workers (GDD §10). Phase 1: the minimal `/ingest` Worker
 * (P1-BE-01), its event schema, the session-length summary, and the browser client.
 */
export const PACKAGE = { name: '@rushwarden/backend', phase: 1 } as const;
export * from './ingest/events.js';
export * from './ingest/sessions.js';
export * from './ingest/client.js';
export { D1EventStore } from './ingest/store.js';
export type { D1Database, D1PreparedStatement, EventStore, StoredEvent } from './ingest/store.js';
export { handleIngest } from './ingest/handler.js';
export type { IngestEnv, IngestDeps } from './ingest/handler.js';
