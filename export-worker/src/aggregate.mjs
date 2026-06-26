// Pure helpers for the WAE→D1 export. No network, no bindings — unit-testable.
//
// Mirrors the "pure builder + side-effecting caller" discipline of the Pages
// project's functions/_lib/scan-event.mjs: everything here is a plain
// data-in/data-out function; src/index.mjs does the actual WAE fetch + D1 writes.
//
// WAE column map (must match functions/_lib/scan-event.mjs):
//   blob1 = id "<customerId>-<qid>"   blob2 = customerId   blob3 = qid
//   blob4 = type   blob5 = hit|miss   blob6 = env   blob7 = version

// Clamp an hours value to a sane integer. The WAE SQL API has no parameter
// binding, so anything interpolated into SQL must be a validated integer.
export function normalizeHours(input, fallback = 3) {
  const n = Math.floor(Number(input));
  if (!Number.isFinite(n) || n < 1 || n > 24 * 365 * 10) return fallback;
  return n;
}

// Build the WAE SQL that aggregates the trailing `hours` into hourly buckets per
// (customerId, qid). Only resolved scans (blob2/blob3 numeric) become D1 rows;
// "unknown" misses have no customer to attribute to and are skipped via the
// HAVING-style WHERE on blob2.
export function buildAggregateSql(dataset, hours) {
  const h = normalizeHours(hours);
  return `
    SELECT
      toStartOfHour(timestamp) AS day_hour,
      blob2 AS customer_id,
      blob3 AS qid,
      SUM(_sample_interval) AS scans,
      SUM(IF(blob5 = 'hit', _sample_interval, 0)) AS hits,
      SUM(IF(blob5 = 'miss', _sample_interval, 0)) AS misses
    FROM ${dataset}
    WHERE timestamp > NOW() - INTERVAL '${h}' HOUR
      AND blob2 != '' AND blob3 != ''
    GROUP BY day_hour, customer_id, qid
    FORMAT JSON`;
}

// Format WAE's day_hour value as a stable UTC ISO hour bucket, e.g.
// "2026-06-23T14:00:00Z". WAE returns "2026-06-23 14:00:00"; normalize it so D1
// primary keys are consistent regardless of source formatting.
export function toHourBucket(raw) {
  const s = String(raw).trim().replace(' ', 'T');
  const d = new Date(s.endsWith('Z') ? s : s + 'Z');
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Turn a WAE SQL result (the parsed JSON `{ data: [...] }`) into clean rows ready
// for upsert. Drops rows with a bad hour bucket or non-integer ids. Numbers come
// back from WAE as strings; coerce them.
export function rowsFromWaeResult(result) {
  const out = [];
  for (const r of result?.data ?? []) {
    const day_hour = toHourBucket(r.day_hour);
    const customer_id = Math.floor(Number(r.customer_id));
    const qid = Math.floor(Number(r.qid));
    if (!day_hour || !Number.isInteger(customer_id) || !Number.isInteger(qid)) continue;
    out.push({
      day_hour,
      customer_id,
      qid,
      scans: Math.max(0, Math.round(Number(r.scans) || 0)),
      hits: Math.max(0, Math.round(Number(r.hits) || 0)),
      misses: Math.max(0, Math.round(Number(r.misses) || 0)),
    });
  }
  return out;
}

// The idempotent upsert statement. Re-running over an overlapping window
// REPLACES each bucket's counts (the aggregate is authoritative for that hour),
// so late-arriving WAE data self-heals and nothing is ever double-counted.
export const UPSERT_SQL = `
  INSERT INTO scan_hourly (day_hour, customer_id, qid, scans, hits, misses)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6)
  ON CONFLICT(day_hour, customer_id, qid) DO UPDATE SET
    scans = excluded.scans,
    hits = excluded.hits,
    misses = excluded.misses`;

// Bind params for one upsert row, in UPSERT_SQL's ?1..?6 order.
export function upsertParams(row) {
  return [row.day_hour, row.customer_id, row.qid, row.scans, row.hits, row.misses];
}
