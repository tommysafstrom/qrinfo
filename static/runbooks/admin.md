# Operator runbook — admin tool

How to run the local admin tool day-to-day, and what to do when something
goes wrong. The full design lives in
[../plans/admin-tool.md](../plans/admin-tool.md); this file is the practical
one-pager.

---

## Prerequisites

- **Node 20+** on the laptop.
- **Git** with `origin` pointing at the repo and you signed in (`git push`
  works).
- **A Cloudflare account** with:
  - A Pages project (`CF_PAGES_PROJECT`)
  - Production branch = `production`
  - A preview branch named `staging` (or pick another and set
    `CF_STAGING_BRANCH`)
  - An **Access policy** on `staging.<project>.pages.dev` restricted to your
    email (one-time setup in the CF dashboard → Access → Applications)
- **`wrangler` CLI** installed globally (`npm install -g wrangler`) and
  authenticated (`wrangler login`).
- **Cloudflare API token** with `Account > Cloudflare Pages > Edit` scope.

## One-time local setup

1. `cd static`
2. `cp .env.example .env` and fill in:
   - `CF_PAGES_PROJECT` — your CF Pages project name
   - `CLOUDFLARE_API_TOKEN` — from the CF dashboard
   - `QR_BASE_URL_PROD` — your production hostname (e.g. `https://qr.example.com`)
   - `QR_BASE_URL_STAGING` — staging URL (e.g. `https://staging.<project>.pages.dev`)
3. `npm install`
4. `npm run admin` → terminal prints a localhost URL with a per-launch token,
   and your browser opens to it.

> The URL contains a per-launch random token (e.g.
> `http://127.0.0.1:5173/abc…/`). Keep that tab; don't share the URL.
> Killing and restarting the tool generates a new token.

## Env-var reference

| Variable | Purpose |
|----------|---------|
| `CF_PAGES_PROJECT` | CF Pages project name (required for deploy/preview) |
| `CF_STAGING_BRANCH` | Branch for the dark site (default: `staging`) |
| `CF_PROD_BRANCH` | Branch for production (default: `production`) |
| `CLOUDFLARE_API_TOKEN` | Used by wrangler |
| `QR_BASE_URL_PROD` | Hostname encoded into prod QR images |
| `QR_BASE_URL_STAGING` | Hostname encoded into preview QR images |
| `QR_BASE_URL_LOCAL` | Hostname encoded into local-preview QR images (default `http://localhost:8080`) |
| `OFFLINE=1` | Skip `git push` and use a mock wrangler — for local development |
| `MOCK_WRANGLER=1` | Use the mock wrangler only (still pushes git) |
| `NO_TOKEN=1` | Disable the per-launch URL token (testing only) |
| `NO_OPEN=1` | Don't auto-open the browser |
| `PORT` | Admin server port (default `5173`) |
| `SERVE_HOST` | `npm run serve` bind address (default `0.0.0.0` — set to `127.0.0.1` for loopback only) |
| `SERVE_PORT` | `npm run serve` port (default `8080`) |

---

## Local preview without Cloudflare (`npm run serve`)

Useful for: laptop dev previews, and the Pi-LAN dry run before CF goes
live (see [static-site.md Phase 4.1](../plans/static-site.md)).

```bash
QR_BASE_URL_LOCAL=http://qrpi.local:8080 npm run build
npm run serve
```

- Reads `dist/_redirects` and serves them as real HTTP 302s.
- Serves any static file under `dist/` (QR images, HTML, info pages).
- Falls back to `dist/not-found.html` for anything unmatched.
- Binds to **`0.0.0.0:8080`** by default so phones on the same Wi-Fi
  reach it. Restrict to loopback with `SERVE_HOST=127.0.0.1`.

`npm run serve` only reads `dist/`. To pick up a new code, rebuild and
restart:
```bash
npm run build && pkill -f admin/lib/serve.mjs && npm run serve &
```

For long-running use on the Pi, supervise with pm2 instead (see Phase
4.1 in the static-site plan).

### Pi dry-run setup (as actually performed, 2026-05-31)

Reproducible from this machine to the Pi at `playserver`
(`192.168.148.4`, claudeuser, Debian 13, Node 20.20.2, pm2 7.0.1
pre-installed).

