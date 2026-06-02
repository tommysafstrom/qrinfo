# QR Info — Metrics via Umami

> Goal: server-side, fire-and-forget **scan analytics** into a self-hosted Umami,
> working identically across **local / staging / production**, with the static-site
> design left intact. Plus build-**version** surfacing so "which version is live" is
> answerable. Uptime monitoring is explicitly a *separate* tool (see Out of scope).

Companion to [static-site.md](static-site.md) and [admin-tool.md](admin-tool.md).
Operator steps live in [../runbooks/metrics.md](../runbooks/metrics.md).

## Status — 2026-06-01

**Phases 1–5 built; Umami is live and the pipeline is proven end-to-end.**
The `serve.mjs` hook emits `qr-scan` / `qr-miss` with `env` + `version`, redirects
unchanged (302), no-op when `UMAMI_HOST` unset. `build.mjs` emits `version.json`.

**Phase 0 decision: native on the Pi** (Docker wasn't installed). Umami v3.1.0 +
PostgreSQL 17 run under pm2 on `192.168.148.4:3001`, website `qrinfo`
(id `636c0305-…`). A real local scan was confirmed in Umami's DB. Full details +
ops in [../runbooks/metrics.md](../runbooks/metrics.md).

Still open: the **live Pi serve services run pre-tracking code** — they emit once
the updated `static/` is deployed (the deploy now forwards `QRINFO_ENV`+`UMAMI_*`).
Also no auto-`.env` loader (export before running). Phases 6 (CF Function) and 8
(dashboards) deferred; uptime out of scope.

---

## Why this shape (decisions recap)

- **Option A — log at redirect time, server-side.** The process that emits the 302
  also fires the event. No interstitial page, so the redirect stays instant and
  **nothing about Umami appears in any client HTML**. (Option B / interstitial is the
  fallback only for a *truly* dumb static host — we never have one as long as
  `serve.mjs` or a CF Function is in the path.)
- **Two emitters, one logic.** The redirect executor differs per environment:
  - `admin/lib/serve.mjs` for **local + Pi** → add a hook in its 302 branch.
  - a **Cloudflare Pages Function** for **CF-hosted** envs → thin adapter, same logic.
  Both call one shared module so the payload/safeguards aren't duplicated.
- **Umami is an isolated, optional observer.** It is *not* on the critical path: if
  Umami is down/slow/compromised, scans still resolve — the event just drops. The
  hook is **env-gated** (no-op unless `UMAMI_HOST` is set) and removable by unsetting
  one variable. This is why hosting it on the (less reliable) Pi is safe: worst case
  is a gap in metrics, never a dead QR code.
- **One Umami website, `env` as a property.** local/staging/production all report to
  the same website; every event carries `env` so one dashboard splits all three.
- **Config-in-code where it can be.** Tracking logic, the Umami `docker-compose`, the
  env→value mapping (`.env.example`), and the CF Function all live in git. Only the
  secrets/IDs (`UMAMI_WEBSITE_ID`, token) live in `.env` / CF project vars. (Umami's
  *in-app* config — saved dashboard views — is not natively IaC; noted in Phase 8.)

---

## Phase 0 — Decision: where Umami runs  ⟵ confirm before building

| Option | Public endpoint | Data lives | Cost | Notes |
|---|---|---|---|---|
| **Pi + docker-compose** (recommended) | LAN now; public later via tunnel | on your Pi | free | own your data, reuse the box; expose only when CF prod lands |
| Umami Cloud | built-in | their servers | free tier (~10k ev/mo) | zero ops; fastest |
| Small VPS / Fly.io | built-in | rented host | free→~$5/mo | own it, public from day one |

Recommendation: **self-host on the Pi**, LAN-only to start. Public exposure
(Cloudflare Tunnel / Tailscale Funnel / Umami Cloud) is only required once a
**CF-hosted prod** is live and the *CF edge / a phone on cellular* must reach Umami
(Phase 6). Until then everything works on the LAN.

---

## Architecture per environment

| Env | Redirect executor | Event emitter | Umami reachability |
|-----|-------------------|---------------|--------------------|
| **local** (`npm run serve`, :8080) | `serve.mjs` | `serve.mjs` hook | `localhost` / LAN |
| **Pi staging/prod** (:8081 / :8080) | `serve.mjs` (pm2) | `serve.mjs` hook | Pi LAN |
| **CF staging/prod** (Pages branches) | CF edge / Pages Function | Pages Function | **public** endpoint |

---

## Phases

### Phase 1 — Stand up Umami (self-host) ✅
**Agent:** `claude` (Sonnet). Independent of code changes → can run parallel to Phase 2/4.
- [x] `ops/docker-compose.yml` committed: `umami` + `postgres`, named volume for PG data
- [x] Bind LAN/loopback only for now (no public ingress yet)
- [x] Bring up; create one website **"qrinfo"**; record its **website id**
- [x] `runbooks/metrics.md`: up/down, where the id comes from, PG volume **backup** note
- [x] Verify the Umami UI loads on the LAN and the website id is captured

### Phase 2 — Shared tracking module ✅
**Agent:** `claude` (Sonnet). Depends on nothing; unblocks Phase 3 & 6.
- [x] `admin/lib/track.mjs` exporting:
  - `buildScanEvent({ slug, target, type, hit, env, version })` → Umami `payload`
    (`name: hit ? 'qr-scan' : 'qr-miss'`, `url: '/q/'+slug`, `data: { slug, target, type, env, version }`)
  - `sendUmami(fetchImpl, { host, websiteId, userAgent, ip, payload, timeoutMs = 1500 })`
- [x] Env reads: `UMAMI_HOST`, `UMAMI_WEBSITE_ID`, `QRINFO_ENV`, `QRINFO_VERSION`
- [x] **No-op** when `UMAMI_HOST` unset; `UMAMI_DEBUG=1` → `console.log` instead of POST (test mode)
- [x] Safeguards baked in: truncate UA (~512), strip CRLF, `AbortSignal.timeout`, `.catch` swallow,
      forward `user-agent` + `x-forwarded-for` so Umami attributes device/geo correctly
- [x] Uses global `fetch` (Node 20 on the Pi) — **no new npm dependency**

### Phase 3 — Hook `serve.mjs` (covers local + Pi today) ✅
**Agent:** `claude` (Sonnet). Depends on Phase 2.
- [x] In the 302 branch (`admin/lib/serve.mjs`, the `if (rule) { … }` block) for
      `pathname.startsWith('/q/')`: fire `sendUmami` **before** `res.end()`, un-awaited
- [x] **hit vs miss:** real code (`/q/<slug>` rule) → `hit:true`; the `/q/*` →
      `not-found.html` fallback → `hit:false` (so we can chart unknown-code scans)
- [x] Client IP: use `req.socket.remoteAddress`; trust an inbound `X-Forwarded-For`
      **only** when `SERVE_TRUST_PROXY=1` (set once nginx fronts it on the Pi)
- [x] Confirm it can never block, throw into the response, or add visible latency

### Phase 4 — Build-version surfacing ✅
**Agent:** `claude` (Sonnet). Independent → parallel with Phase 2.
- [x] `build.mjs` emits `dist/version.json`:
      `{ version (package.json), ref (git sha via git.mjs), tag (release/N if any), builtAt, target }`
- [x] `serve.mjs` reads `dist/version.json` at startup → exposes `QRINFO_VERSION` to events
- [x] (Also the asset an uptime check will assert on later — see Out of scope)

### Phase 5 — Wire env across the three setups ✅
**Agent:** `claude` (Sonnet). Depends on 2–4.
- [x] `.env.example`: add `UMAMI_HOST`, `UMAMI_WEBSITE_ID`, `QRINFO_ENV`,
      `SERVE_TRUST_PROXY`, `UMAMI_DEBUG` (documented, commented defaults)
- [x] `admin/lib/pi-deploy.mjs`: pass `QRINFO_ENV` (`production`/`staging`) + `UMAMI_*`
      into the pm2 start/restart env for `qrinfo-serve` / `qrinfo-staging`
- [x] Local convention: `QRINFO_ENV=local`

### Phase 6 — Cloudflare Pages adapter (do when CF prod goes live)
**Agent:** `claude` (Sonnet). Depends on Phase 2 + 4 + **public** Umami (Phase 0 exposure).
- [ ] `build.mjs` also emits `dist/codes-map.json` (`slug → { target, type }`) for the
      Function to resolve destinations at the edge (it can't parse `_redirects` cleanly)
- [ ] `functions/q/[[code]].js`: look up slug → **302 + `sendUmami`** to the public
      `UMAMI_HOST`; unknown → `not-found.html` + `qr-miss`
- [ ] CF Pages project env vars: `UMAMI_HOST`, `UMAMI_WEBSITE_ID`,
      `QRINFO_ENV=production|staging`
- [ ] Note precedence: Pages Functions handle matched `/q/*` routes; keep `_redirects`
      as the fallback for non-CF hosts. **This is the only CF-specific code — an
      adapter, not lock-in; the app still runs anywhere `serve.mjs` runs.**

### Phase 7 — Verify end-to-end
**Agent:** `claude` with `/verify`.
- [ ] Local: docker-up Umami → `npm run build && npm run serve` → `curl` `/q/tulip`,
      `/q/sunflower`, `/q/ghost`; confirm `qr-scan`×2 + `qr-miss`×1 land with
      `env=local` and `version` populated, and that redirect latency is unchanged
- [ ] Pi dry-run: same against `:8080`, `env` tagged correctly
- [ ] (After Phase 6) scan a real QR from a phone on cellular → event in Umami

### Phase 8 — Dashboards & "other metrics"
**Agent:** `claude` (Sonnet).
- [ ] Umami views: top codes (by `/q/*` url), top destinations (event `data`), env
      breakdown, **miss rate** (`qr-miss`), device/geo, **version adoption**
- [ ] Document the saved views in `runbooks/metrics.md` (flagging that Umami's in-app
      config is not version-controlled — the one config-in-code gap)

---

## Out of scope (separate tool, separate plan)

**Uptime monitoring.** Umami measures *traffic*, not *availability* — it can't tell you
the site is down (no traffic looks the same as no uptime). Track this separately:
Grafana Cloud synthetic monitoring / Better Stack / self-hosted Uptime Kuma, each
hitting `/version.json` to assert both **up** and **which version**. New plan when we
get there.

---

## Files touched

| Action | Path |
|--------|------|
| new | `admin/lib/track.mjs`, `ops/docker-compose.yml`, `runbooks/metrics.md` |
| new (Phase 6) | `functions/q/[[code]].js`, `dist/codes-map.json` (generated) |
| edit | `admin/lib/serve.mjs`, `admin/lib/build.mjs`, `admin/lib/pi-deploy.mjs`, `.env.example` |
| generated | `dist/version.json` |
| deps | none — global `fetch` on Node 20 |

## Open decisions
- **Phase 0:** self-host on Pi (recommended) vs Umami Cloud vs VPS.
- **Prod host:** keep CF Pages as prod (needs Phase 6 Function) **or** run `serve.mjs`
  as the prod/staging server too (one codepath everywhere, no CF-specific code) — ties
  into your "no Cloudflare lock-in" preference. Decoupled from everything before Phase 6.
