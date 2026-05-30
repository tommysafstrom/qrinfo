# QR Info

Self-hosted registry for printed QR-code plaques. Each plaque encodes a short, stable
URL (`http://<host>/q/<code>`). When scanned, the Pi looks the code up and either:

- redirects to an **external URL**, or
- shows an **internal info page** (content stored in the local JSON DB).

The QR image never changes — you repoint or disable a code from the admin UI without
reprinting the plaque.

## Local development

```bash
npm install
npm run dev        # http://localhost:3001 (set PORT=3001)
```

Set `QR_BASE_URL` so generated QR images encode a reachable address (see
`.env.local.example`). Locally that is `http://localhost:3001`.

- Admin UI: `/admin` (codes) and `/admin/pages` (info pages)
- Resolver: `/q/[code]` · Public info pages: `/info/[slug]`

Auth is intentionally **open during development**. See "Hardening" before exposing this
beyond a trusted LAN.

## Data

All data lives in `data/db.json` (`codes` + `pages`), accessed through `lib/db.ts` with a
promise-chain write-lock. There is no external database. `data/db.json` is the live store;
if you edit codes on the Pi, a later `git pull` may conflict — for production, consider
gitignoring it or moving it outside the repo.

## Deploy to Raspberry Pi (LAN-only)

Same pattern as the `teacher` project: a `[self-hosted, pi]` GitHub Actions runner pulls,
builds, and restarts a pm2 process on push to `main` (`.github/workflows/deploy.yml`).

**One-time setup on the Pi** (clone to `/home/claudeuser/qrinfo`, then):

```bash
cd /home/claudeuser/qrinfo/app
npm ci
npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public 2>/dev/null || true
# Start from the app root so process.cwd() finds data/db.json:
QR_BASE_URL=http://qrpi.local PORT=3001 pm2 start .next/standalone/server.js --name qrinfo
pm2 save
```

- Run on **port 3001** (teacher owns 3000). Front it with nginx on port 80 so QR URLs
  can drop the port.
- **LAN reachability:** give the Pi an mDNS hostname (`qrpi.local` via avahi) or a static
  LAN IP, and set `QR_BASE_URL` to match. Phones must be on the same Wi-Fi; plain HTTP is
  fine on a trusted LAN.

## Hardening (deferred — do before any non-LAN exposure)

- Add auth to `/admin` and `/api` (open by design right now).
- Serve over HTTPS and add rate-limiting on `/q/[code]`.
- Info-page bodies render as plain text (no HTML injection); keep it that way or add a
  sanitizer if you introduce rich content.
