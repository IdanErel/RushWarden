-- ADR-025 point 4: anonymous daily aggregates, kept after the raw events are purged (90 days).
-- No install ID column, and a row exists only when it covers at least 10 installs.
CREATE TABLE IF NOT EXISTS daily_rollups (
  day TEXT NOT NULL,            -- UTC date, YYYY-MM-DD
  platform TEXT NOT NULL,
  installs INTEGER NOT NULL,
  sessions INTEGER NOT NULL,
  median_ms INTEGER NOT NULL,
  p25_ms INTEGER NOT NULL,
  p75_ms INTEGER NOT NULL,
  app_open INTEGER NOT NULL,
  run_start INTEGER NOT NULL,
  round_end INTEGER NOT NULL,
  run_end INTEGER NOT NULL,
  PRIMARY KEY (day, platform)
);

-- Daily purge of raw events by receipt time.
CREATE INDEX IF NOT EXISTS events_time ON events (received_at);
