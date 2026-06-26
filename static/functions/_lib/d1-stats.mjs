// Tenant-scoped reads of the scan_hourly D1 table for the /portal page.
//
// Unlike the WAE SQL API (no parameter binding — see wae-query.mjs), D1 supports
// real bound parameters, so the customer scope is passed as bound values and the
// only thing interpolated is a placeholder list (?,?,...) sized to the scope.
// The customerIds always come from the server-side tenant map, never the client.
//
// `scope` is what scopeForEmail() returns: { all:true } or { customerIds:[...] }.

export function normalizeDays(input, fallback = 30) {
  const n = Math.floor(Number(input));
  if (!Number.isFinite(n) || n < 1 || n > 3650) return fallback;
  return n;
}

// Build the customer-scope WHERE fragment + its bound params. Owner ("all") has
// no customer filter; otherwise an IN list of exactly the allowed ids.
function scopeFilter(scope) {
  if (scope?.all) return { clause: '', params: [] };
  const ids = scope?.customerIds ?? [];
  if (!ids.length) return { clause: 'AND 1 = 0', params: [] }; // see nothing
  const placeholders = ids.map(() => '?').join(',');
  return { clause: `AND customer_id IN (${placeholders})`, params: ids };
}

// Per-code totals over the last `days`, scoped to the tenant.
//   → { days, rows: [{ id, customerId, qid, scans, hits, misses, lastSeen }] }
export async function codeTotals(env, scope, days) {
  const n = normalizeDays(days);
  const { clause, params } = scopeFilter(scope);
  const sql = `
    SELECT customer_id, qid,
           SUM(scans)  AS scans,
           SUM(hits)   AS hits,
           SUM(misses) AS misses,
           MAX(day_hour) AS lastSeen
    FROM scan_hourly
    WHERE day_hour >= ? ${clause}
    GROUP BY customer_id, qid
    ORDER BY scans DESC`;
  const since = sinceIso(n);
  const { results } = await env.DB.prepare(sql).bind(since, ...params).all();
  return {
    days: n,
    rows: (results ?? []).map(r => ({
      id: `${r.customer_id}-${r.qid}`,
      customerId: r.customer_id,
      qid: r.qid,
      scans: Number(r.scans) || 0,
      hits: Number(r.hits) || 0,
      misses: Number(r.misses) || 0,
      lastSeen: r.lastSeen ?? null,
    })),
  };
}

// Parse + validate a "<customerId>-<qid>" id against the tenant scope. Returns
// { customerId, qid } or throws — so a crafted id can't reach another tenant.
function parseScopedId(scope, id) {
  const m = /^(\d+)-(\d+)$/.exec(String(id));
  if (!m) throw new Error(`invalid code id: ${id}`);
  const customerId = Number(m[1]);
  const qid = Number(m[2]);
  if (!scope?.all && !(scope?.customerIds ?? []).includes(customerId)) {
    throw new Error('forbidden');
  }
  return { customerId, qid };
}

// Combined daily scan totals across the tenant's codes, for the graph view.
// `codeIds` (optional) restricts the total to a selected subset — each id is
// validated against scope, so the filter can only ever narrow within what the
// customer may already see. Empty/absent codeIds → all of the tenant's codes.
//   → { days, codeIds, rows: [{ day, scans, hits, misses }] }
export async function dailyTotals(env, scope, days, codeIds) {
  const n = normalizeDays(days);
  const since = sinceIso(n);

  let clause, params;
  if (Array.isArray(codeIds) && codeIds.length) {
    // Restrict to the selected (customer_id, qid) pairs, each scope-checked.
    const pairs = codeIds.map(id => parseScopedId(scope, id));
    const ors = pairs.map(() => '(customer_id = ? AND qid = ?)').join(' OR ');
    clause = `AND (${ors})`;
    params = pairs.flatMap(p => [p.customerId, p.qid]);
  } else {
    // No subset selected → fall back to the whole tenant scope.
    const sf = scopeFilter(scope);
    clause = sf.clause;
    params = sf.params;
  }

  const sql = `
    SELECT substr(day_hour, 1, 10) AS day,
           SUM(scans)  AS scans,
           SUM(hits)   AS hits,
           SUM(misses) AS misses
    FROM scan_hourly
    WHERE day_hour >= ? ${clause}
    GROUP BY day
    ORDER BY day ASC`;
  const { results } = await env.DB.prepare(sql).bind(since, ...params).all();
  return {
    days: n,
    codeIds: Array.isArray(codeIds) ? codeIds : [],
    rows: (results ?? []).map(r => ({
      day: r.day,
      scans: Number(r.scans) || 0,
      hits: Number(r.hits) || 0,
      misses: Number(r.misses) || 0,
    })),
  };
}

// Daily series for ONE code, but only if that code belongs to the tenant. `id`
// is "<customerId>-<qid>"; we re-check the customerId against the scope so a
// crafted id can't read another tenant's code.
//   → { id, days, rows: [{ day, scans }] }
export async function dailyForCode(env, scope, id, days) {
  const n = normalizeDays(days);
  const { customerId, qid } = parseScopedId(scope, id);

  const sql = `
    SELECT substr(day_hour, 1, 10) AS day, SUM(scans) AS scans
    FROM scan_hourly
    WHERE day_hour >= ? AND customer_id = ? AND qid = ?
    GROUP BY day
    ORDER BY day ASC`;
  const { results } = await env.DB.prepare(sql).bind(sinceIso(n), customerId, qid).all();
  return {
    id,
    days: n,
    rows: (results ?? []).map(r => ({ day: r.day, scans: Number(r.scans) || 0 })),
  };
}

// ISO hour bucket `days` ago, matching scan_hourly.day_hour's format.
function sinceIso(days) {
  const d = new Date(Date.now() - days * 86400_000);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
