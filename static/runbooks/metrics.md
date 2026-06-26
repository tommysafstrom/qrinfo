# Operator runbook — metrics

> **Current architecture (Cloudflare):** each `/q/<cid>/<qid>` scan writes one
> Workers Analytics Engine (WAE) data point; the owner `/stats` page reads WAE
> live, and the **customer portal** (`/portal`) reads an hourly export of WAE
> into D1. The Umami/Pi sections further down are the **retired** self-hosted
> path, kept for reference/rollback. See [Customer stats portal](#customer-stats-portal--export-worker) below.

---

## Customer stats portal & export worker

Lets each customer log in and see scan stats for *only their own* QR codes.
Design + Phase-0 runbook: [../plans/customer-portal.md](../plans/customer-portal.md).

**Pieces**
- **D1 `qrinfo`**, table `scan_hourly` — schema in [../db/schema.sql](../db/schema.sql).
- **`export-worker/`** (repo root, *separate Worker*) — cron `0 * * * *` aggregates
  WAE → D1, idempotent upsert. Deploy: `cd export-worker && npx wrangler deploy`.
  Secrets: `WAE_SQL_TOKEN` (Account Analytics: Read), `EXPORT_TRIGGER_TOKEN`.
- **`/portal` Pages Functions** (`static/functions/portal/`) — behind Cloudflare
  Access (One-time PIN). Reads D1, scoped per customer.

**Security model**
- Access proves *who* (verified email). The Function decides *what they see*:
  `functions/_lib/access-jwt.mjs` verifies the Access JWT (signature + `aud`),
  `_lib/tenants.mjs` maps email→customerId(s), `_lib/d1-stats.mjs` binds those ids
  into the D1 query. Customer never supplies a customerId → no cross-tenant reads.
- Grant/revoke a customer: edit the `TENANTS` map in `functions/_lib/tenants.mjs`
  **and** the Access policy, then redeploy the site. `'*'` = owner (sees all).
- `tenants.mjs` is a module compiled into the Function bundle — it is **never**
  served publicly (don't turn it back into a `customers.json` under `dist/`).

**Common ops**
```sh
# manual export run (e.g. after deploy) — token = EXPORT_TRIGGER_TOKEN secret
curl "https://qrinfo-export.<subdomain>.workers.dev/run?token=<TOKEN>"
# one-shot backfill of existing WAE history
curl "https://qrinfo-export.<subdomain>.workers.dev/run?backfill=1&token=<TOKEN>"
# inspect D1
cd static && npx wrangler d1 execute qrinfo --remote \
  --command "SELECT COUNT(*) n, MIN(day_hour), MAX(day_hour) FROM scan_hourly"
cd static && npx wrangler d1 execute qrinfo --remote --command "SELECT * FROM export_meta"
# export-worker logic tests
cd export-worker && npm test
```

**Staleness:** the portal shows the last completed hourly export (≤ ~1 h behind).
Owner `/stats` is live WAE and has no such lag.

---

## (Retired) Umami / Pi path

Scan analytics for the QR site. The redirect server (`serve.mjs`, or later a
Cloudflare Pages Function) fires a **server-side, fire-and-forget** event to
Umami as it produces each 302 — the visitor's browser never talks to Umami, and
nothing about it appears in any page source. If Umami is down the redirect still
works; the event just drops.

Design + phases: [../plans/metrics-umami.md](../plans/metrics-umami.md).

---

## What gets recorded

Every `/q/<code>` hit emits one event to the single Umami **website** `qrinfo`
(all environments report to it; `env` tells them apart):

| Event | When | Useful data |
|-------|------|-------------|
| `qr-scan` | a real, enabled code resolved | `slug`, `target`, `type` (internal/external), `env`, `version` |
| `qr-miss` | unknown/disabled code → `not-found.html` | same shape; `slug` = what was attempted |

`version` comes from `dist/version.json` (emitted at build time); `env` is
`QRINFO_ENV` (`local` / `staging` / `production`).

Each scan **also** sends a bare **pageview** for the same `/q/<code>` URL, so the
codes show up in Umami's native **Pages** panel (website overview → *Pages*, or
the **Breakdown** report with field = *path*). Caveat: pageviews carry no custom
`data`, so the Pages panel **can't split by `env`** — for per-environment counts
use the `qr-scan` event (Events → `qr-scan` → property `slug`/`env`). Umami also
de-dupes repeat pageviews within one session, so the Pages count can read lower
than raw scans; the `qr-scan` event count is the literal scan count.

> **Bot filter:** Umami silently drops events whose `User-Agent` looks like a bot
> — which includes `curl`. Real phones record fine; when testing by hand, pass a
> browser UA (`curl -A 'Mozilla/5.0 …'`) or the event won't appear.

---

## Deployed instance (Pi, native — as built 2026-06-01)

Umami runs **natively** on the Pi (`claudeuser@192.168.148.4`), not in Docker —
Docker wasn't installed and the native route was chosen. Coexists with the
teacher app and the qrinfo serve services.

| Thing | Value |
|-------|-------|
| Admin URL | `http://192.168.148.4:3001` |
| Admin login | user `admin`; password in `~/umami/ADMIN_CREDENTIALS` on the Pi (default `umami` was changed) |
| Website | `qrinfo` — **id `636c0305-a98e-4760-9ed4-4fb828d83c11`** |
| App | Umami **v3.1.0** source in `~/umami`, built with pnpm, run by **pm2 service `umami`** (`PORT=3001 HOSTNAME=0.0.0.0`), `pm2 save`d |
| Database | PostgreSQL 17 (Debian pkg), db `umami` / role `umami`; password in `~/.umami-dbpass` |
| App secrets | `~/umami/.env` (`DATABASE_URL`, `APP_SECRET`) — chmod 600 |

Ports on the Pi: `:80` nginx→teacher · `:3000` teacher Next.js · `:8080`/`:8081`
qrinfo serve · **`:3001` Umami** · `:5432` Postgres (localhost).

Service control:

```bash
ssh claudeuser@192.168.148.4 'pm2 restart umami'     # / stop / logs umami
ssh claudeuser@192.168.148.4 'curl -s http://localhost:3001/api/heartbeat'  # {"ok":true}
```

---

## Point the site at Umami

The serve reads these from its environment (see `.env.example`; `static/.env`
already holds them). **Nothing auto-loads `.env`** — export it (`set -a; . ./.env;
set +a`) or pass inline.

```bash
UMAMI_HOST=http://192.168.148.4:3001       # works from the Pi and the LAN
UMAMI_WEBSITE_ID=636c0305-a98e-4760-9ed4-4fb828d83c11
QRINFO_ENV=local                            # local | staging | production
# SERVE_TRUST_PROXY=1   # only when serve.mjs sits behind nginx/another proxy
# UMAMI_DEBUG=1         # log events to the console instead of POSTing (testing)
```

If `UMAMI_HOST` is unset, tracking is a **no-op** — the site runs exactly as
before.

---

## Verify locally

```bash
# real run — point at Umami; use a BROWSER UA or the bot filter drops the event
UA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1'
UMAMI_HOST=http://192.168.148.4:3001 \
UMAMI_WEBSITE_ID=636c0305-a98e-4760-9ed4-4fb828d83c11 \
QRINFO_ENV=local SERVE_PORT=8099 npm run serve &

curl -s -o /dev/null -A "$UA" http://localhost:8099/q/tulip    # qr-scan
curl -s -o /dev/null -A "$UA" http://localhost:8099/q/ghost    # qr-miss

# confirm it landed (query Postgres on the Pi)
ssh claudeuser@192.168.148.4 "sudo -u postgres psql -d umami -c \
 \"select event_name,url_path,created_at from website_event \
   where website_id='636c0305-a98e-4760-9ed4-4fb828d83c11' order by created_at desc limit 5;\""

# dry run with no Umami — see events on the console instead
UMAMI_DEBUG=1 UMAMI_HOST=x UMAMI_WEBSITE_ID=x npm run serve
```

---

## Per-environment values

| Env | `QRINFO_ENV` | Who emits | Notes |
|-----|--------------|-----------|-------|
| local | `local` | `serve.mjs` | export the vars / pass inline |
| Pi staging (:8081) | `staging` | `serve.mjs` (pm2) | emits **after** the tracking code is deployed (see below) |
| Pi production (:8080) | `production` | `serve.mjs` (pm2) | same |
| CF staging/production | `staging`/`production` | CF Pages Function *(Phase 6, not built)* | needs Umami reachable publicly (tunnel/Cloud) |

> **The live Pi serve services run pre-tracking code** (synced before the hook
> existed). They start emitting once the updated `static/` is deployed — e.g. via
> the admin tool's Pi deploy (which now passes `QRINFO_ENV` + `UMAMI_*` into pm2),
> or a tar+rebuild+`pm2 restart` as in [admin.md](admin.md). Set the `UMAMI_*`
> vars in the deploying shell first so `pi-deploy.mjs` forwards them.

---

## Rebuild / upgrade Umami

```bash
ssh claudeuser@192.168.148.4 'bash -lc "
  export PNPM_HOME=\$HOME/.local/share/pnpm; export PATH=\$PNPM_HOME:\$PATH
  cd ~/umami && git fetch --tags
  git checkout \$(git tag -l v\* --sort=-v:refname | head -1)   # latest release
  pnpm install --frozen-lockfile && pnpm run build              # runs DB migrations
  pm2 restart umami
"'
```

A 4 GB Pi 4 builds it comfortably (~3 GB free RAM was enough; no swap needed). If
a future build OOMs, add a temporary swapfile for the build only.

---

## Maintenance

- **Backups:** `ssh … 'sudo -u postgres pg_dump umami' > umami-$(date +%F).sql`
- **Logs:** `ssh … 'pm2 logs umami --lines 50'`
- **DB data** lives in PostgreSQL (`/var/lib/postgresql/17/main`).

---

## Alternative: Docker

[../ops/docker-compose.yml](../ops/docker-compose.yml) brings up Umami + Postgres
in containers (Umami on :3001). **Not used on the Pi** (no Docker installed) — kept
for a host that has Docker, or local experimentation.

---

## Out of scope here

Uptime monitoring is a *separate* tool — Umami measures traffic, not
availability. See the "Out of scope" note in
[../plans/metrics-umami.md](../plans/metrics-umami.md).
