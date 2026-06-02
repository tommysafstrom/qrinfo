# Services — where they are & how to use them

Everything in this project and how to reach it. All services are **LAN-only** —
be on the same Wi-Fi. The Pi is `claudeuser@192.168.148.4` (ssh, no password).

## At a glance

| Service | URL | What it's for | Runs as |
|---------|-----|---------------|---------|
| **qrinfo — production** | http://192.168.148.4:8080 | live QR redirects + info pages | pm2 `qrinfo-serve` (Pi) |
| **qrinfo — staging** ("dark") | http://192.168.148.4:8081 | preview before prod | pm2 `qrinfo-staging` (Pi) |
| **qrinfo — local dev** | http://localhost:8080 | your laptop preview | `npm run serve` |
| **Umami** (metrics) | http://192.168.148.4:3001 | scan analytics dashboard | pm2 `umami` (Pi) |
| **Admin tool** | http://localhost:5173/`<token>`/ | edit codes, deploy, rollback | `npm run admin` (laptop) |
| _teacher app (not ours)_ | :80 / :3000 on the Pi | separate project | pm2 `teacher` — **don't touch** |

---

## qrinfo site — the QR redirect service

What a phone hits when it scans a plaque.

- **Scan / resolve:** `…/q/<code>` → 302 to the destination. Current codes:
  `…/q/tulip` and `…/q/sunflower` (→ Wikipedia).
- **Landing page:** `/` lists published codes. **QR images:** `/qr/<code>.png` (+`.svg`).
- **Unknown/disabled code** → `/not-found.html`.
- Every scan is recorded in Umami (`qr-scan` / `qr-miss`) — once the Pi runs the
  tracking build (see [metrics.md](metrics.md)).

Quick check:
```bash
curl -sI http://192.168.148.4:8080/q/tulip      # 302 → Wikipedia
```

## Umami — metrics dashboard

- **Open:** http://192.168.148.4:3001
- **Login:** user `admin`; password is in `~/umami/ADMIN_CREDENTIALS` on the Pi
  (`ssh claudeuser@192.168.148.4 cat ~/umami/ADMIN_CREDENTIALS`).
- **Use:** website **`qrinfo`** → see scans over time, top codes, destinations,
  misses; filter/break down by `env` (local/staging/production) and `version`.
- Full ops (restart, backup, upgrade): [metrics.md](metrics.md).

## Admin tool — manage & ship codes

Runs on your **laptop**, talks to the Pi (and/or Cloudflare).

```bash
cd static
set -a; . ./.env; set +a     # load config (UMAMI_*, deploy target, etc.)
npm run admin                 # prints a localhost URL w/ a one-time token; opens browser
```

- Edit codes in the browser → commit `codes.json` from your shell.
- **Preview** → builds + pushes to staging (:8081). **Tag** a release → **Deploy**
  to production (:8080). **Rollback** to a prior release.
- Day-to-day flow, env vars, and recovery: [admin.md](admin.md).

> The URL contains a per-launch token — keep that tab; don't share it. Restarting
> the tool makes a new token.

---

## Local development (laptop)

```bash
cd static
npm install
npm run build        # codes.json → dist/ (_redirects, QR images, version.json)
npm run serve        # serve dist/ at http://localhost:8080
```

Want scans to land in Umami while testing? Export the vars first
(`set -a; . ./.env; set +a`) and use a **browser** User-Agent — Umami drops
bot/`curl` traffic. See [metrics.md](metrics.md).

## The Pi, at a glance

```bash
ssh claudeuser@192.168.148.4 'pm2 list'     # qrinfo-serve · qrinfo-staging · umami · teacher
```

Ports: `:80` teacher (nginx) · `:3000` teacher · **`:8080` qrinfo prod** ·
**`:8081` qrinfo staging** · **`:3001` Umami** · `:5432` Postgres (localhost).
