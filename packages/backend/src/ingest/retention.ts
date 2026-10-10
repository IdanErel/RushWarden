import { PLATFORMS, type EventName, type Platform } from '@rushwarden/app';
import { summarizeSessions } from './sessions.js';
import type { EventStore, StoredEvent } from './store.js';

/** ADR-025 point 4: raw events (with install ID) are kept 90 days from receipt. */
export const RAW_RETENTION_DAYS = 90;
/** ADR-025 point 4: an aggregate covering fewer installs than this is dropped. */
export const MIN_INSTALLS = 10;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** One anonymous daily row: no install ID, at least `MIN_INSTALLS` installs. */
export interface DailyRollup {
  /** UTC date, `YYYY-MM-DD`. */
  day: string;
  platform: Platform;
  installs: number;
  sessions: number;
  medianMs: number;
  p25Ms: number;
  p75Ms: number;
  events: Record<EventName, number>;
}

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The roll-up of one platform's events received on one UTC day, or null when they cover fewer
 * than `MIN_INSTALLS` installs (dropped, so no figure can single anyone out). Sessions are cut
 * at midnight UTC; a session spanning midnight counts as two shorter ones.
 */
export function rollupDay(
  platform: Platform,
  dayStart: number,
  events: readonly StoredEvent[],
): DailyRollup | null {
  const summary = summarizeSessions(events);
  if (summary.installs < MIN_INSTALLS) return null;
  const counts: Record<EventName, number> = { app_open: 0, run_start: 0, round_end: 0, run_end: 0 };
  for (const e of events) counts[e.event] += 1;
  return { day: utcDay(dayStart), platform, ...summary, events: counts };
}

export interface NightlyResult {
  /** UTC day that was rolled up. */
  day: string;
  /** Platforms that got a row (the rest were under the floor or empty). */
  rolledUp: Platform[];
  /** Raw events received before this time were deleted. */
  purgedBefore: number;
}

/**
 * The daily job (Worker cron): rolls up yesterday (UTC) per platform, then deletes raw events
 * older than `RAW_RETENTION_DAYS`. Safe to run more than once a day: the roll-up replaces the
 * day's row and the purge is idempotent.
 */
export async function nightly(store: EventStore, now: number): Promise<NightlyResult> {
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS - DAY_MS;
  const rolledUp: Platform[] = [];
  for (const platform of PLATFORMS) {
    const events = await store.listForSessions(platform, dayStart, dayStart + DAY_MS);
    const row = rollupDay(platform, dayStart, events);
    if (!row) continue;
    await store.saveRollup(row);
    rolledUp.push(platform);
  }
  const purgedBefore = now - RAW_RETENTION_DAYS * DAY_MS;
  await store.purgeBefore(purgedBefore);
  return { day: utcDay(dayStart), rolledUp, purgedBefore };
}