```bash
# 1. push source to Pi (no rsync on this host; tar over ssh works)
ssh claudeuser@192.168.148.4 'rm -rf ~/qrinfo/static && mkdir -p ~/qrinfo/static'
( cd static && tar --exclude=node_modules --exclude=dist --exclude=.env \
                  --exclude=.env.local --exclude=qr -cf - . ) \
  | ssh claudeuser@192.168.148.4 'cd ~/qrinfo/static && tar -xf -'

# 2. install + build with the Pi's LAN URL encoded into the QR images
ssh claudeuser@192.168.148.4 'cd ~/qrinfo/static && npm install'
ssh claudeuser@192.168.148.4 'cd ~/qrinfo/static && \
  QR_BASE_URL_LOCAL=http://192.168.148.4:8080 npm run build'

# 3. run under pm2 (alongside the existing teacher service)
ssh claudeuser@192.168.148.4 'pm2 start ~/qrinfo/static/admin/lib/serve.mjs \
  --name qrinfo-serve --cwd ~/qrinfo/static'
ssh claudeuser@192.168.148.4 'pm2 save'
# (pm2-claudeuser systemd unit was already enabled from the teacher project — no
#  `pm2 startup` needed)
```

Verify from off-Pi:
```bash
curl -sI http://192.168.148.4:8080/q/tulip       # 302 → wikipedia tulip
curl -sI http://192.168.148.4:8080/q/sunflower   # 302 → wikipedia sunflower
curl -sI http://192.168.148.4:8080/q/ghost       # 302 → /not-found.html
curl -sI http://192.168.148.4:8080/qr/tulip.png  # 200 image/png
```

Notes / Pi-specific gotchas:
- **Port 8080 is fine** — Pi already had `:80` (nginx fronting teacher),
  `:3000` (teacher Next.js), `:22`, `:111`. Don't touch those.
- **pm2's systemd unit was already in place** (from the teacher
  deployment), so persisting the new service required only `pm2 save` —
  no `pm2 startup` re-run.
- **The QR image URL is baked at build time.** When you rebuild on the
  Pi, always set `QR_BASE_URL_LOCAL=http://192.168.148.4:8080` so the
  encoded URL points back at the Pi.
- **Reach-from-laptop sanity**: `curl http://192.168.148.4:8080/` should
  return the landing page from any machine on the same Wi-Fi.

To redeploy after editing code locally:
```bash
( cd static && tar --exclude=node_modules --exclude=dist --exclude=.env \
                  --exclude=.env.local --exclude=qr -cf - . ) \
  | ssh claudeuser@192.168.148.4 'cd ~/qrinfo/static && tar -xf -'
ssh claudeuser@192.168.148.4 'cd ~/qrinfo/static && \
  QR_BASE_URL_LOCAL=http://192.168.148.4:8080 npm run build && \
  pm2 restart qrinfo-serve'
```

To tear down (before moving to CF):
```bash
ssh claudeuser@192.168.148.4 'pm2 delete qrinfo-serve qrinfo-staging && pm2 save'
ssh claudeuser@192.168.148.4 'rm -rf ~/qrinfo'
```

### Driving the Pi from the admin tool (DEPLOY_TARGET=pi)

Once Phase 4.1 is up, you can flip the admin tool's deploy/preview/rollback
buttons to land on the Pi instead of Cloudflare. This lets you exercise
the full release flow — including the rollback drill — against real LAN
traffic before CF goes live.

```bash
cd static
OFFLINE=1 \
  DEPLOY_TARGET=pi \
  PI_SSH_HOST=claudeuser@192.168.148.4 \
  QR_BASE_URL_PROD=http://192.168.148.4:8080 \
  QR_BASE_URL_STAGING=http://192.168.148.4:8081 \
  npm run admin
```

What changes:

| Flow | CF target (default) | Pi target |
|------|---------------------|-----------|
| **Preview** | `wrangler pages deploy --branch=staging` | tar code + dist → Pi `~/qrinfo/dist-staging/`, pm2 start/restart `qrinfo-staging` on :8081 |
| **Deploy** | `wrangler pages deploy --branch=production` | same shape → `~/qrinfo/dist-production/`, pm2 restart `qrinfo-serve` on :8080 |
| **Rollback** | re-deploys the target tag via wrangler | re-deploys the target tag via the same pi-deploy path |

`OFFLINE=1` is recommended for the Pi target so `git push` is skipped — local
commits + tags still happen, but origin stays untouched. Once you're happy
with the drill, drop it for real release-state pushes.

Defaults (override via env vars in `.env`):

| Variable | Default |
|----------|---------|
| `PI_REMOTE_ROOT` | `/home/claudeuser/qrinfo` |
| `PI_PROD_PORT` | `8080` |
| `PI_STAGING_PORT` | `8081` |
| `PI_PROD_SERVICE` | `qrinfo-serve` |
| `PI_STAGING_SERVICE` | `qrinfo-staging` |

After a `preview` in pi mode, the staging URL printed in the admin UI is
`http://192.168.148.4:8081`. Phones on the LAN can scan QR codes from there
to test changes before they touch :8080 (production).

