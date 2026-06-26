// Tenant map: verified customer email → the customerId(s) they may see in
// /portal. This is the AUTHORIZATION source of truth.
//
// WHY a .mjs module and not a static customers.json: a module imported by a
// Pages Function is compiled INTO the Function bundle — it is never served as a
// public asset, so the email→customer mapping can't be fetched by anyone. (A
// customers.json under static/ would either leak if placed in dist/, or be
// unreadable by the Function if kept out of dist/.) Edit this file + redeploy
// the site to change who can see what.
//
// Values:
//   "*"            → owner: may see ALL customers
//   number / array → that customerId, or several
//
// SECURITY: the email key here is matched against the *verified* email from the
// Access JWT (see access-jwt.mjs). customerIds come only from this map — never
// from a request parameter — so a logged-in customer cannot read another's data.

const TENANTS = {
  'tommy.safstrom@gmail.com': '*',
  // 'anna@gardencenter.se': 2,
  // 'owner@bigchain.com': [3, 5, 7],
};

/**
 * Resolve a verified email to its allowed scope.
 * Returns { all: true } for the owner, or { customerIds: number[] } otherwise.
 * Returns null if the email is not provisioned (→ caller should 403).
 */
export function scopeForEmail(email) {
  const entry = TENANTS[String(email || '').toLowerCase()];
  if (entry === undefined) return null;
  if (entry === '*') return { all: true };
  const ids = (Array.isArray(entry) ? entry : [entry])
    .map(n => Math.floor(Number(n)))
    .filter(Number.isInteger);
  if (!ids.length) return null;
  return { customerIds: ids };
}
