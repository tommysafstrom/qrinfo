// qrinfo-export — scheduled Worker: WAE (qrinfo_scans) → D1 (scan_hourly).
//
// - scheduled(): every hour, re-aggregate the trailing EXPORT_WINDOW_HOURS and
//   idempotently upsert into D1. The overlap absorbs WAE's 30–60s ingest lag.
// - fetch(): a guarded manual trigger for testing/backfill —
//     GET /run?token=<EXPORT_TRIGGER_TOKEN>             one normal-window run
//     GET /run?token=...&backfill=1                     one wide BACKFILL run
//   Any other path → 404. Without a valid token → 401.
//
// Bindings (see wrangler.toml): env.DB (D1). Vars: CF_ACCOUNT_ID, WAE_DATASET,
// EXPORT_WINDOW_HOURS, BACKFILL_WINDOW_HOURS. Secrets: WAE_SQL_TOKEN,
// EXPORT_TRIGGER_TOKEN.

import {
  buildAggregateSql,
  rowsFromWaeResult,
  UPSERT_SQL,
  upsertParams,
  normalizeHours,
} from './aggregate.mjs';

async function runWaeSql(env, sql) {
  const accountId = env.CF_ACCOUNT_ID;
  const token = env.WAE_SQL_TOKEN;
  if (!accountId || !token) throw new Error('CF_ACCOUNT_ID / WAE_SQL_TOKEN missing');
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'text/plain' },
      body: sql,
      signal: AbortSignal.timeout(20000),
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`WAE SQL ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

// One export pass over the trailing `hours`. Returns a small summary.
async function exportWindow(env, hours, note) {
  const dataset = env.WAE_DATASET || 'qrinfo_scans';
  const result = await runWaeSql(env, buildAggregateSql(dataset, hours));
  const rows = rowsFromWaeResult(result);

  if (rows.length) {
    // D1 batches run in one implicit transaction — all-or-nothing.
    const stmt = env.DB.prepare(UPSERT_SQL);
    await env.DB.batch(rows.map(r => stmt.bind(...upsertParams(r))));
  }

  await env.DB.prepare(
    `UPDATE export_meta SET last_run_at = ?1, last_window_h = ?2,
       rows_upserted = ?3, note = ?4 WHERE id = 1`,
  ).bind(new Date().toISOString(), normalizeHours(hours), rows.length, note).run();

  return { hours: normalizeHours(hours), rows: rows.length, note };
}

export default {
  // Cron entrypoint.
  async scheduled(event, env, ctx) {
    const hours = env.EXPORT_WINDOW_HOURS ?? 3;
    ctx.waitUntil(
      exportWindow(env, hours, 'scheduled').catch(err => {
        console.error('export failed:', err.message);
        throw err; // surface in the dashboard's cron run log
      }),
    );
  },

  // Guarded manual trigger.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/run') return new Response('not found', { status: 404 });

    const expected = env.EXPORT_TRIGGER_TOKEN;
    const given = url.searchParams.get('token');
    if (!expected || given !== expected) {
      return new Response('unauthorized', { status: 401 });
    }

    const backfill = url.searchParams.get('backfill') === '1';
    const hours = backfill ? (env.BACKFILL_WINDOW_HOURS ?? 2880) : (env.EXPORT_WINDOW_HOURS ?? 3);
    try {
      const summary = await exportWindow(env, hours, backfill ? 'backfill' : 'manual');
      return Response.json({ ok: true, ...summary });
    } catch (err) {
      return Response.json({ ok: false, error: err.message }, { status: 502 });
    }
  },
};
