/**
 * Analytics client and event schema (GDD §6 puts the analytics client in `packages/app`; §10 lists
 * the events). The `/ingest` Worker in `@rushwarden/backend` validates with the same schema.
 */
export * from './events.js';
export * from './client.js';
