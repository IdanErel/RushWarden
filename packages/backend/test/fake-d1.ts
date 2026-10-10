/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1PreparedStatement } from '../src/ingest/store.js';

/**
 * D1 is SQLite, so tests run the real migration and the real SQL on Node's built-in SQLite
 * behind the slice of the D1 API the store uses. No Wrangler or Miniflare needed.
 */
export function fakeD1(): { db: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  for (const m of ['0001_ingest_events.sql', '0002_daily_rollups.sql'])
    raw.exec(readFileSync(new URL(`../migrations/${m}`, import.meta.url), 'utf8'));
  const prepare = (sql: string, values: unknown[] = []): D1PreparedStatement => ({
    bind: (...v: unknown[]) => prepare(sql, v),
    run: async () => raw.prepare(sql).run(...(values as never[])),
    all: async <T>() => ({ results: raw.prepare(sql).all(...(values as never[])) as T[] }),
  });
  return { db: { prepare: (sql) => prepare(sql) }, raw };
}
