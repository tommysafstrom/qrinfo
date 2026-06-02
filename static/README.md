# QR Info — static version

A static QR-redirect site (Cloudflare Pages / Netlify) plus a **local
admin tool** that drives the release flow with explicit `current` /
`previous` pointers and stack-based rollback.

- **Operator runbook:** [runbooks/admin.md](runbooks/admin.md)
- **Architecture and full plan:** [plans/admin-tool.md](plans/admin-tool.md),
  [plans/static-site.md](plans/static-site.md)

## What's here

```
static/
  codes.json              # source of truth: the codes the operator manages
  release-state.json      # live current + previous stack (committed)
  index.html              # public landing-page template (cards injected at build time)
  not-found.html          # fallback for unknown /q/* (Swedish)
  info/<slug>.html        # hand-authored internal info pages (optional)
  dist/                   # build artifact (gitignored)
  .env.example            # env-var template (copy to .env)
  package.json
  admin/                  # the local admin tool — never runs in production
    server.mjs            # node:http server bound to 127.0.0.1
    public/               # plain HTML + fetch UI
    lib/                  # codes, build, preview, tag, deploy, rollback, git, state, ...
  runbooks/
    admin.md              # operator's day-to-day reference
  plans/
    admin-tool.md         # this tool's design
    static-site.md        # the static-site plan
```

## Daily operation

```bash
cd static
npm install
npm run admin
```

Opens a browser to a local URL with a per-launch token. From there: add /
edit codes, preview to the dark site, tag a release, deploy to production,
or roll back the previous stack. Full walkthrough in
[runbooks/admin.md](runbooks/admin.md).

### Command-line entry points

| Script | What it does |
|--------|--------------|
| `npm run admin` | Start the local admin server (`http://127.0.0.1:5173/<token>/`) |
| `npm run build` | Build `codes.json` → `dist/` (`--from <ref>` to build from a tag) |
| `npm run tag -- <n>` | `git tag release/<n> HEAD && git push --tags` (after a clean codes.json commit) |
| `npm run deploy -- <n>` | Build from `release/<n>` → wrangler → atomic state mutation |
| `npm run rollback` | Pop top of `previous` stack and re-deploy |

### Source-of-truth model

- **`codes.json`** is the only thing the operator edits. The build
  generates `dist/_redirects`, `dist/index.html`, and `dist/qr/*` from it.
- **Git tags** `release/<n>` are immutable release points.
- **`release-state.json`** is the live cursor: `current` + the
  `previous[]` stack. Every state change is one commit; `git log -p
  static/release-state.json` is the audit log.

## Local development

`OFFLINE=1` skips `git push` and uses a mocked wrangler. Safe to exercise
the full forward-deploy + rollback flow without touching origin or
Cloudflare:

```bash
OFFLINE=1 npm run admin
```

See [runbooks/admin.md](runbooks/admin.md#env-var-reference) for all the
env vars (`MOCK_WRANGLER`, `NO_TOKEN`, `PORT`, etc).

## Deploy to Cloudflare Pages

The static site itself deploys via the admin tool (`wrangler pages
deploy`), not via a connected git repo. One-time setup in the CF
dashboard:
1. Create a Pages project, note the project name.
2. Set the production branch to `production`.
3. Define a preview-branch pattern that matches `staging`.
4. Create an **Access** application on `staging.<project>.pages.dev`
   restricted to your email.

Full instructions in [runbooks/admin.md](runbooks/admin.md#one-time-local-setup).

## What this static version does — and what it doesn't

**Does:**
- Public resolver `/q/<slug>` → real HTTP 302 to the destination, served
  at Cloudflare's edge
- Internal info pages as plain HTML files under `info/<slug>.html`
- Friendly fallback for unknown codes
- Local admin UI for adding / editing / enabling codes
- Tag-based releases with stack rollback
- Mock mode for fully offline development

**Does not:**
- Run in production — the admin tool is local-only by design
- Provide scan analytics — add Cloudflare Web Analytics or Plausible
- Work LAN-only / offline — needs CF for the production path

If the dynamic Pi/Next.js system better matches the use case, see
[../basic_plan.md](../basic_plan.md) and
[../secure-app/plans/securely-running-on-pi.md](../secure-app/plans/securely-running-on-pi.md).
