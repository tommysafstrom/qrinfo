// Verify a Cloudflare Access identity JWT (the Cf-Access-Jwt-Assertion header).
//
// WHY verify here, when Access already gates /portal*? Defense in depth. Access
// protects requests routed through it, but the Pages origin can also be reached
// directly (e.g. qrinfo.pages.dev, or any *.<deploy>.pages.dev preview URL),
// which may not sit behind the same Access policy. A portal handler that trusts
// the path alone could then be hit unauthenticated. So we cryptographically
// verify the assertion on every request and only trust the email it carries.
//
// Verification = standard JWT checks against the team's public keys (JWKS):
//   - signature (RS256) against a key from <team>/cdn-cgi/access/certs
//   - aud  matches the Access application's AUD tag (env.ACCESS_AUD)
//   - iss  matches the team domain (env.ACCESS_TEAM_DOMAIN)
//   - exp/nbf within clock skew
// Uses only Web Crypto (available in Pages Functions) — no dependencies.

const b64urlToBytes = (s) => {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const b64urlToJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

// Per-isolate JWKS cache; Access keys rotate slowly.
let jwksCache = { url: null, at: 0, keys: null };

async function getKeys(teamDomain) {
  const url = `${teamDomain.replace(/\/$/, '')}/cdn-cgi/access/certs`;
  const fresh = jwksCache.keys && jwksCache.url === url && Date.now() - jwksCache.at < 3600_000;
  if (fresh) return jwksCache.keys;
  const res = await fetch(url, { cf: { cacheTtl: 3600 } });
  if (!res.ok) throw new Error(`JWKS fetch ${res.status}`);
  const { keys } = await res.json();
  jwksCache = { url, at: Date.now(), keys };
  return keys;
}

async function importKey(jwk) {
  return crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['verify'],
  );
}

/**
 * Verify the Access JWT on a request. Returns { email } on success, or throws.
 * `env` must provide ACCESS_TEAM_DOMAIN and ACCESS_AUD.
 */
export async function verifyAccessJwt(request, env) {
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (!teamDomain || !aud) throw new Error('portal not configured: ACCESS_TEAM_DOMAIN / ACCESS_AUD missing');

  const token =
    request.headers.get('Cf-Access-Jwt-Assertion') ||
    (request.headers.get('cookie') || '').match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
  if (!token) throw new Error('missing Access assertion');

  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const header = b64urlToJson(parts[0]);
  const payload = b64urlToJson(parts[1]);

  // Claims first (cheap) — fail fast before crypto.
  const now = Math.floor(Date.now() / 1000);
  const skew = 60;
  if (payload.iss !== teamDomain.replace(/\/$/, '')) throw new Error('bad iss');
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new Error('bad aud');
  if (payload.exp && now > payload.exp + skew) throw new Error('token expired');
  if (payload.nbf && now < payload.nbf - skew) throw new Error('token not yet valid');

  const jwk = (await getKeys(teamDomain)).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('signing key not found');

  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', await importKey(jwk), b64urlToBytes(parts[2]), data,
  );
  if (!ok) throw new Error('bad signature');

  const email = String(payload.email || '').toLowerCase();
  if (!email) throw new Error('no email in token');
  return { email };
}
