# Plan: migrate qrinfo off the Raspberry Pi → Cloudflare Pages

**Goal:** stop self-hosting and get always-on uptime independent of the home Pi /
network, **without reprinting any plaques** and without changing `skannamig.com`.

**Decision (2026-06-15):** host on **Cloudflare Pages**, not Railway. Reasons:
the production system is a pure static bundle (`dist/` = `_redirects` + HTML + QR
images + a client-side scanner) — a CDN serves it for free with no machine to
maintain, which is exactly the "reliability + stop self-hosting" goal. Railway
would mean running an always-on container to serve static files (wrong tool, and
billed). We already own the `skannamig.com` Cloudflare zone, and the deploy code
**already has a complete wrangler/Pages path** — the Pi is only an override
(`DEPLOY_TARGET=pi`). So this is mostly config + DNS + verification, not new code.

## What's already done (verified in code, 2026-06-15)

- `build.mjs` emits a fully static `dist/`: `_redirects` (CF Pages' native format),
  `index.html`, `not-found.html`, `hosted/`, `scan.html` + `scan.js` + `vendor/`,
  a slim client-side `codes.json`, `qr/`, `version.json`. No runtime server needed.
- `deploy.mjs` / `preview.mjs` / `rollback.mjs` all call `pagesDeploy()` via
  `deploy-target.mjs`, which **defaults to wrangler** (`wrangler.mjs`:
  `wrangler pages deploy <dir> --project-name --branch`). `DEPLOY_TARGET=pi` is
  the override currently set in `static/.env`.
- `.env.example` already documents the full CF variable set (`CF_PAGES_PROJECT`,
  `CLOUDFLARE_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_PROD_BRANCH`/`CF_STAGING_BRANCH`,
  `MOCK_WRANGLER`).
- Release state, tag/rollback stack, and the admin UI are host-agnostic.

## Scan analytics — REQUIRED, and the part that needs real work

Per-scan analytics is a **must-keep** feature: the operator needs to see which
codes are scanned, when, and how many times over a time period. This is the only
part of the migration that isn't lift-and-shift.

Today, `serve.mjs` (the Pi) fires a **server-side Umami event** on every
`/q/<cid>/<qid>` hit via `track.mjs` (`buildScanEvent` → `sendUmami`). When
**Cloudflare Pages** serves `_redirects` natively, the 302 happens at the edge —
there is **no server hook**, so those events stop firing. Also, **Umami itself is
on the Pi** (`UMAMI_HOST=http://192.168.148.4:3001`), the box we're retiring.

**Decision (2026-06-15): Cloudflare-native — Workers Analytics Engine (WAE).**
Keeps everything single-vendor, nothing else to host, truly retires the Pi.
`track.mjs`'s own header anticipates the executor move: *"the redirect executor
(serve.mjs, or later the CF Pages Function)."*

**Verified (2026-06-15):** WAE binds to Pages Functions (dashboard → project
Settings → Bindings → Analytics Engine; or `wrangler.toml`
`[[analytics_engine_datasets]]`). The dataset auto-creates on first
`writeDataPoint`. Query it over the **SQL API** (HTTP POST, JSON out), filtered by
time range and grouped by code id. WAE is built for exactly this: high-cardinality
per-event writes, time-range queries.

How the pieces map:
- **Record:** a Pages Function on `/q/<cid>/<qid>` calls
  `env.SCANS.writeDataPoint({ blobs:[id, customerId, qid, type, target, env],
  indexes:[id] })`, then issues the 302 to `/scan.html?c=&q=` itself (replacing the
  matching `_redirects` rule for `/q/*`).
- **Report:** the admin tool gains a stats view that POSTs to the WAE SQL API
  (`SELECT blob1 AS id, count() ... WHERE timestamp >= ... GROUP BY id`) — counts
  per code over a chosen window. Reuses the admin server we already have.

## Plan

### Phase 1 — Stand up the Cloudflare Pages project (no DNS change yet)
1. Create a Pages project (dashboard or `wrangler pages project create qrinfo`),
   **Direct Upload** style — we deploy a prebuilt `dist/`, not a git-connected build.
2. Create a scoped API token: **Account > Cloudflare Pages: Edit** (+ Account: Read).
3. Record `CF_ACCOUNT_ID`.
4. Set production branch name = `production`, preview branch = `staging`
   (matches `CF_PROD_BRANCH`/`CF_STAGING_BRANCH` defaults in `deploy.mjs`/`preview.mjs`).

### Phase 2 — Flip the local config to the wrangler target
In `static/.env`:
- Remove (or comment) `DEPLOY_TARGET=pi` → `deploy-target.mjs` falls back to wrangler.
- Add `CF_PAGES_PROJECT=qrinfo`, `CLOUDFLARE_API_TOKEN=…`, `CF_ACCOUNT_ID=…`.
- Keep `QR_BASE_URL_PROD=https://skannamig.com` **unchanged** — the hostname stays
  the same, so **QR images need no regeneration and plaques are untouched.**
- Decide Umami vars per Phase 0 (likely remove `UMAMI_HOST`/`UMAMI_WEBSITE_ID`).
- Install wrangler (`npm i -g wrangler`, or add as a dev dep) and `wrangler login`
  (or rely on the API token).

### Phase 3 — Dry-run, then deploy to a *.pages.dev URL (still no DNS change)
1. `MOCK_WRANGLER=1 npm run deploy -- 24` — exercise the flow end-to-end, no upload.
2. Real `npm run deploy -- 24` — deploys current `release/24` to the `production`
   branch. Lands on `https://qrinfo.pages.dev` (and a per-deploy preview URL).
3. Verify against the **pages.dev URL** before touching `skannamig.com`:
   - `curl -sI https://qrinfo.pages.dev/q/1/1` → 302 to `/scan.html?c=1&q=1`.
   - `curl -sI https://qrinfo.pages.dev/q/9/999` → 302 to `/not-found.html`.
   - Load `/`, scan a real plaque against the pages.dev host, confirm `scan.html`
     resolves via the client-side `codes.json`, check a `hosted/` internal page.
4. Run `npm run preview` and confirm the `staging` branch deploy works too.

### Phase 4 — Scan analytics on Cloudflare (REQUIRED — Workers Analytics Engine)
Replace the Pi's server-side Umami tracking with a Pages Function + WAE.

1. **Add the WAE binding** to the Pages project (dashboard → Settings → Bindings →
   Analytics Engine, e.g. variable `SCANS`, dataset `qrinfo_scans`). For local dev
   add `[[analytics_engine_datasets]]` to a `wrangler.toml`.
2. **Recording Function** `functions/q/[customerId]/[qid].js`:
   - Resolve the code from the published `codes.json` (same data `scan.js` uses) to
     get `id`, `type`, `target`, and hit/miss.
   - `env.SCANS.writeDataPoint({ blobs:[id, customerId, qid, type, target, ENV,
     VERSION], indexes:[id] })` — fire-and-forget; never block the redirect.
   - Return `Response.redirect('/scan.html?c=<cid>&q=<qid>', 302)` for a hit, or
     `/not-found.html` for a miss.
   - This Function takes over `/q/*`, so **drop the `/q/...` rules from `_redirects`**
     (or have `emitRedirects` skip them when building for the CF target). Keep the
     `/q/* → /not-found.html` fallback only if the Function doesn't cover misses.
   - Reuse the *shape* of `track.mjs` (`buildScanEvent`) for the field set; the
     transport changes from Umami POST to `writeDataPoint`.
3. **Reporting** — add a stats view to the admin tool:
   - Server route in `admin/server.mjs` that POSTs to the WAE **SQL API**
     (`https://api.cloudflare.com/client/v4/accounts/<acct>/analytics_engine/sql`)
     with the `CLOUDFLARE_API_TOKEN` (needs **Account Analytics: Read**).
   - Query: counts per code over a window, e.g.
     `SELECT blob1 AS id, count() AS scans, max(timestamp) AS last
      FROM qrinfo_scans WHERE timestamp >= NOW() - INTERVAL '30' DAY GROUP BY id
      ORDER BY scans DESC`.
   - Render a simple table (code id · scans · last seen) with a date-range picker.
4. Verify on the pages.dev URL: scan a few codes, then confirm rows appear via the
   SQL API (allow for WAE's short ingestion delay).

> Note: WAE is **sampled/aggregated** analytics, not a guaranteed exact event log.
> For typical plaque-scan volumes counts are effectively exact, but if you ever need
> audited exact counts, swap the store for **D1** (a real SQLite table, one INSERT
> per scan) — same Function, different write target. Flagged so it's a known knob.

### Phase 5 — Cut over skannamig.com DNS
1. In the Cloudflare DNS for `skannamig.com`, repoint the apex/root from the current
   Pi origin (tunnel/origin behind CF today) to the **Pages project** (custom domain
   `skannamig.com` in the Pages project → CF auto-manages the record + cert).
2. Verify on the **real domain**: repeat the Phase 3 curl/scan checks against
   `https://skannamig.com`. Confirm TLS, redirects, scanner, hosted pages.
3. Watch for ~15 min; rollback path is "re-point DNS to Pi" until Phase 6.

### Phase 6 — Decommission the Pi (after a safe soak, e.g. a few days)
**Precondition:** Phase 4 verified — scans are landing in WAE and the admin stats
view shows counts. Only then is `umami` on the Pi safe to retire.
1. Stop/remove pm2 services on the Pi: `qrinfo-serve` (:8080), `qrinfo-staging`
   (:8081), and `umami` (:3001). If you want the historical Umami scan data, export
   it first (it does **not** migrate into WAE — WAE history starts at Phase 4 cutover).
2. Remove the Pi-specific deploy code paths or leave them dormant (low cost to keep:
   `pi-deploy.mjs`, the `DEPLOY_TARGET=pi` branch — harmless once `.env` no longer
   sets it). Recommend keeping them for now; delete in a later cleanup.

### Phase 7 — Docs + memory
1. Rewrite `DEPLOY.md`: production = Cloudflare Pages; deploy = `npm run deploy -- N`
   (wrangler target); rollback unchanged; drop the Pi/SSH sections; verify URL =
   `https://skannamig.com`.
2. Update `static/runbooks/admin.md` and `plans/static-site.md` accordingly.
3. Update agent memory: `project_qrinfo_production_is_static`,
   `feedback_deploy_via_qrinfo_admin_tool` (deploys now go via wrangler/Pages, not
   Pi SSH), and `reference_pi_deployment` (qrinfo no longer a Pi app).

## Risks / notes
- **Analytics history does not carry over:** WAE counts start at the Phase 4 cutover.
  Export Umami first if past scan history matters (Phase 6).
- **Function vs. `_redirects` overlap:** once the `/q/*` Function exists, the static
  `_redirects` `/q/...` rules must be removed for the CF build, or they'll race the
  Function. Build a CF-target variant of `emitRedirects` (or strip them) — note this
  diverges the Pi build from the CF build, so the Pi target may stop tracking once
  changed (acceptable: the Pi is being retired).
- **Redirect count:** `build.mjs` caps at 2000 (CF Pages ~2100 limit). Once `/q/`
  redirects move into the Function, this cap effectively goes away.
- **`cfDeployId` in release-state:** currently `pi-production-…`; will become real
  CF deploy IDs going forward. Old Pi entries stay as historical audit — harmless.
- **No plaque reprint, no QR regen:** guaranteed because `QR_BASE_URL_PROD` and the
  `/q/<cid>/<qid>` path scheme are unchanged.
- **Rollback during migration** is just DNS until Phase 6; after that it's the normal
  `npm run rollback` (now redeploying to Pages). Note the `/q/` Function + WAE binding
  live in the Pages *project config*, not in the `dist/` bundle — a content rollback
  won't revert them (fine; they're stable infra).
