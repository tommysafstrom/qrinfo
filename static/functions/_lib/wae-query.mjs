// Query the qrinfo_scans Workers Analytics Engine dataset from a Pages Function.
//
// Shared by the /stats page + its JSON endpoint. Mirrors the SQL in
// admin/lib/stats.mjs, but self-contained (Functions can't import admin/ code).
//
// Auth at the edge uses a CF secret, NOT a code-baked token:
//   env.WAE_SQL_TOKEN  — API token with Account Analytics: Read
//   env.CF_ACCOUNT_ID  — account id (plain var)
// Set via: wrangler pages secret put WAE_SQL_TOKEN

const DATASET = 'qrinfo_scans';

export function normalizeDays(input, fallback = 30) {
  const n = Math.floor(Number(input));
  if (!Number.isFinite(n) || n < 1 || n > 3650) return fallback;
  return n;
}

async function runSql(env, sql) {
  const accountId = env.CF_ACCOUNT_ID;
  const token = env.WAE_SQL_TOKEN;
  if (!accountId || !token) {
    throw new Error('stats not configured: WAE_SQL_TOKEN / CF_ACCOUNT_ID missing');
  }
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'text/plain' },
      body: sql,
      signal: AbortSignal.timeout(15000),
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`WAE SQL ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

// Scan counts per code over the last `days`. Returns rows sorted by scans desc.
export async function scanCountsByCode(env, days) {
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
  const out = await runSql(env, sql);
  const rows = (out.data ?? []).map(r => ({
    id: r.id,
    scans: Number(r.scans) || 0,
    hits: Number(r.hits) || 0,
    misses: Number(r.misses) || 0,
    lastSeen: r.lastSeen ?? null,
  }));
  return { days: n, dataset: DATASET, rows };
}

// Daily hit counts for ONE specific code over the last `days`, for the "when"
// breakdown. `id` is "<customerId>-<qid>". Returns [{ day, scans }] ascending.
export async function dailyForCode(env, id, days) {
  const n = normalizeDays(days);
  // id comes from our own data (blob1); still, only allow the known shape so we
  // never splice arbitrary text into SQL (the API has no parameter binding).
  if (!/^[0-9]+-[0-9]+$/.test(String(id)) && id !== 'unknown') {
    throw new Error(`invalid code id: ${id}`);
  }
  const sql = `
    SELECT
      toStartOfDay(timestamp) AS day,
      SUM(_sample_interval) AS scans
    FROM ${DATASET}
    WHERE timestamp > NOW() - INTERVAL '${n}' DAY AND blob1 = '${id}'
    GROUP BY day
    ORDER BY day ASC
    FORMAT JSON`;
  const out = await runSql(env, sql);
  const rows = (out.data ?? []).map(r => ({ day: r.day, scans: Number(r.scans) || 0 }));
  return { id, days: n, rows };
}
