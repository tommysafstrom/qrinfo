# QR Info — Implementation Plan

## Project Overview

A self-hosted system for **printed QR codes on plaques**. Each plaque carries a QR
code that encodes a short, stable URL pointing at a registry running on a Raspberry
Pi. When a phone scans it, the Pi looks the code up in a local registry/database and
sends the visitor on to a destination:

- an **internal info page** hosted by this system (title + text + optional images,
  stored in the DB), or
- an **external URL** (redirect to any website).

The key benefit of this indirection: **the QR code never changes, but where it points
can be edited at any time.** Print once, repoint forever — and disable a code without
reprinting the plaque.

### Original intent (kept for reference)

> I want to create a system where I print QR codes and put them on plaques; when they
> are scanned with a phone the user gets an informational website opened on the phone.
> When the QR code is loaded it should take the user to the address of a host that
> contains a registry/database for this particular QR code and where it should point,
> then the user is redirected there. Set this up on my Raspberry Pi as done with the
> parallel teacher project.

### Confirmed decisions

| Decision | Choice |
|----------|--------|
| Destination per code | **Both** — internal info page *or* external URL |
| How phones reach the Pi | **Local network only** (same Wi‑Fi/LAN) |
| Admin protection | **Open during development**; auth deferred to a hardening phase |

Because reachability is LAN-only, each QR code encodes a LAN address such as
`http://qrpi.local/q/<code>` (mDNS hostname) or `http://<pi-ip>/q/<code>`. Plain HTTP
is fine on a trusted LAN; phones must be on the same network for codes to resolve.

---

## Framework Recommendation

**Next.js (TypeScript)** — identical stack and deployment story to the teacher project,
so it drops straight onto the same Pi with the same GitHub Actions self-hosted runner +
pm2 setup.

