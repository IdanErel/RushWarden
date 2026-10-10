/**
 * @rushwarden/backend — Cloudflare Workers (GDD §10). Phase 1: the minimal `/ingest` Worker
 * (P1-BE-01) and the session-length summary. The event schema and the browser client live in
 * `@rushwarden/app` (`src/analytics/`), which the Worker imports to validate events.
 */
export const PACKAGE = { name: '@rushwarden/backend', phase: 1 } as const;
export * from './ingest/sessions.js';
export { D1EventStore } from './ingest/store.js';
export * from './ingest/retention.js';
export type { D1Database, D1PreparedStatement, EventStore, StoredEvent } from './ingest/store.js';
export { handleIngest } from './ingest/handler.js';
export type { IngestEnv, IngestDeps } from './ingest/handler.js';
