import type { StoredEvent } from './store.js';

/** ADR-010: a session ends at the last event before a gap of more than 30 minutes. */
export const SESSION_GAP_MS = 30 * 60 * 1000;

export interface SessionSummary {
  sessions: number;
  installs: number;
  /** Median session length in ms (lower median for an even count); 0 when there are none. */
  medianMs: number;
  p25Ms: number;
  p75Ms: number;
}

/**
 * Session lengths per ADR-010 and `docs/release/phase-1-test-plan.md` §4.1: events from one
 * install, from `app_open` to the last event before a gap of more than 30 minutes, timed by the
 * server's receipt time (ADR-009). An `app_open` always starts a new session (a reload). Events
 * that arrive after a gap without a new `app_open` (a tab left open) start a session at their
 * first event. A session with only `app_open` has length 0.
 *
 * `events` must be ordered by install, then receipt time (as `EventStore.listForSessions` is).
 */
export function sessionLengths(events: readonly StoredEvent[]): number[] {
  const lengths: number[] = [];
  let install: string | null = null;
  let start = 0;
  let last = 0;
  for (const e of events) {
    const newSession =
      e.install !== install || e.event === 'app_open' || e.receivedAt - last > SESSION_GAP_MS;
    if (newSession) {
      if (install !== null) lengths.push(last - start);
      install = e.install;
      start = e.receivedAt;
    }
    last = e.receivedAt;
  }
  if (install !== null) lengths.push(last - start);
  return lengths;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  // Nearest-rank: for an even count the median is the lower middle value (conservative for
  // the gate's "strictly greater than 120 s").
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] ?? 0;
}

/** Aggregate only: no install IDs leave this function. */
export function summarizeSessions(events: readonly StoredEvent[]): SessionSummary {
  const lengths = sessionLengths(events).sort((a, b) => a - b);
  return {
    sessions: lengths.length,
    installs: new Set(events.map((e) => e.install)).size,
    medianMs: quantile(lengths, 0.5),
    p25Ms: quantile(lengths, 0.25),
    p75Ms: quantile(lengths, 0.75),
  };
}
