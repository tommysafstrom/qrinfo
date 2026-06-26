#!/usr/bin/env bash
# STEP 4 — Wire Access config into wrangler.toml and deploy the site.
#
# WHEN: last, after you've created the Cloudflare Access app (step 3's NEXT note)
#       and have the team domain + AUD tag.
# SAFE TO RE-RUN: yes. It only rewrites the two ACCESS_* placeholders and deploys
#                 a new release.
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

require_auth

WT="$STATIC_DIR/wrangler.toml"

# Guard: D1 id must be set on the site too.
grep -q "<D1_DATABASE_ID>" "$WT" && die "static/wrangler.toml still has <D1_DATABASE_ID> — run step 1 first."

say "Cloudflare Access values for the portal"
if grep -q "<ACCESS_TEAM_DOMAIN>" "$WT"; then
  read -r -p "Team domain (e.g. https://yourteam.cloudflareaccess.com): " team
  [[ "$team" =~ ^https://.*cloudflareaccess\.com/?$ ]] || warn "That doesn't look like a *.cloudflareaccess.com URL — double-check."
  sed -i.bak "s#<ACCESS_TEAM_DOMAIN>#${team%/}#" "$WT" && rm -f "$WT.bak"
  ok "ACCESS_TEAM_DOMAIN set"
else
  ok "ACCESS_TEAM_DOMAIN already set"
fi
if grep -q "<ACCESS_AUD>" "$WT"; then
  read -r -p "Access Application Audience (AUD) tag: " aud
  [[ -n "$aud" ]] || die "AUD tag cannot be empty"
  sed -i.bak "s#<ACCESS_AUD>#${aud}#" "$WT" && rm -f "$WT.bak"
  ok "ACCESS_AUD set"
else
  ok "ACCESS_AUD already set"
fi

say "Reminder: make sure your email is in static/functions/_lib/tenants.mjs"
grep -n "tommy.safstrom@gmail.com" "$STATIC_DIR/functions/_lib/tenants.mjs" \
  && ok "owner email present in tenant map" \
  || warn "owner email not found in tenants.mjs — add it before customers rely on /portal"

NEXT_REL="$(( $(grep -oE 'release/[0-9]+' "$STATIC_DIR/release-state.json" | grep -oE '[0-9]+' | sort -n | tail -1) + 1 ))"
say "Deploying the site as release/$NEXT_REL (production: skannamig.com)…"
confirm "Deploy to PRODUCTION now?"
( cd "$STATIC_DIR" && npm run deploy -- "$NEXT_REL" )

cat <<EOF

$(ok "STEP 4 done — portal deployed.")
SMOKE TEST:
  1. Open https://skannamig.com/portal → you should get a Cloudflare Access
     One-time PIN prompt → log in with your email.
  2. As '*' (owner) you should see ALL customers' codes.
  3. Add a test customer (one customerId in tenants.mjs + in the Access policy),
     re-run this script (or just 'npm run deploy -- N'), log in as them, and
     confirm they see ONLY that customer's rows.

Don't forget (from the infra notes): rotate CLOUDFLARE_API_TOKEN while you're in
the API Tokens UI. And push the branch when you're happy:
  git push -u origin migrate-to-cloudflare-pages
EOF
