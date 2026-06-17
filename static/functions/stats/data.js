// JSON endpoint for the /stats page.
//   GET /stats/data?days=30            -> per-code totals
//   GET /stats/data?days=30&code=2-5   -> daily breakdown for one code
// Returns per-code: { days, dataset, rows:[{id,scans,hits,misses,lastSeen}] }
//         per-code daily: { id, days, rows:[{day,scans}] }
// Protect /stats/* with Cloudflare Access — this exposes scan counts.

import { scanCountsByCode, dailyForCode } from '../_lib/wae-query.mjs';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const days = url.searchParams.get('days');
  const code = url.searchParams.get('code');
  try {
    const result = code
      ? await dailyForCode(env, code, days)
      : await scanCountsByCode(env, days);
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