Stack: Next.js (latest) · TypeScript · Tailwind CSS (utility-only) · local JSON file via
`fs` in API routes · [`qrcode`](https://www.npmjs.com/package/qrcode) for generating
printable QR images.

**Next.js version caution:** before writing any Next.js-specific code (routing, redirects,
data fetching, server components, middleware), read the relevant guide in
`app/node_modules/next/dist/docs/`. Do not rely on training data about Next.js APIs — the
teacher project is on Next 16.x, which has breaking changes from earlier releases.

**Conventions:** code (variables, comments, filenames, routes) in **English**. The
public-facing fallback text (e.g. "den här koden finns inte / är avstängd") in **Swedish**,
matching the teacher project. Info-page content is author-supplied, so any language.

**Project layout** (mirrors teacher):

```
qrinfo/
  app/                  # Next.js App Router project (all npm commands run here)
    app/                # routes (see below)
    lib/                # db.ts · types.ts · qr.ts
    data/db.json        # the registry + info pages (flat JSON, file-locked writes)
    public/
  documentation/        # Mermaid diagrams
  basic_plan.md         # this file
```

**Port:** run on **3001** (teacher already owns 3000 on the Pi), fronted by a reverse
proxy (nginx) so QR URLs can omit the port (`http://qrpi.local/q/<code>` → :3001).

---

## Routes

**Public**
- `GET /q/[code]` — the resolver. Looks up `code` in the registry:
  - missing or disabled → friendly Swedish fallback page (HTTP 404/410)
  - `external` → HTTP 302 redirect to the target URL
  - `internal` → render (or redirect to) `/info/[slug]`
- `GET /info/[slug]` — render an internal info page (title, body, images)

**Admin** (open during dev)
- `/admin` — list all codes (label, type, target, enabled, scan count)
- `/admin/codes/new` · `/admin/codes/[id]` — create/edit a code, set destination,
  download its QR image (PNG + SVG)
- `/admin/pages` · `/admin/pages/[id]` — create/edit internal info pages

**API** (back these routes)
- `GET/POST /api/codes` · `GET/PUT/DELETE /api/codes/[id]`
- `GET/POST /api/pages` · `GET/PUT/DELETE /api/pages/[id]`
- `GET /api/codes/[id]/qr?format=png|svg` — generated QR image for printing

---

## Phases

---

### Phase 0 — Architecture & Flow Documentation
> Goal: Mermaid diagrams capturing the full system before code is written. Saved under `documentation/`.

**Suggested agent:** `claude` (Opus 4.7 — full-system reasoning + Mermaid authoring)

- [ ] `documentation/architecture.md` — system + folder-structure diagrams:
  - [ ] Phone → `/q/[code]` resolver → `lib/db.ts` → `data/db.json` → redirect/render
  - [ ] Admin browser → admin pages → API routes → `lib/db.ts`
  - [ ] QR generation path (`lib/qr.ts` → downloadable PNG/SVG)
- [ ] `documentation/flow-scan.md` — visitor flow: scan → resolve → (external redirect | internal page | fallback)
- [ ] `documentation/flow-admin.md` — admin flow: create code → choose internal/external → set target → download QR → print → later repoint/disable
- [ ] `documentation/data-model.md` — entities: `Code` ↔ `Page` (internal codes reference a page), enabled flag, scan log
- [ ] Review all diagrams together for consistency before Phase 1

---

### Phase 1 — Foundation & Data Model
> Goal: a project that boots, with an agreed JSON schema for the registry.

**Suggested agent:** `claude` (Sonnet 4.6)

- [ ] Scaffold Next.js (TypeScript + Tailwind) in `app/`, set `output: 'standalone'` in `next.config`
- [ ] Define schema in `lib/types.ts`: `Code`, `Page`, `DB`
- [ ] Implement `lib/db.ts` — typed read/write helpers with a promise-chain write-lock (copy the teacher pattern)
- [ ] Seed `data/db.json` with: one external code, one internal code + its info page
- [ ] Add `QR_BASE_URL` env handling (e.g. `http://qrpi.local`) via `.env.local.example`
- [ ] Verify `npm run dev` boots and `npm run build` passes

---

### Phase 2 — The Resolver (`/q/[code]`)
> Goal: the core registry redirect — the heart of the whole system.

**Suggested agent:** `claude` (Sonnet 4.6)

- [ ] Build `GET /q/[code]`:
  - [ ] look up code; if missing/disabled → Swedish fallback page (404/410)
  - [ ] `external` → 302 to target URL
  - [ ] `internal` → serve/redirect to `/info/[slug]`
- [ ] Increment a scan counter (and optional timestamped scan log) on each resolve
- [ ] Validate `code` against an allowlist regex (e.g. `/^[a-z0-9]{6,12}$/`)
- [ ] Test all three branches with seeded codes

---

### Phase 3 — Internal Info Pages (`/info/[slug]`)
> Goal: visitors landing on an internally-hosted page see clean content.

**Suggested agent:** `claude` (Sonnet 4.6)

- [ ] Build `GET /info/[slug]` — render title, body (markdown → HTML), optional images
- [ ] Mobile-first layout (these are read on phones)
- [ ] 404 for unknown slugs

---

### Phase 4 — Admin: Code Registry CRUD
> Goal: manage codes and their destinations from the browser.

**Suggested agent:** `claude` (Sonnet 4.6)

- [ ] `/admin` list view: label · type · target · enabled toggle · scan count
- [ ] `/admin/codes/new` and `/admin/codes/[id]` — create/edit:
  - [ ] choose `internal` (pick an info page) or `external` (enter URL)
  - [ ] enable/disable, edit label, delete
- [ ] API: `GET/POST /api/codes`, `GET/PUT/DELETE /api/codes/[id]`
- [ ] Auto-generate a unique short `code` slug on create

---

### Phase 5 — Admin: Info Page CRUD
> Goal: author the internal informational content.

**Suggested agent:** `claude` (Sonnet 4.6)

- [ ] `/admin/pages` and `/admin/pages/[id]` — create/edit title + body (+ optional images)
- [ ] API: `GET/POST /api/pages`, `GET/PUT/DELETE /api/pages/[id]`
- [ ] Guard: block deleting a page still referenced by an internal code

---

### Phase 6 — QR Image Generation
> Goal: download printable QR images for the plaques.

**Suggested agent:** `claude` (Sonnet 4.6)

- [ ] Add `lib/qr.ts` using the `qrcode` library
- [ ] `GET /api/codes/[id]/qr?format=png|svg` → encodes `${QR_BASE_URL}/q/${code}`
- [ ] "Download QR" buttons (PNG for print, SVG for scaling) on the code edit page
- [ ] Sensible defaults: high error-correction (level H, survives wear on a plaque), quiet-zone margin
- [ ] Verify a generated code scans correctly with a real phone on the LAN

---

### Phase 7 — Raspberry Pi Deployment
> Goal: live on the Pi, reachable on the LAN, auto-deploying on push — same as teacher.

**Suggested agent:** `claude` (Sonnet 4.6)

- [ ] `.github/workflows/deploy.yml` on the `[self-hosted, pi]` runner: `git pull` → `npm ci --prefer-offline` → `npm run build` → copy `.next/static` + `public` into `.next/standalone` → `pm2 restart qrinfo`
- [ ] Register the app with pm2 on **port 3001** (`pm2 start … --name qrinfo`)
- [ ] LAN reachability: set up mDNS hostname `qrpi.local` (avahi) **or** assign a static LAN IP; set `QR_BASE_URL` to match
- [ ] Reverse proxy (nginx) on port 80 → :3001 so QR URLs drop the port
- [ ] Scan a printed code from a phone on the same Wi‑Fi end-to-end

---

### Phase 8 — Hardening (deferred) & Demo
> Goal: walkthrough the happy path; note what must change before any non-LAN exposure.

**Suggested agent:** `claude` with `/verify` and `/security-review` skills

- [ ] Full walkthrough: create internal code + page → download QR → scan → see page; create external code → scan → redirect; disable a code → scan → fallback
- [ ] Validate all API inputs (code slug regex, URL format on external targets, length limits)
- [ ] **Deferred (do before exposing beyond LAN):** add admin auth (password gate on `/admin` + `/api`), HTTPS, rate-limiting on the resolver
- [ ] `README.md` with `npm install && npm run dev` + Pi deploy notes

---

## Subagent Summary

| Phase | Agent type | Model | Reason |
|-------|-----------|-------|--------|
| 0 — Architecture diagrams | `claude` | Opus 4.7 | Full-system reasoning, Mermaid authoring |
| 1 — Scaffold & schema | `claude` | Sonnet 4.6 | Standard coding task |
| 2 — Resolver | `claude` | Sonnet 4.6 | Core routing/redirect logic |
| 3 — Internal info pages | `claude` | Sonnet 4.6 | Standard UI |
| 4 — Code registry CRUD | `claude` | Sonnet 4.6 | Standard CRUD + API |
| 5 — Info page CRUD | `claude` | Sonnet 4.6 | Standard CRUD + API |
| 6 — QR generation | `claude` | Sonnet 4.6 | Library integration |
| 7 — Pi deployment | `claude` | Sonnet 4.6 | CI/CD + pm2, mirrors teacher |
| 8 — Hardening & demo | `claude` + `/verify` + `/security-review` | Sonnet 4.6 | Live walkthrough + input validation |

---

## Data Model (sketch)

```json
{
  "codes": [
    {
      "id": "c001",
      "code": "oak1a2",
      "label": "Plakett vid eken",
      "type": "internal",
      "target": "p001",
      "enabled": true,
      "scanCount": 0,
      "createdAt": "2026-05-29",
      "updatedAt": "2026-05-29"
    },
    {
      "id": "c002",
      "code": "shop99",
      "label": "Butiken (extern)",
      "type": "external",
      "target": "https://example.com",
      "enabled": true,
      "scanCount": 0,
      "createdAt": "2026-05-29",
      "updatedAt": "2026-05-29"
    }
  ],
  "pages": [
    {
      "id": "p001",
      "slug": "eken",
      "title": "Eken vid dammen",
      "body": "Det här trädet planterades 1923 ...",
      "images": [],
      "updatedAt": "2026-05-29"
    }
  ]
}
```

- A `Code` of `type: "internal"` has `target` = a `Page.id`; `type: "external"` has `target` = a URL.
- `code` (the short slug) is what gets encoded in the QR image and appears in `/q/[code]`.
- `enabled: false` lets you take a plaque offline without deleting or reprinting it.
