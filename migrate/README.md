# Customer portal migration scripts

Run these from the repo root, in order. Each one validates its preconditions and
stops with a clear "do X in the dashboard, then run the next script" message when
it hands off to manual work. All are safe to re-run.

Full design + background: [../static/plans/customer-portal.md](../static/plans/customer-portal.md).

## Order & when to run each

| # | Script | When | What it does | Manual prep needed first |
|---|--------|------|--------------|--------------------------|
| 0 | `cd static && npx wrangler login` | first | authenticate wrangler against the qrinfo account | — |
| 1 | `./migrate/01-create-d1.sh` | after login | create D1 `qrinfo`, write its id into both wrangler.toml, apply schema | — |
| 2 | `./migrate/02-worker-secrets.sh` | after 1 | set the export worker's `WAE_SQL_TOKEN` + `EXPORT_TRIGGER_TOKEN` | **create the WAE-read API token** (Account · Account Analytics · Read) in the dashboard |
| 3 | `./migrate/03-deploy-worker.sh` | after 2 | deploy the export worker, backfill WAE→D1, verify rows | — |
| 4 | `./migrate/04-finish-portal.sh` | after 3 | wire Access vars into wrangler.toml, deploy the site | **create the Access app** on `/portal*` (One-time PIN); have the team domain + AUD tag ready |

After step 3 you've hit the "real rows in D1" checkpoint — the export half works
on its own even before the portal page exists.

## Notes
- The pre-generated `EXPORT_TRIGGER_TOKEN` is baked into scripts 2 & 3 so they
  agree. Save it; it guards the worker's manual `/run` endpoint.
- Scripts use `npx wrangler` (no global install needed). The export worker's
  wrangler comes via `npx` too.
- Nothing here pushes git or merges to `main` — do that yourself when satisfied.
- Rotate `CLOUDFLARE_API_TOKEN` while you're in the API Tokens UI (it was pasted
  in chat historically).
