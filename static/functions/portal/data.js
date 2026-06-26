// JSON endpoint for the customer portal. Tenant-scoped scan stats from D1.
//   GET /portal/data?days=30            -> this customer's per-code totals
//   GET /portal/data?days=30&code=2-5   -> daily breakdown for one of their codes
//
// Security chain (all server-side; the client never supplies a customerId):
//   1. verifyAccessJwt  — cryptographically verify the Access identity JWT
//      (defense in depth; don't trust the path being behind Access alone).
//   2. scopeForEmail    — map the verified email → allowed customerId(s).
//   3. d1-stats         — query scan_hourly with that scope bound in.

import { verifyAccessJwt } from '../_lib/access-jwt.mjs';
import { scopeForEmail } from '../_lib/tenants.mjs';
import { codeTotals, dailyForCode } from '../_lib/d1-stats.mjs';

export async function onRequestGet({ request, env }) {
  let email;
  try {
    ({ email } = await verifyAccessJwt(request, env));
  } catch (err) {
    return Response.json({ error: 'unauthorized', detail: err.message }, { status: 401 });
  }

  const scope = scopeForEmail(email);
  if (!scope) {
    return Response.json({ error: 'no access provisioned for this account' }, { status: 403 });
  }

  const url = new URL(request.url);
  const days = url.searchParams.get('days');
  const code = url.searchParams.get('code');
  try {
    const result = code
      ? await dailyForCode(env, scope, code, days)
      : await codeTotals(env, scope, days);
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    const status = err.message === 'forbidden' ? 403 : 502;
    return Response.json({ error: err.message }, { status });
  }
}
