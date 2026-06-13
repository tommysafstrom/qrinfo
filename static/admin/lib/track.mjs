// Server-side, fire-and-forget Umami event emission for QR scans (Option A).
//
// The redirect executor (serve.mjs, or later the CF Pages Function) calls this
// as it produces the 302. The visitor's browser never talks to Umami, and
// nothing about Umami appears in any client HTML.
//
// Design rules:
//   - Never throw into the caller, never block the redirect (fire-and-forget).
//   - No-op unless host + websiteId are configured.
//   - Pure: this module reads no process.env itself — the caller passes config.
//
// See plans/metrics-umami.md.

const MAX_UA = 512;

// Umami rejects requests without a User-Agent, and a stray CR/LF in a forwarded
// header would corrupt the outbound request (header injection) — strip both and
// cap the length.
function cleanHeader(value, fallback = 'qrinfo') {
  const s = String(value ?? '').replace(/[\r\n]/g, '').trim();
  return (s || fallback).slice(0, MAX_UA);
}

// Build the Umami `payload` for one scan. `hit` distinguishes a resolved code
// (qr-scan) from an unknown/disabled one that fell through to not-found (qr-miss).
// `path` is the public /q/<customerId>/<qid> URL; `id` is its "<cid>-<qid>" form.
export function buildScanEvent({ id, path, target, type, hit, env, version }) {
  return {
    name: hit ? 'qr-scan' : 'qr-miss',
    url: path,
    data: { id, target, type, env, version },
  };
}

// A bare pageview (no `name`) for the same /q/<code> URL, so each scan also shows
// up in Umami's standard Pages/URLs report. Pageviews don't carry custom `data`.
export function buildPageview({ path }) {
  return { url: path };
}

// Fire one event. Returns a promise the caller is expected NOT to await.
export async function sendUmami(
  fetchImpl,
  { host, websiteId, userAgent, ip, payload, timeoutMs = 1500, debug = false },
) {
  if (!host || !websiteId) return; // not configured → no-op

  const body = {
    type: 'event',
    payload: { website: websiteId, ...payload },
  };

  if (debug) {
    console.log('[umami:debug]', JSON.stringify(body));
    return;
  }

  const headers = {
    'content-type': 'application/json',
    'user-agent': cleanHeader(userAgent),
  };
  const fwd = cleanHeader(ip, '');
  if (fwd) headers['x-forwarded-for'] = fwd;

  try {
    await fetchImpl(`${host.replace(/\/+$/, '')}/api/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // analytics must never break a redirect — swallow timeouts, DNS, 4xx/5xx, all of it
  }
}
