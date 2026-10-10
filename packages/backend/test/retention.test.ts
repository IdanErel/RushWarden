import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  MIN_INSTALLS,
  RAW_RETENTION_DAYS,
  nightly,
  rollupDay,
  utcDay,
} from '../src/ingest/retention.js';
import { D1EventStore } from '../src/ingest/store.js';
import type { StoredEvent } from '../src/ingest/store.js';
import { fakeD1 } from './fake-d1.js';
import { VALID } from './fixtures.js';

const install = (i: number) => `3b241101-e2bb-4255-8caf-${i.toString(16).padStart(12, '0')}`;
// 2026-10-10T02:30:00Z, when the cron fires.
const NOW = Date.UTC(2026, 9, 10, 2, 30);
const YESTERDAY = Date.UTC(2026, 9, 9);

function sessionsOf(n: number, start: number): StoredEvent[] {
  const out: StoredEvent[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ install: install(i), receivedAt: start + i * 1000, event: 'app_open' });
    out.push({ install: install(i), receivedAt: start + i * 1000 + 60_000, event: 'run_start' });
  }
  return out;
}

async function seeded(events: StoredEvent[], platform: 'itch' | 'web' = 'itch') {
  const { db, raw } = fakeD1();
  const store = new D1EventStore(db);
  for (const e of events)
    await store.insert({ ...VALID[e.event], install: e.install, platform }, e.receivedAt);
  return { store, raw };
}

describe('rollupDay (ADR-025 point 4)', () => {
  it('drops a day covering fewer than 10 installs', () => {
    expect(MIN_INSTALLS).toBe(10);
    expect(rollupDay('itch', YESTERDAY, sessionsOf(9, YESTERDAY))).toBeNull();
    expect(rollupDay('itch', YESTERDAY, [])).toBeNull();
  });

  it('keeps totals and session figures, never an install ID', () => {
    const row = rollupDay('itch', YESTERDAY, sessionsOf(10, YESTERDAY));
    expect(row).toEqual({
      day: '2026-10-09',
      platform: 'itch',
      installs: 10,
      sessions: 10,
      medianMs: 60_000,
      p25Ms: 60_000,
      p75Ms: 60_000,
      events: { app_open: 10, run_start: 10, round_end: 0, run_end: 0 },
    });
    expect(JSON.stringify(row)).not.toMatch(/3b241101/);
  });
});

describe('nightly job', () => {
  it('rolls up yesterday per platform and stores no install ID', async () => {
    const { store, raw } = await seeded([
      ...sessionsOf(12, YESTERDAY + 1000),
      ...sessionsOf(3, YESTERDAY - DAY_MS), // the day before: not rolled up today
    ]);
    const out = await nightly(store, NOW);
    expect(out.day).toBe(utcDay(YESTERDAY));
    expect(out.rolledUp).toEqual(['itch']);
    const rows = raw.prepare('SELECT * FROM daily_rollups').all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ day: '2026-10-09', platform: 'itch', installs: 12 });
    const columns = raw.prepare('PRAGMA table_info(daily_rollups)').all() as { name: string }[];
    expect(columns.map((c) => c.name)).not.toContain('install');
  });

  it('writes nothing for a platform under the floor', async () => {
    const { store, raw } = await seeded(sessionsOf(9, YESTERDAY + 1000), 'web');
    expect((await nightly(store, NOW)).rolledUp).toEqual([]);
    expect(raw.prepare('SELECT * FROM daily_rollups').all()).toEqual([]);
  });

  it('deletes raw events older than 90 days and keeps the rest; running twice is harmless', async () => {
    const cutoff = NOW - RAW_RETENTION_DAYS * DAY_MS;
    const { store, raw } = await seeded([
      { install: install(1), receivedAt: cutoff - 1, event: 'app_open' },
      { install: install(2), receivedAt: cutoff, event: 'app_open' },
      { install: install(3), receivedAt: NOW - 1000, event: 'app_open' },
    ]);
    expect((await nightly(store, NOW)).purgedBefore).toBe(cutoff);
    await nightly(store, NOW);
    const left = raw.prepare('SELECT received_at FROM events ORDER BY received_at').all();
    expect(left.map((r) => (r as { received_at: number }).received_at)).toEqual([
      cutoff,
      NOW - 1000,
    ]);
  });
});
