# Go-live checklist — qrinfo Pi → Cloudflare Pages

The non-destructive prep is **done in code** (see below). This file is the
sequence of **live** steps for the migration session — the ones that need your
Cloudflare account, DNS, and SSH to the Pi, which Claude can't do for you.

Plan + rationale: [cloud-migration.md](cloud-migration.md). Decisions locked in:
host = **Cloudflare Pages**; analytics = **Workers Analytics Engine** (Cloudflare-
native, replaces the Pi's Umami); **old scan history is discarded** (accepted).

---

## Already prepared (committed code — no live effect yet)

- `functions/q/[customerId]/[qid].js` — Pages Function: records each scan to WAE,
  then 302s (hit → `/scan.html?c=&q=`, miss → `/not-found.html`).
- `functions/_lib/scan-event.mjs` — builds the WAE data point.
- `admin/lib/build.mjs` — on the CF target it **omits** `/q` rules from
  `_redirects` (the Function owns them); keeps them on the Pi target. Verified.
- `admin/lib/wrangler.mjs` — runs wrangler from `static/` so `functions/` +
  `wrangler.toml` are discovered.
- `admin/lib/stats.mjs` + `/api/stats` + the **Stats** tab in the admin UI —
  counts per code over a time window via the WAE SQL API.
- `wrangler.toml` — `pages_build_output_dir=./dist`, WAE binding `SCANS` →
  dataset `qrinfo_scans`.
- `.env.example` — documents the CF + WAE vars.

Verified locally with mocks: CF build emits 0 `/q` rules, Pi build still emits all
of them, `MOCK_WRANGLER=1` deploy runs the full pipeline. No live changes made; the
test's stray local commit was reverted and `release-state.json` is untouched.

---

## Step 1 — Cloudflare dashboard (you)

1. **Create the Pages project** named `qrinfo` (Workers & Pages → Create →
   Pages → **Direct Upload**, since we deploy a prebuilt `dist/`).
2. **Set branches:** production branch = `production`, preview = `staging`
   (matches `CF_PROD_BRANCH`/`CF_STAGING_BRANCH` defaults).
3. **Add the WAE binding:** project → Settings → Bindings → Add → Analytics
   Engine. Variable name `SCANS`, dataset `qrinfo_scans`. (Must match
   `wrangler.toml`.)
4. **Set the env var** for production: Settings → Variables → `QRINFO_ENV=production`.
5. **Create an API token** (My Profile → API Tokens → Create):
   - Permissions: **Account › Cloudflare Pages › Edit**, and
     **Account › Account Analytics › Read** (for the Stats SQL query).
   - Copy the token; note your **Account ID** (dashboard URL or `wrangler whoami`).

## Step 2 — local .env (you)

Edit `static/.env`:
- **Remove / comment** `DEPLOY_TARGET=pi`  ← this flips deploys to wrangler/Pages
  *and* makes the build use the Function for `/q`.
- Add:
  ```
  CF_PAGES_PROJECT=qrinfo
  CLOUDFLARE_API_TOKEN=<token from step 1.5>
  CF_ACCOUNT_ID=<your account id>
  ```
- **Keep** `QR_BASE_URL_PROD=https://skannamig.com` unchanged (no QR regen, no
  reprint).
- Umami vars can stay; they're only read by the Pi target and are now unused.
- Install wrangler: `npm i -g wrangler` (or `npx wrangler`), then `wrangler login`
  (or rely on the API token).

## Step 3 — deploy to pages.dev and verify (NOT skannamig.com yet)

```bash
cd static
MOCK_WRANGLER=1 npm run deploy -- 24     # final dry-run, no upload
npm run deploy -- 24                      # real deploy of release/24 to production branch
```
Verify on the **pages.dev** URL it prints (e.g. `https://qrinfo.pages.dev`):
- `curl -sI https://qrinfo.pages.dev/q/1/1` → `302` to `/scan.html?c=1&q=1`.
- `curl -sI https://qrinfo.pages.dev/q/9/99999` → `302` to `/not-found.html`.
- Load `/`, scan a real plaque against the pages.dev host, open a `hosted/` page.
- In the dashboard, Workers Analytics Engine → dataset `qrinfo_scans` should start
  showing rows after a few scans (allow a short ingestion delay).
- In the admin tool (`npm run admin`) → **Stats** tab → counts appear.

Also run `npm run preview` to confirm the `staging` branch deploy works.

## Step 4 — cut over the domain (you)

1. Pages project → Custom domains → add **skannamig.com** (and `www` if used).
   Cloudflare updates DNS + issues the cert automatically.
2. Re-run the Step 3 curl/scan checks against **https://skannamig.com**.
3. Soak. Rollback during this window = remove the custom domain / re-point DNS to
   the Pi (the Pi is still running until Step 5).

## Step 5 — decommission the Pi (you, after a few days' soak)

Only once WAE is collecting scans and the domain is verified on Pages:
```bash
ssh claudeuser@192.168.148.4
pm2 delete qrinfo-serve qrinfo-staging
pm2 delete umami            # WAE has replaced it; old Umami history is discarded
pm2 save
```
(Leave the Pi-target deploy code in place; it's dormant once `DEPLOY_TARGET=pi`
is gone from `.env`. Delete in a later cleanup if desired.)

## Step 6 — docs + memory (Claude can do this next session)

- Rewrite `DEPLOY.md` (production = Pages; verify URL = skannamig.com; drop Pi/SSH).
- Update `runbooks/admin.md`, `plans/static-site.md`.
- Update agent memory: production now Cloudflare Pages via wrangler (not Pi SSH);
  qrinfo no longer a Pi app.

---

## Known risks / gotchas (carried from the plan)

- **Functions discovery:** with `wrangler pages deploy <dir>`, wrangler compiles a
  `functions/` dir that is a **sibling** of the output dir. We invoke wrangler from
  `static/` (via `wrangler.mjs`), so `static/functions/` + `static/dist/` are
  siblings, and `wrangler.toml` pins `pages_build_output_dir`. **If the Function
  doesn't fire on first deploy** (scans 302 but no WAE rows): confirm wrangler ran
  from `static/`, and check the deploy log says it bundled Functions. Fallback is
  Pages "advanced mode" (`dist/_worker.js`) — not needed if file-based routing works.
- **Analytics history:** WAE counts start at Step 3 cutover; nothing migrates from
  the old Umami (accepted).
- **WAE sampling:** Stats use `SUM(_sample_interval)` — exact at plaque volumes. If
  you ever need audited exact counts, swap the store to D1 (same Function, different
  write target).
- **Rollback after Step 5** is the normal `npm run rollback` (redeploys to Pages).
  The `/q` Function + WAE binding live in project config, not in `dist/`, so a
  content rollback won't touch them (fine — stable infra).
