#!/usr/bin/env bash
# STEP 3 — Deploy the export worker, backfill existing WAE history, verify D1.
#
# WHEN: after steps 1–2.
# SAFE TO RE-RUN: yes. Deploy is idempotent; the backfill upsert never
#                 double-counts (ON CONFLICT replaces each hour bucket).
#
# This is the "see real rows land in D1" checkpoint.
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

TRIGGER_TOKEN="501180b34df6de74803e91d740c3113890bba8a6e88d950f"

require_auth

# Guard: the worker's wrangler.toml must have a real D1 id by now.
grep -q "<D1_DATABASE_ID>" "$WORKER_DIR/wrangler.toml" \
  && die "export-worker/wrangler.toml still has <D1_DATABASE_ID> — run step 1 first."

say "Deploying qrinfo-export worker…"
deploy_out="$( cd "$WORKER_DIR" && npx --yes wrangler deploy 2>&1 )"
echo "$deploy_out"

# Grab the deployed *.workers.dev URL from the output.
url="$(printf '%s\n' "$deploy_out" | grep -oE 'https://qrinfo-export\.[a-z0-9.-]+\.workers\.dev' | head -1 || true)"
if [[ -z "$url" ]]; then
  warn "Couldn't auto-detect the worker URL from the deploy output."
  read -r -p "Paste the https://qrinfo-export.<subdomain>.workers.dev URL: " url
fi
ok "worker URL: $url"

say "Triggering one-shot BACKFILL of existing WAE history into D1…"
echo "GET $url/run?backfill=1"
curl -fsS "$url/run?backfill=1&token=$TRIGGER_TOKEN" && echo
ok "backfill request sent"

say "Verifying rows in D1…"
( cd "$STATIC_DIR" && npx --yes wrangler d1 execute qrinfo --remote \
    --command "SELECT COUNT(*) AS rows, MIN(day_hour) AS first_hour, MAX(day_hour) AS last_hour FROM scan_hourly" )
( cd "$STATIC_DIR" && npx --yes wrangler d1 execute qrinfo --remote \
    --command "SELECT * FROM export_meta" )

cat <<EOF

$(ok "STEP 3 done — the export half is live.")
If rows > 0 above, WAE→D1 works and the hourly cron will keep it fresh.

NEXT: set up Cloudflare Access (dashboard), then run ./migrate/04-finish-portal.sh.
Access app setup:
  Zero Trust → Access → Applications → Add → Self-hosted
    • Application domains:  skannamig.com/portal   AND   qrinfo.pages.dev/portal
      (include the path; the app covers /portal and everything under it)
    • Identity / login method: One-time PIN
    • Policy: Allow → Emails → your email (add customers later)
  After creating it, copy the Application Audience (AUD) tag and note your team
  domain (https://<team>.cloudflareaccess.com). Step 4 will ask for both.
EOF
