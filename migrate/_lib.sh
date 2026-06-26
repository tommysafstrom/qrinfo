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

# Require wrangler to be authenticated against the expected account.
EXPECTED_ACCOUNT="bf81aa0d612777a0d69cf259b0dbf94c"
require_auth() {
  say "Checking wrangler auth…"
  if ! ( cd "$STATIC_DIR" && npx --yes wrangler whoami ) >/tmp/qrinfo_whoami 2>&1; then
    cat /tmp/qrinfo_whoami
    die "wrangler is not logged in. Run: cd static && npx wrangler login"
  fi
  if ! grep -q "$EXPECTED_ACCOUNT" /tmp/qrinfo_whoami; then
    cat /tmp/qrinfo_whoami
    warn "Expected account $EXPECTED_ACCOUNT not found above. Make sure you're on the right account."
    read -r -p "Continue anyway? [y/N] " a; [[ "$a" == [yY] ]] || die "aborted"
  fi
  ok "wrangler authenticated"
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
