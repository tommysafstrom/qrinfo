-- D1 schema for the qrinfo customer stats portal.
--
-- Populated by the export-worker Cron Worker, which aggregates the qrinfo_scans
-- Workers Analytics Engine dataset into hourly buckets. The /portal Pages
-- Functions read from here with parameterized, tenant-scoped queries.
--
-- Apply with:  wrangler d1 execute qrinfo --remote --file db/schema.sql
-- (drop --remote to apply to the local dev DB used by `wrangler dev`.)

-- One row per (hour, customer, code). Pre-aggregated so the table stays tiny
-- (a code scanned all day = 24 rows, not one row per scan) and portal reads are
-- trivial. day_hour is the UTC start-of-hour ISO string, e.g. 2026-06-23T14:00:00Z.
CREATE TABLE IF NOT EXISTS scan_hourly (
  day_hour    TEXT    NOT NULL,   -- UTC hour bucket, ISO 8601 (toStartOfHour)
  customer_id INTEGER NOT NULL,
  qid         INTEGER NOT NULL,
  scans       INTEGER NOT NULL DEFAULT 0,  -- total recorded scans (hits + misses)
  hits        INTEGER NOT NULL DEFAULT 0,  -- resolved to a real code
  misses      INTEGER NOT NULL DEFAULT 0,  -- code id not found
  PRIMARY KEY (day_hour, customer_id, qid)
);

-- The portal's hottest query is "all rows for one customer over a window".
CREATE INDEX IF NOT EXISTS idx_scan_hourly_customer
  ON scan_hourly (customer_id, day_hour);

-- Single-row bookkeeping so we can see when the export last ran (observability;
-- the export itself is idempotent and does not depend on this to pick a window).
CREATE TABLE IF NOT EXISTS export_meta (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  last_run_at   TEXT,    -- ISO timestamp of the last successful export run
  last_window_h INTEGER, -- how many hours back that run queried
  rows_upserted INTEGER, -- rows touched on the last run
  note          TEXT     -- e.g. "scheduled" | "manual" | "backfill"
);
INSERT OR IGNORE INTO export_meta (id) VALUES (1);
