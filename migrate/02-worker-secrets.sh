#!/usr/bin/env bash
# STEP 2 — Set the export worker's two secrets.
#
# WHEN: after step 1. Requires a WAE-read API token you create in the dashboard.
# SAFE TO RE-RUN: yes (overwrites the secrets).
#
# Create the WAE-read token first:
#   Cloudflare dashboard → My Profile → API Tokens → Create Token →
#   "Create Custom Token" → Permissions: Account · Account Analytics · Read
#   → Account Resources: your account → Create → copy the token.
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

# Pre-generated random trigger token (guards the manual /run endpoint). You can
# replace it, but then use the same value when you curl /run in step 3.
TRIGGER_TOKEN="501180b34df6de74803e91d740c3113890bba8a6e88d950f"

require_auth

cat <<EOF

This sets two secrets on the qrinfo-export worker:
  WAE_SQL_TOKEN        — the Account Analytics: Read token you just created
  EXPORT_TRIGGER_TOKEN — guards the manual /run endpoint (pre-generated below)

Pre-generated EXPORT_TRIGGER_TOKEN (save it — you need it in step 3):
  $TRIGGER_TOKEN
EOF

confirm "Have you created the WAE-read API token and have it ready to paste?"

say "Setting WAE_SQL_TOKEN (paste the Account Analytics: Read token at the prompt)…"
( cd "$WORKER_DIR" && npx --yes wrangler secret put WAE_SQL_TOKEN )

say "Setting EXPORT_TRIGGER_TOKEN (pasting the pre-generated value for you)…"
printf '%s' "$TRIGGER_TOKEN" | ( cd "$WORKER_DIR" && npx --yes wrangler secret put EXPORT_TRIGGER_TOKEN )

ok "STEP 2 done."
echo "NEXT: run ./migrate/03-deploy-worker.sh"