To exit pi mode for a session, just don't set `DEPLOY_TARGET` (or set it to
anything other than `pi`) — the admin tool reverts to using wrangler.

---

## Daily flow — make a change and ship it

1. **Edit codes** in the **Codes** view (browser). Use *Add code* or click
   *Edit* on a row. Toggle the enabled badge inline.
2. **Commit** `codes.json` from your shell:
   ```bash
   git -C /home/you/src/qrinfo add static/codes.json
   git -C /home/you/src/qrinfo commit -m "codes: <what changed>"
   ```
3. **Preview** in the **Pending** view → click *Preview on dark site*.
   The tool builds, runs `wrangler pages deploy --branch=staging`, and
   shows the dark-site URL when done. Open it in another tab and verify
   scans / clicks work.
4. **Tag** in the **Release** view. Click *Tag as release/N*. The tool
   creates `git tag release/N HEAD` and pushes the tag.
5. **Deploy** in the **Release** view, on the new tag row, click *Deploy*.
   Watch the progress stream:
   - `snapshot` → in-memory copy of the prior `release-state.json`
   - `build` → from the tag
   - `deploy` → `wrangler pages deploy --branch=production`
   - `state` → atomic write of `release-state.json`
   - `commit` + `push` → audit log persists
6. **Verify** by scanning a real QR with a phone.

## Rollback

1. Open the **Releases** view.
2. The current production is on top; the row immediately below is the
   rollback target (`previous[0]`).
3. Click *Rollback to this*. Confirm.
4. The tool:
   - reads `release-state.json`
   - builds from the target tag
   - `wrangler pages deploy --branch=production` (re-deploys the target's content)
   - atomically pops the stack: `current` becomes the target, `previous`
     loses its first element
   - commits + pushes `release-state.json`

The **popped former-current is dropped from the stack**, but its git tag
remains. To bring it back, go to the **Release** view and click *Deploy*
on that tag row — the current state will be pushed onto previous and the
chosen tag becomes current.

---

## Recovery scenarios

### "Wrangler failed mid-deploy"

Don't panic. The deploy pipeline writes `release-state.json` *only after*
wrangler returns success. If wrangler failed, **nothing about the state
changed**. Fix the cause (Cloudflare token expired, network blip, etc.) and
click *Deploy* again.

### "Push failed after deploy succeeded"

Production is updated; `release-state.json` was written and committed
locally; only the `git push` failed. The progress stream will show the push
phase as `error`. Run `git push` manually from a shell to sync. No data
loss — the state is on disk and in your local git log.

### "I tagged the wrong release number / I want to redo"

Tags are immutable in the model. To redo, allocate the next number:
re-tag at `release/<N+1>` and deploy that instead. The wrong tag stays in
git history but is never deployed.

### "`release-state.json` got into a weird state somehow"

Diagnose: `git log -p static/release-state.json` is the audit log of every
state change. The most recent commit shows what the current state should
be; the working tree shows what it actually is. To revert to the last
known-good state:
```bash
git checkout HEAD -- static/release-state.json
```
Then refresh the **Releases** view in the admin tool.

If CF and `release-state.json` disagree on what's "current" (e.g. someone
deployed via the CF dashboard outside of the tool), the simplest fix is to
re-deploy through the tool: tag a fresh release and deploy it. The state
file will reflect ground truth from that point.

### "Token in URL leaked"

Kill the admin tool (`Ctrl-C`) and restart (`npm run admin`). A new random
token is generated; the old URL stops working.

### "I want to test the deploy flow without touching production"

Run the server with `OFFLINE=1`:
```bash
OFFLINE=1 npm run admin
```
- `git push` is skipped (everything still happens locally — commits, tags
  in `.git`, `release-state.json` updates)
- Wrangler is mocked (it returns a fake CF deploy id and a fake URL)
- The full flow runs end-to-end on disk

To roll back any local-only changes afterward:
```bash
git reset --hard <commit-before-experimenting>
git tag -d release/<n>   # any local-only tags
```

---

## What lives where

| File | Purpose |
|------|---------|
| `static/codes.json` | **Source of truth** — codes the operator manages |
| `static/release-state.json` | Live `current` / `previous` stack — mutated by deploy/rollback |
| `static/dist/` | Build artifact (gitignored) — what wrangler uploads |
| `static/.env` | Local-only secrets (gitignored) |
| `static/admin/server.mjs` | The local Node server |
| `static/admin/lib/*` | Logic — never touched by production traffic |
| `static/admin/public/*` | UI shell — served from the local server |
| `static/hosted/<customerId>/<slug>.html` | Hand-authored internal info pages |
| Git tags `release/N` | Immutable release points |
