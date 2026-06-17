# qrinfo — Deploy Manual (the simple version)

This is the one page to read when you want to change something on the live
QR site and ship it. Everything below is about **`static/`** — that is the
production system. (The `app/` folder is an unused alternative design; ignore
it for deploys.)

---

## The 30-second mental model

1. You edit **one file**: `static/codes.json` (the list of QR codes → where
   they point). You do this through a local web tool, not by hand.
2. You **commit** that change to git.
3. You **tag** a release (`release/7`, `release/8`, …). A tag is a frozen
   snapshot you can deploy and roll back to.
4. You **deploy** the tag. The tool builds the site and ships it to
   **Cloudflare Pages** (project `qrinfo`, served at `skannamig.com`).
5. If something breaks, you **roll back** with one click.

> **Hosting:** migrated from the Raspberry Pi to Cloudflare Pages on
> 2026-06-17. The Pi-deploy path still exists in the code for emergency
> rollback (see the commented block in `static/.env`), but the live target
> is now Cloudflare.

You do all of steps 1–5 from a local admin tool that opens in your browser.
You never edit files on the server directly.

---

## What "production" actually is

- **Live site:** `skannamig.com`, served by **Cloudflare Pages** (project
  `qrinfo`, also reachable at `qrinfo.pages.dev`). Cloudflare gives the cert.
- **Redirects + scan analytics:** `/q/<customerId>/<qid>` runs as a Pages
  Function (`static/functions/q/...`) that records each scan to **Workers
  Analytics Engine** (dataset `qrinfo_scans`), then 302s to the scanner.
- **Stats:** the permanent `/stats` page (per-code + daily), behind Cloudflare
  Access; also the **Stats** tab in the local admin tool. Both read WAE via the
  SQL API (`CLOUDFLARE_API_TOKEN` + `CF_ACCOUNT_ID` in `.env`).
- **Deploy target:** with `DEPLOY_TARGET` *unset* in `static/.env`, the tool
  uses the wrangler/Cloudflare path. Auth is `wrangler login` (OAuth). The
  commented `DEPLOY_TARGET=pi` block is kept only for emergency rollback.
- **The current live release is tracked in `static/release-state.json`** —
  `current` is what's live now, `previous[]` is the rollback history.

---

## One-time setup (only the first time on a new laptop)

```bash
cd static
npm install
cp .env.example .env     # then fill it in — see below
```

You also need wrangler authenticated once per machine: `npx wrangler login`.

Your `.env` is already set up on this machine. It must contain at least:

```
# Cloudflare Pages target (DEPLOY_TARGET unset → wrangler path)
CF_PAGES_PROJECT=qrinfo
CF_ACCOUNT_ID=bf81aa0d612777a0d69cf259b0dbf94c
CLOUDFLARE_ACCOUNT_ID=bf81aa0d612777a0d69cf259b0dbf94c
CLOUDFLARE_API_TOKEN=...     # for the Stats SQL query (Account Analytics: Read)
QR_BASE_URL_PROD=https://skannamig.com   # hostname baked into the QR images
```

`.env` is gitignored (it holds secrets) and **nothing auto-loads it**. The
admin tool reads it, but if you run raw commands you must load it yourself:

```bash
set -a; . ./.env; set +a
```

---

## The normal "I want to change a code and ship it" flow

### 1. Start the admin tool

```bash
cd static
npm run admin
```

This opens your browser to a local URL like `http://127.0.0.1:5173/<token>/`.
Keep that tab. Don't share the URL (the token is your access). Restarting the
tool gives a new token.

### 2. Edit codes (in the browser)

In the **Codes** view: *Add code*, *Edit* a row, or toggle a code's
enabled badge. This writes to `static/codes.json`.

### 3. Commit the change (in your shell)

```bash
git add static/codes.json
git commit -m "codes: <what you changed>"
```

> Why by hand? `codes.json` is your source of truth and every release is tied
> to a clean git commit. Tagging a dirty tree is asking for confusion.

### 4. Preview before going live (optional but recommended)

In the **Pending** view → *Preview on dark site*. This builds and deploys to a
**staging** copy (Pi port `:8081`, service `qrinfo-staging`) so you can scan a
QR / click a link and confirm it works before touching production.

### 5. Tag a release

In the **Release** view → *Tag as release/N*. The tool runs
`git tag release/N HEAD` and pushes the tag. Pick the next number after the
current one (check `release-state.json` — today the latest is `release/6`, so
next is `release/7`).

### 6. Deploy

In the **Release** view, on your new tag's row → *Deploy*. Watch the progress
stream go through these phases:

| Phase | What it means |
|-------|---------------|
| `snapshot` | remembers the current live release (for rollback) |
| `build` | builds the site from your tag |
| `deploy` | ships `dist/` to the Pi and restarts `qrinfo-serve` (:8080) |
| `state` | updates `release-state.json` (`current` ← your tag) |
| `commit` + `push` | saves the audit trail to git |

### 7. Verify

Scan a real QR code with your phone, or:

```bash
curl -sI http://192.168.148.4:8080/q/<your-code>   # should be a 302 redirect
```

That's it. You shipped.

---

## Rollback (when a deploy was bad)

1. Open the **Releases** view.
2. The top row is live now; the row right below it is the rollback target.
3. Click *Rollback to this* → confirm.

The tool rebuilds the previous tag, redeploys it, and pops the stack. To go
*forward* again to a tag you rolled away from, just *Deploy* that tag's row
again — all the `release/N` git tags are permanent.

---

## Command-line equivalents (if you skip the browser UI)

The buttons above just call these npm scripts. You can run them directly:

```bash
cd static
set -a; . ./.env; set +a      # load DEPLOY_TARGET=pi etc.

npm run build                 # codes.json → dist/  (add --from release/7 to build a tag)
npm run tag -- 7              # git tag release/7 HEAD && push
npm run deploy -- 7           # build release/7 → ship to Pi → update state → commit/push
npm run rollback              # pop the previous stack and redeploy
```

---

## Practice / dry-run mode (touches nothing real)

Want to rehearse the whole flow without deploying or pushing?

```bash
cd static
OFFLINE=1 npm run admin
```

`OFFLINE=1` skips `git push` and mocks the deploy — commits and tags still
happen in your local `.git`, so the flow runs end to end on disk. Clean up
afterward with `git reset --hard <commit>` and `git tag -d release/<n>`.

---

## When something goes wrong

| Symptom | What it means / fix |
|---------|---------------------|
| **Deploy failed mid-way** | State only changes *after* a successful deploy. If it failed, nothing live changed. Fix the cause (network, SSH, token) and click *Deploy* again. |
| **Deploy succeeded but `push` showed error** | Production is fine and state is committed locally — only the git sync failed. Just run `git push` from a shell. |
| **Tagged the wrong number** | Tags are immutable. Don't fight it — tag the next number (`release/N+1`) and deploy that. The bad tag just sits unused. |
| **`release-state.json` looks wrong** | It's a full audit log: `git log -p static/release-state.json`. Reset to last good with `git checkout HEAD -- static/release-state.json`, then refresh the Releases view. |
| **Leaked the admin URL/token** | Ctrl-C the tool and `npm run admin` again — new token, old URL dies. |

---

## Cheat sheet

```bash
cd static && npm run admin      # 1. open the tool, edit codes in browser
git add static/codes.json && git commit -m "codes: ..."   # 2. commit
# 3. in browser: Preview → Tag release/N → Deploy
curl -sI http://192.168.148.4:8080/q/<code>               # 4. verify
# rollback = Releases view → Rollback to this
```

Full operator reference: [static/runbooks/admin.md](static/runbooks/admin.md)
