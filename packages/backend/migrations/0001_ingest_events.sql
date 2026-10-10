-- P1-BE-01: analytics events for the Phase 1 toy (GDD §10, ADR-007, ADR-009).
-- There is no IP address column, and there never will be one (privacy policy, P1-BE-01).
-- received_at is the server's receipt time in ms since the epoch; the client sends no time.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at INTEGER NOT NULL,
  install TEXT NOT NULL,
  platform TEXT NOT NULL,
  version TEXT NOT NULL,
  locale TEXT NOT NULL,
  device_class TEXT NOT NULL,
  event TEXT NOT NULL,
  props TEXT NOT NULL
);

-- Session query: one platform, a time window, grouped by install in time order.
CREATE INDEX IF NOT EXISTS events_platform_time ON events (platform, received_at);
-- Delete-my-data by install ID.
CREATE INDEX IF NOT EXISTS events_install ON events (install);
