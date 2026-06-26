#!/usr/bin/env bash
# Shared helpers for the customer-portal migration scripts. Sourced, not run.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATIC_DIR="$REPO_ROOT/static"
WORKER_DIR="$REPO_ROOT/export-worker"

# Pretty output.
say()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# Run wrangler from a given dir without a global install.
wrangler() { ( cd "$1" && shift && npx --yes wrangler "$@" ); }

# Require wrangler to be usable. account_id is pinned in the wrangler.toml files,
# so auth here is either OAuth (wrangler login) or a CLOUDFLARE_API_TOKEN in the
# env. With token auth, `whoami` can't enumerate accounts and prints a benign
# error — so we don't rely on whoami. Instead we probe a real, read-only call
# (d1 list) scoped to the pinned account; if that works, the token/login is good
# AND has at least D1 read access.
EXPECTED_ACCOUNT="bf81aa0d612777a0d69cf259b0dbf94c"
require_auth() {
  say "Checking wrangler can reach the account…"
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    ok "using CLOUDFLARE_API_TOKEN from the environment"
  fi
  if ( cd "$STATIC_DIR" && npx --yes wrangler d1 list ) >/tmp/qrinfo_probe 2>&1; then
    ok "wrangler authenticated (d1 list succeeded)"
  else
    cat /tmp/qrinfo_probe
    cat >&2 <<'EOF'

Could not reach the account. Either:
  • OAuth: run `unset CLOUDFLARE_API_TOKEN; cd static && npx wrangler login`, or
  • Token: ensure CLOUDFLARE_API_TOKEN is exported and has scopes:
      D1: Edit · Workers Scripts: Edit · Cloudflare Pages: Edit · Account Analytics: Read
EOF
    die "wrangler auth/permission check failed"
  fi
}

# Replace the <D1_DATABASE_ID> placeholder in a wrangler.toml with a real id.
# Refuses if the placeholder is gone AND the id differs (avoid clobbering).
set_d1_id() {
  local file="$1" id="$2"
  if grep -q "<D1_DATABASE_ID>" "$file"; then
    # portable in-place edit (GNU + BSD sed)
    sed -i.bak "s/<D1_DATABASE_ID>/$id/" "$file" && rm -f "$file.bak"
    ok "set database_id in $file"
  elif grep -q "$id" "$file"; then
    ok "database_id already set in $file"
  else
    die "$file has no <D1_DATABASE_ID> placeholder and a different id — edit it by hand"
  fi
}

confirm() {
  read -r -p "$1 [y/N] " a; [[ "$a" == [yY] ]] || die "aborted"
}
