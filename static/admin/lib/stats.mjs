// Reads QR scan stats from Workers Analytics Engine (WAE) via the SQL API.
//
// The /q Pages Function writes one data point per scan (see
// functions/_lib/scan-event.mjs) into the `qrinfo_scans` dataset. Here we query
// that dataset: counts per code over a time window, for the admin stats view.
//
// WAE is sampled, so the honest "how many scans" estimate is SUM(_sample_interval),
// not COUNT() — COUNT() counts the *stored* (sampled) rows. At plaque-scan volumes
// nothing is sampled out, so the two agree, but SUM(_sample_interval) stays correct
// if volume ever grows.
//
// Auth: Bearer CLOUDFLARE_API_TOKEN (needs Account Analytics: Read). Account id
// from CF_ACCOUNT_ID. Both come from static/.env (see .env.example).

const DATASET = process.env.WAE_DATASET || 'qrinfo_scans';

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw httpError(500, `${name} not set — needed for the scan stats view (see .env.example)`);
  return v;
}

// Allow only an integer number of days, then interpolate — the SQL API has no
// parameter binding, so we must never splice untrusted text into the query.
function normalizeDays(days) {
  const n = Math.floor(Number(days));
  if (!Number.isFinite(n) || n < 1 || n > 3650) {
    throw httpError(400, `days must be an integer in 1..3650 (got ${days})`);
  }
  return n;
}

async function runSql(sql) {
  const accountId = requireEnv('CF_ACCOUNT_ID');
  const token = requireEnv('CLOUDFLARE_API_TOKEN');
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'text/plain' },
      body: sql,
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw httpError(502, `WAE SQL request failed: ${err.message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw httpError(res.status === 401 || res.status === 403 ? res.status : 502,
      `WAE SQL API ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw httpError(502, `WAE SQL API returned non-JSON: ${text.slice(0, 200)}`);
  }
}

/**
 * Scan counts per code over the last `days`. Returns rows sorted by scans desc:
 *   [{ id, scans, hits, misses, lastSeen }]
 * `id` is "<customerId>-<qid>"; an unresolved scan lands under id "unknown".
 */
export async function scanCountsByCode({ days = 30 } = {}) {
  const n = normalizeDays(days);
  const sql = `
    SELECT
      blob1 AS id,
      SUM(_sample_interval) AS scans,
      SUM(IF(blob5 = 'hit', _sample_interval, 0)) AS hits,
      SUM(IF(blob5 = 'miss', _sample_interval, 0)) AS misses,
      MAX(timestamp) AS lastSeen
    FROM ${DATASET}
    WHERE timestamp > NOW() - INTERVAL '${n}' DAY
    GROUP BY id
    ORDER BY scans DESC
    FORMAT JSON`;
  const out = await runSql(sql);
  const rows = (out.data ?? []).map(r => ({
    id: r.id,
    scans: Number(r.scans) || 0,
    hits: Number(r.hits) || 0,
    misses: Number(r.misses) || 0,
    lastSeen: r.lastSeen ?? null,
  }));
  return { days: n, dataset: DATASET, rows };
}

/**
 * Daily scan totals over the last `days`, for a simple trend line:
 *   [{ day, scans }]
 */
export async function scanCountsByDay({ days = 30 } = {}) {
  const n = normalizeDays(days);
  const sql = `
    SELECT
      toStartOfDay(timestamp) AS day,
      SUM(_sample_interval) AS scans
    FROM ${DATASET}
    WHERE timestamp > NOW() - INTERVAL '${n}' DAY
    GROUP BY day
    ORDER BY day ASC
    FORMAT JSON`;
  const out = await runSql(sql);
  const rows = (out.data ?? []).map(r => ({ day: r.day, scans: Number(r.scans) || 0 }));
  return { days: n, dataset: DATASET, rows };
}
