#!/usr/bin/env bash
# STEP 1 — Create the D1 database and apply the schema.
#
# WHEN: first, after `cd static && npx wrangler login`.
# SAFE TO RE-RUN: yes. If `qrinfo` already exists, it reuses it; schema uses
#                 CREATE TABLE IF NOT EXISTS.
#
# What it does:
#   - creates D1 database `qrinfo` (or finds the existing one)
#   - writes its database_id into BOTH wrangler.toml files
#   - applies db/schema.sql to the remote DB
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

require_auth

say "Creating (or locating) D1 database 'qrinfo'…"
# `d1 create` errors if it exists; capture and fall through to `d1 info`.
create_out="$( ( cd "$STATIC_DIR" && npx --yes wrangler d1 create qrinfo ) 2>&1 || true )"
echo "$create_out"

# Pull the uuid from either `d1 create` output or `d1 info`.
id="$(printf '%s\n' "$create_out" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || true)"
if [[ -z "$id" ]]; then
  say "Database likely already exists — reading its id with d1 info…"
  info_out="$( ( cd "$STATIC_DIR" && npx --yes wrangler d1 info qrinfo ) 2>&1 || true )"
  echo "$info_out"
  id="$(printf '%s\n' "$info_out" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || true)"
fi
[[ -n "$id" ]] || die "Could not determine the D1 database_id. Run 'npx wrangler d1 info qrinfo' and edit the two wrangler.toml files by hand."
ok "database_id = $id"

set_d1_id "$STATIC_DIR/wrangler.toml" "$id"
set_d1_id "$WORKER_DIR/wrangler.toml" "$id"

say "Applying schema (db/schema.sql) to the remote DB…"
( cd "$STATIC_DIR" && npx --yes wrangler d1 execute qrinfo --remote --file db/schema.sql )
ok "schema applied"

cat <<EOF

$(ok "STEP 1 done.")
NEXT: run ./migrate/02-worker-secrets.sh
  — but FIRST create the WAE-read API token in the dashboard (that script tells
    you exactly how before it prompts you to paste it).
EOF
