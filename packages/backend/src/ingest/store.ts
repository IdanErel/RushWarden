import type { AnalyticsEvent, EventName, Platform } from '@rushwarden/app';
import type { DailyRollup } from './retention.js';

/**
 * The slice of Cloudflare's D1 binding we use. Declared here so the package needs no
 * `@cloudflare/workers-types` dependency; tests run the same SQL on `node:sqlite`.
 */
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

/** One stored row. There is no IP address field. */
export interface StoredEvent {
  receivedAt: number;
  install: string;
  event: EventName;
}

export interface EventStore {
  insert(event: AnalyticsEvent, receivedAt: number): Promise<void>;
  /** Events on `platform` with `from <= receivedAt < to`, ordered by install then time. */
  listForSessions(platform: Platform, from: number, to: number): Promise<StoredEvent[]>;
  deleteInstall(install: string): Promise<void>;
  /** Deletes raw events received before `time` (ADR-025: 90-day retention). */
  purgeBefore(time: number): Promise<void>;
  /** Stores (or replaces) one anonymous daily row. */
  saveRollup(row: DailyRollup): Promise<void>;
}

export class D1EventStore implements EventStore {
  constructor(private readonly db: D1Database) {}

  async insert(e: AnalyticsEvent, receivedAt: number): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO events (received_at, install, platform, version, locale, device_class, event, props) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        receivedAt,
        e.install,
        e.platform,
        e.version,
        e.locale,
        e.deviceClass,
        e.event,
        JSON.stringify(e.props),
      )
      .run();
  }

  async listForSessions(platform: Platform, from: number, to: number): Promise<StoredEvent[]> {
    const { results } = await this.db
      .prepare(
        'SELECT received_at, install, event FROM events WHERE platform = ? AND received_at >= ? AND received_at < ? ORDER BY install, received_at, id',
      )
      .bind(platform, from, to)
      .all<{ received_at: number; install: string; event: EventName }>();
    return results.map((r) => ({ receivedAt: r.received_at, install: r.install, event: r.event }));
  }

  async deleteInstall(install: string): Promise<void> {
    await this.db.prepare('DELETE FROM events WHERE install = ?').bind(install).run();
  }

  async purgeBefore(time: number): Promise<void> {
    await this.db.prepare('DELETE FROM events WHERE received_at < ?').bind(time).run();
  }

  async saveRollup(r: DailyRollup): Promise<void> {
    await this.db
      .prepare(
        'INSERT OR REPLACE INTO daily_rollups (day, platform, installs, sessions, median_ms, p25_ms, p75_ms, app_open, run_start, round_end, run_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        r.day,
        r.platform,
        r.installs,
        r.sessions,
        r.medianMs,
        r.p25Ms,
        r.p75Ms,
        r.events.app_open,
        r.events.run_start,
        r.events.round_end,
        r.events.run_end,
      )
      .run();
  }
}
