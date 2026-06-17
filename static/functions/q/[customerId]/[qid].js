// Cloudflare Pages Function for /q/<customerId>/<qid>.
//
// Replaces the static _redirects "/q/... -> /scan.html" rule on the Cloudflare
// target so we get a server-side hook to record the scan. (The CF-target build
// omits those /q rules — see admin/lib/build.mjs emitRedirects + buildOpts.)
//
// Behaviour, matching the old Pi serve.mjs:
//   hit  -> 302 to /scan.html?c=<customerId>&q=<qid>
//   miss -> 302 to /not-found.html
// and, fire-and-forget, write one Workers Analytics Engine data point per scan.
//
// Bindings (configured in the Pages project + wrangler.toml):
//   env.SCANS  — Analytics Engine dataset (var name SCANS)
//   env.ASSETS — static asset fetcher (Pages provides this automatically)
// Vars:
//   env.QRINFO_ENV — local | staging | production (optional label)

import { recordScan } from '../../_lib/scan-event.mjs';

// Cache the slim registry per isolate; codes.json changes only on redeploy.
let registryPromise = null;

async function loadRegistry(env, origin) {
  if (!registryPromise) {
    registryPromise = (async () => {
      // Prefer the asset binding; fall back to a same-origin fetch in dev.
      const req = new Request(`${origin}/codes.json`, { cf: { cacheTtl: 300 } });
      const res = env.ASSETS ? await env.ASSETS.fetch(req) : await fetch(req);
      if (!res.ok) throw new Error(`codes.json ${res.status}`);
      const doc = await res.json();
      const map = new Map();
      for (const c of doc.codes ?? []) {
        map.set(`${c.customerId}/${c.qid}`, c);
      }
      return map;
    })().catch(err => {
      registryPromise = null; // allow retry on next request
      throw err;
    });
  }
  return registryPromise;
}

async function readVersion(env, origin) {
  try {
    const req = new Request(`${origin}/version.json`, { cf: { cacheTtl: 300 } });
    const res = env.ASSETS ? await env.ASSETS.fetch(req) : await fetch(req);
    if (!res.ok) return null;
    const v = await res.json();
    return v.tag ?? v.ref ?? v.version ?? null;
  } catch {
    return null;
  }
}

export async function onRequestGet({ params, env, request }) {
  const customerId = String(params.customerId);
  const qid = String(params.qid);
  const origin = new URL(request.url).origin;

  let code = null;
  try {
    const registry = await loadRegistry(env, origin);
    code = registry.get(`${customerId}/${qid}`) ?? null;
  } catch {
    // If the registry can't be read, still redirect — never 500 a scan.
    code = null;
  }

  const hit = Boolean(code);
  const id = hit ? `${code.customerId}-${code.qid}` : `${customerId}-${qid}`;
  const version = await readVersion(env, origin);

  recordScan(env.SCANS, {
    id,
    customerId,
    qid,
    type: code?.type,
    hit,
    env: env.QRINFO_ENV ?? '',
    version,
  });

  return redirectFor(code, customerId, qid);
}

// HEAD (uptime checks, bots, link previewers): mirror the redirect so the route
// behaves consistently, but DON'T record a scan — it isn't a real visit. We still
// resolve the code so a HEAD hit/miss redirects to the same place a GET would.
export async function onRequestHead({ params, env, request }) {
  const customerId = String(params.customerId);
  const qid = String(params.qid);
  const origin = new URL(request.url).origin;
  let code = null;
  try {
    const registry = await loadRegistry(env, origin);
    code = registry.get(`${customerId}/${qid}`) ?? null;
  } catch {
    code = null;
  }
  return redirectFor(code, customerId, qid);
}

function redirectFor(code, customerId, qid) {
  const location = code
    ? `/scan.html?c=${encodeURIComponent(customerId)}&q=${encodeURIComponent(qid)}`
    : '/not-found.html';
  return new Response(null, { status: 302, headers: { location } });
}
