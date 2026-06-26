# Customer stats portal — hourly WAE→D1 export + per-tenant /portal

Goal: let each customer log in and see scan statistics for **their own** QR codes
(and, later — not built here — change a code's target URL). Decided 2026-06-23.

## Architecture

```
QR scan → /q Pages Function → env.SCANS.writeDataPoint()      (unchanged)
                                      ↓
                         Workers Analytics Engine (qrinfo_scans, ~90d retention)
                                      ↑ hourly SQL
                         ┌────────────┴────────────┐
                         │ Cron Worker  qrinfo-export │  (NEW, separate Worker)
                         │ scheduled() "0 * * * *"    │
                         └────────────┬────────────┘
                                      ↓ idempotent upsert
                         D1 database  qrinfo  ── scan_hourly(day_hour,customer_id,qid,…)
                                      ↑ parameterized, tenant-scoped read
                         ┌────────────┴────────────┐
              customer → │ /portal Pages Functions   │  CF Access OTP → email→customerId
                         └─────────────────────────┘
```

Why export to D1 instead of querying WAE live from the portal:
- **Durable / owned** — survives WAE's ~90-day retention; history kept forever.
- **Safe scoping** — D1 has real parameter binding; the WAE SQL API does not
  (hence the manual integer-validation in `functions/_lib/wae-query.mjs` and
  `admin/lib/stats.mjs`). Tenant scoping becomes `WHERE customer_id = ?`.
- **No live-analytics dependency** on portal page loads.

Trade-off accepted: portal data is up to ~1h stale (shows last completed export).

## Security model (the important part)

- **Cloudflare Access** answers *who* (verified email via One-time PIN). It does
  NOT know which customer they are and CANNOT, by itself, stop customer A from
  reading customer B's numbers.
- **The portal Function** answers *what they may see*: it (1) verifies the
  `Cf-Access-Jwt-Assertion` header (signature against the team JWKS + `aud`),
  defense-in-depth so a direct hit on `qrinfo.pages.dev`/a preview URL can't
  bypass Access; (2) maps the verified email → allowed `customerId`s via a
  server-side map in `_lib/tenants.mjs` (a module in the Function bundle, never
  served publicly); (3) forces those ids into
  the D1 query. The customer never supplies a customerId, so cannot escalate.

## Phases & progress

- [ ] **Phase 0 (manual, Cloudflare):** see `## Phase 0 runbook` below. Creates D1,
      the WAE-read token, and the Access app. Blocks deploy, not code. ← ONLY STEP LEFT
- [x] **Phase 1:** `static/db/schema.sql` — `scan_hourly` + `export_meta`.
- [x] **Phase 2:** `export-worker/` — cron worker: WAE→D1 hourly upsert + one-shot
      backfill + guarded manual-trigger; unit tests for the transform (7 pass).
- [x] **Phase 3:** `static/functions/` — `_lib/access-jwt.mjs`, `_lib/tenants.mjs`
      (a .mjs module, NOT customers.json — keeps the map out of dist/),
      `_lib/d1-stats.mjs`, `portal/index.js`, `portal/data.js`; D1 binding + Access
      vars added to `static/wrangler.toml`; `/portal` added to robots.
- [x] **Phase 4:** docs — `runbooks/metrics.md`, `.env.example`, this file.

## Scope guard

Additive only. The `/q` scan path, WAE itself, `codes.json`, the build, and the
owner-only `/stats` page are untouched. URL-editing is explicitly NOT built; the
same Access + tenant-map layer is designed to be reused for it later.

Tenant-map safety: the map lives in `functions/_lib/tenants.mjs`, a module
compiled into the Function bundle — never served as a static asset. (We avoided a
`customers.json`: in dist/ it would be publicly fetchable; out of dist/ the
Function couldn't read it via env.ASSETS.) `admin/lib/build.mjs` is also
allow-list and never blanket-copies `static/`; don't refactor it into a
copy-everything step without re-checking what reaches dist/.

## Phase 0 runbook (run from `static/` unless noted)

> Replace every `<PLACEHOLDER>` and paste IDs back where the code marks them.

1. **D1 database**
   ```sh
   npx wrangler d1 create qrinfo
   # → copy the printed database_id into:
   #     export-worker/wrangler.toml   (REPLACE <D1_DATABASE_ID>)
   #     static/wrangler.toml          (REPLACE <D1_DATABASE_ID>)
   npx wrangler d1 execute qrinfo --remote --file db/schema.sql
   ```

2. **WAE-read API token** (separate from the deploy token)
   - CF dashboard → My Profile → API Tokens → Create → permission
     **Account · Account Analytics · Read** only. Copy the token.
   - Give it to the export worker as a secret:
     ```sh
     cd ../export-worker
     npx wrangler secret put WAE_SQL_TOKEN     # paste the token
     npx wrangler secret put EXPORT_TRIGGER_TOKEN   # any long random string, for manual /run
     ```
   - The portal Pages Functions already use the existing `WAE_SQL_TOKEN` Pages
     secret only if you keep owner /stats on WAE; the portal itself reads D1 and
     needs no WAE token.
   - **Also rotate `CLOUDFLARE_API_TOKEN`** (it was pasted in chat historically).

3. **Deploy the export worker, then backfill + first run**
   ```sh
   cd export-worker
   npx wrangler deploy
   # one-shot backfill of existing WAE history into D1:
   curl "https://qrinfo-export.<your-workers-subdomain>.workers.dev/run?backfill=1&token=<EXPORT_TRIGGER_TOKEN>"
   # verify rows landed:
   cd ../static && npx wrangler d1 execute qrinfo --remote \
     --command "SELECT COUNT(*) n, MIN(day_hour) first, MAX(day_hour) last FROM scan_hourly"
   ```

4. **Cloudflare Access app for the portal**
   - Zero Trust → Access → Applications → Add → Self-hosted.
   - Domains: `skannamig.com/portal` and `qrinfo.pages.dev/portal` (paths incl. *).
   - Identity / login method: **One-time PIN** (email OTP).
   - Policy: Allow, with the customer emails (or an Access Group you maintain).
   - Note the app **AUD tag** (Application Audience) → put it in
     `static/wrangler.toml` as var `ACCESS_AUD`, and set `ACCESS_TEAM_DOMAIN`
     (e.g. `https://<team>.cloudflareaccess.com`). The portal verifies against these.

5. **Deploy the site** (picks up the new portal Functions + D1 binding)
   ```sh
   cd static && npm run deploy -- <N>
   ```

6. **Populate the tenant map** in `static/functions/_lib/tenants.mjs` (the
   `TENANTS` object) with real email→customerId mappings and redeploy. Keep your
   own email mapped to `'*'`. (It's a module, not a JSON asset, so it never ships
   to dist/.) Each email must also be allowed by the Access policy in step 4.

## Notes / open questions for review

- Cron is hourly (`0 * * * *`). Tighten/loosen later if needed.
- Owner `/stats` left on live WAE; can move to D1 later (independent).
- If volume ever grows enough for WAE sampling to kick in, the export already
  sums `_sample_interval` (not COUNT), so counts stay honest.
