#!/usr/bin/env bash
#
# qrinfo ops — the simple operator console for the live QR site.
#
# This is a friendly wrapper around the same engine the admin web tool uses
# (the npm scripts in static/). It exists so you can diagnose, tag, deploy and
# roll back from the terminal with output you can actually read.
#
#   ./ops.sh status            what's live, what's pending, is the Pi up
#   ./ops.sh releases          the release history (current + rollback stack)
#   ./ops.sh diagnose          deeper health check (env, git, ssh, Pi service)
#   ./ops.sh verify [code]     hit the live site and confirm a redirect works
#   ./ops.sh tag <N>           freeze a release/N from the current commit
#   ./ops.sh deploy <N>        build release/N and ship it to production
#   ./ops.sh rollback          go back to the previous release (one step)
#   ./ops.sh help              this help
#
# Nothing here edits codes.json — you still do that in the admin tool
# (`npm run admin`). This is the ship/observe/recover half of the workflow.
#
# Dry run: prefix with OFFLINE=1 to rehearse tag/deploy/rollback without
# pushing to git or touching the real Pi (the engine mocks it).
set -euo pipefail

# ── locate ourselves & the static/ project root ───────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATIC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$STATIC_DIR"

# ── colours (auto-off when not a terminal) ────────────────────────────────
if [[ -t 1 ]]; then
  BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; GREEN=$'\e[32m'
  YELLOW=$'\e[33m'; BLUE=$'\e[34m'; CYAN=$'\e[36m'; RESET=$'\e[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; CYAN=""; RESET=""
fi
ok()    { printf "  ${GREEN}✓${RESET} %s\n" "$*"; }
warn()  { printf "  ${YELLOW}!${RESET} %s\n" "$*"; }
bad()   { printf "  ${RED}✗${RESET} %s\n" "$*"; }
info()  { printf "  ${DIM}·${RESET} %s\n" "$*"; }
head1() { printf "\n${BOLD}${BLUE}== %s ==${RESET}\n" "$*"; }

die()   { printf "\n${RED}${BOLD}error:${RESET} %s\n" "$*" >&2; exit 1; }

# ── load .env (DEPLOY_TARGET, PI_SSH_HOST, …) the way the docs say to ─────
# Nothing auto-loads it; the npm scripts use --env-file, but our own ssh/curl
# probes need these vars too.
if [[ -f .env ]]; then
  set -a; . ./.env; set +a
fi
PI_SSH_HOST="${PI_SSH_HOST:-}"
PI_PROD_PORT="${PI_PROD_PORT:-8080}"
PI_STAGING_PORT="${PI_STAGING_PORT:-8081}"
PI_PROD_SERVICE="${PI_PROD_SERVICE:-qrinfo-serve}"
DEPLOY_TARGET="${DEPLOY_TARGET:-wrangler}"
STATE_FILE="release-state.json"

# Pi hostname (strip user@ and :port) for curl probes.
pi_host() {
  local h="${PI_SSH_HOST#*@}"   # drop user@
  printf '%s' "${h%%:*}"        # drop :port
}
PROD_URL="http://$(pi_host):${PI_PROD_PORT}"

# ── tiny JSON readers (jq if present, node fallback) ──────────────────────
have() { command -v "$1" >/dev/null 2>&1; }

state_get() { # $1 = node-ish path into release-state.json, e.g. .current.tag
  if [[ ! -f "$STATE_FILE" ]]; then printf ''; return; fi
  if have jq; then jq -r "$1 // empty" "$STATE_FILE" 2>/dev/null || true
  else node -e "const s=require('./$STATE_FILE');const v=(${1/./s.});console.log(v??'')" 2>/dev/null || true
  fi
}

# ── confirmation helper (skipped when OFFLINE rehearsal) ──────────────────
confirm() {
  local prompt="$1"
  printf "\n${YELLOW}%s${RESET} ${DIM}[y/N]${RESET} " "$prompt"
  read -r reply
  [[ "$reply" == "y" || "$reply" == "Y" ]]
}

# ╭───────────────────────────────────────────────────────────────────────╮
# │ status — the one-screen "where are we" answer                          │
# ╰───────────────────────────────────────────────────────────────────────╯
cmd_status() {
  head1 "LIVE NOW"
  local cur_tag cur_commit cur_when
  cur_tag="$(state_get '.current.tag')"
  cur_commit="$(state_get '.current.commit')"
  cur_when="$(state_get '.current.deployedAt')"
  if [[ -n "$cur_tag" ]]; then
    printf "  ${BOLD}${GREEN}%s${RESET}  ${DIM}(commit %s, deployed %s)${RESET}\n" \
      "$cur_tag" "$cur_commit" "${cur_when:-?}"
    printf "  ${DIM}serving at${RESET} %s\n" "$PROD_URL"
  else
    warn "no release recorded as live yet (release-state.json has no current)"
  fi

  head1 "PENDING (committed but not yet released)"
  local head_commit base_commit
  head_commit="$(git rev-parse --short HEAD)"
  base_commit="$cur_commit"
  if [[ -z "$base_commit" ]]; then
    info "no baseline — this would be the first release"
  elif [[ "$head_commit" == "$base_commit"* || "$base_commit" == "$head_commit"* ]]; then
    ok "nothing pending — live release is at the current commit ($head_commit)"
  else
    local n
    n="$(git rev-list --count "${base_commit}..HEAD" 2>/dev/null || echo '?')"
    warn "$n commit(s) on top of the live release ($base_commit → $head_commit):"
    git --no-pager log --oneline "${base_commit}..HEAD" 2>/dev/null | sed 's/^/    /' || true
    info "changed files under static/:"
    git --no-pager diff --name-status "${base_commit}..HEAD" -- static 2>/dev/null \
      | sed 's/^/    /' | head -20 || true
  fi

  head1 "WORKING TREE"
  if git diff --quiet -- static/codes.json 2>/dev/null && git diff --cached --quiet -- static/codes.json 2>/dev/null; then
    ok "codes.json is committed & clean (ready to tag)"
  else
    bad "codes.json has uncommitted changes — commit before you tag"
    info "git add static/codes.json && git commit -m \"codes: ...\""
  fi
  if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
    info "(other uncommitted changes exist in the tree too)"
  fi

  head1 "NEXT RELEASE NUMBER"
  local next
  next="$(next_release_n)"
  printf "  would be ${BOLD}release/%s${RESET}\n" "$next"
  printf "  ${DIM}→ ./ops.sh tag %s   then   ./ops.sh deploy %s${RESET}\n" "$next" "$next"
  printf "\n"
}

next_release_n() {
  local max=0 n
  while read -r t; do
    [[ "$t" =~ ^release/([0-9]+)$ ]] && { n="${BASH_REMATCH[1]}"; (( n > max )) && max=$n; }
  done < <(git tag -l 'release/*')
  echo $(( max + 1 ))
}

# ╭───────────────────────────────────────────────────────────────────────╮
# │ releases — the history & rollback stack                                │
# ╰───────────────────────────────────────────────────────────────────────╯
cmd_releases() {
  head1 "RELEASE HISTORY"
  local cur_tag
  cur_tag="$(state_get '.current.tag')"
  printf "  ${BOLD}%-12s %-9s %-22s %s${RESET}\n" "TAG" "COMMIT" "DEPLOYED" ""
  if [[ -n "$cur_tag" ]]; then
    printf "  ${GREEN}%-12s${RESET} %-9s %-22s ${GREEN}← LIVE NOW${RESET}\n" \
      "$cur_tag" "$(state_get '.current.commit')" "$(state_get '.current.deployedAt')"
  fi
  # previous[] in order = the rollback stack (index 0 is the rollback target)
  local count i tag commit when label
  if have jq; then count="$(jq '.previous | length' "$STATE_FILE" 2>/dev/null || echo 0)"; else
    count="$(node -e "console.log((require('./$STATE_FILE').previous||[]).length)" 2>/dev/null || echo 0)"; fi
  for (( i=0; i<count; i++ )); do
    tag="$(state_get ".previous[$i].tag")"
    commit="$(state_get ".previous[$i].commit")"
    when="$(state_get ".previous[$i].deployedAt")"
    label=""
    [[ "$i" == "0" ]] && label="${YELLOW}← rollback target${RESET}"
    printf "  %-12s %-9s %-22s %b\n" "$tag" "$commit" "$when" "$label"
  done
  printf "\n  ${DIM}Top of the stack is what 'rollback' goes to. Every release/N git${RESET}\n"
  printf "  ${DIM}tag is permanent — deploy any of them again to roll forward.${RESET}\n\n"
}

# ╭───────────────────────────────────────────────────────────────────────╮
# │ diagnose — deeper health check before you trust a deploy               │
# ╰───────────────────────────────────────────────────────────────────────╯
cmd_diagnose() {
  head1 "CONFIG"
  printf "  deploy target : ${BOLD}%s${RESET}\n" "$DEPLOY_TARGET"
  [[ "$DEPLOY_TARGET" == "pi" ]] && ok "DEPLOY_TARGET=pi (ships to the Pi over SSH)" \
                                  || warn "DEPLOY_TARGET is '$DEPLOY_TARGET' (not the usual 'pi')"
  if [[ -n "$PI_SSH_HOST" ]]; then ok "PI_SSH_HOST = $PI_SSH_HOST"; else bad "PI_SSH_HOST not set"; fi
  printf "  prod url      : %s\n" "$PROD_URL"
  [[ -f .env ]] && ok ".env present" || warn ".env missing (run from static/, copy .env.example)"

  head1 "GIT"
  ok "branch: $(git rev-parse --abbrev-ref HEAD), HEAD: $(git rev-parse --short HEAD)"
  if git diff --quiet -- static/codes.json && git diff --cached --quiet -- static/codes.json; then
    ok "codes.json clean"
  else
    bad "codes.json dirty (commit before tagging)"
  fi
  # unpushed?
  if git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
    local ahead; ahead="$(git rev-list --count @{u}..HEAD 2>/dev/null || echo '?')"
    if [[ "$ahead" == "0" ]]; then ok "in sync with upstream"; else warn "$ahead local commit(s) not pushed (git push)"; fi
  else
    info "no upstream tracking branch configured"
  fi

  head1 "SSH TO PI"
  if [[ -z "$PI_SSH_HOST" ]]; then
    warn "skipped — PI_SSH_HOST not set"
  elif ssh -o BatchMode=yes -o ConnectTimeout=6 "$PI_SSH_HOST" true 2>/dev/null; then
    ok "ssh $PI_SSH_HOST works (no password prompt)"
    head1 "PI SERVICE (pm2)"
    local line
    if have jq; then
      # status, restart count, and uptime as a human duration (pm_uptime is
      # an epoch-ms 'started at'; turn it into "up Xh Ym").
      line="$(ssh -o BatchMode=yes -o ConnectTimeout=6 "$PI_SSH_HOST" \
        "pm2 jlist 2>/dev/null" 2>/dev/null \
        | jq -r --arg n "$PI_PROD_SERVICE" '
            (now*1000) as $now
            | .[] | select(.name==$n)
            | (($now - .pm2_env.pm_uptime)/1000 | floor) as $s
            | "\(.pm2_env.status)  restarts=\(.pm2_env.restart_time)  up \(($s/3600|floor))h \((($s%3600)/60)|floor)m"
          ' 2>/dev/null || true)"
    else
      line="$(ssh -o BatchMode=yes -o ConnectTimeout=6 "$PI_SSH_HOST" \
        "pm2 describe $PI_PROD_SERVICE 2>/dev/null | grep -E 'status|restarts' || true" 2>/dev/null || true)"
    fi
    if [[ -n "$line" ]]; then
      case "$line" in
        online*) ok "$PI_PROD_SERVICE: $line" ;;
        *)       bad "$PI_PROD_SERVICE: $line" ;;
      esac
    else
      warn "could not read pm2 status for $PI_PROD_SERVICE"
    fi
  else
    bad "cannot ssh to $PI_SSH_HOST (key/agent/network?) — deploy will fail"
  fi

  head1 "LIVE SITE REACHABLE"
  probe_url "$PROD_URL/" "200" "homepage"
  printf "\n"
}

# ╭───────────────────────────────────────────────────────────────────────╮
# │ verify — confirm the live redirect actually works                      │
# ╰───────────────────────────────────────────────────────────────────────╯
cmd_verify() {
  local code="${1:-}"
  head1 "VERIFY LIVE SITE"
  probe_url "$PROD_URL/" "200" "homepage"
  if [[ -z "$code" ]]; then
    # pick the first enabled code from codes.json as a sample
    if have jq; then
      code="$(jq -r '.codes[] | select(.enabled==true) | "\(.customerId)/\(.qid)"' codes.json 2>/dev/null | head -1)"
    else
      code="$(node -e "const c=require('./codes.json').codes.find(x=>x.enabled);if(c)console.log(c.customerId+'/'+c.qid)" 2>/dev/null)"
    fi
    [[ -n "$code" ]] && info "no code given — testing first enabled code: $code"
  fi
  if [[ -n "$code" ]]; then
    code="${code#/q/}"            # tolerate a leading /q/
    probe_url "$PROD_URL/q/$code" "302" "/q/$code redirect"
    local loc
    loc="$(curl -sI --max-time 6 "$PROD_URL/q/$code" 2>/dev/null | tr -d '\r' | awk -F': ' 'tolower($1)=="location"{print $2}')"
    [[ -n "$loc" ]] && info "redirects to: $loc"
  fi
  printf "\n"
}

probe_url() { # $1 url, $2 expected status, $3 label
  local url="$1" want="$2" label="$3" got
  got="$(curl -s -o /dev/null -w '%{http_code}' --max-time 6 "$url" 2>/dev/null || echo 000)"
  if [[ "$got" == "$want" ]]; then ok "$label → HTTP $got"
  elif [[ "$got" == "000" ]]; then bad "$label → no response (down / unreachable)"
  else warn "$label → HTTP $got (expected $want)"; fi
}

# ╭───────────────────────────────────────────────────────────────────────╮
# │ tag — freeze release/N from the current commit                         │
# ╰───────────────────────────────────────────────────────────────────────╯
cmd_tag() {
  local n="${1:-}"
  [[ -z "$n" ]] && { n="$(next_release_n)"; info "no number given — using next: $n"; }
  [[ "$n" =~ ^[0-9]+$ ]] || die "tag number must be a positive integer (got '$n')"
  head1 "TAG release/$n"
  printf "  from commit ${BOLD}%s${RESET}  %s\n" \
    "$(git rev-parse --short HEAD)" "$(git log -1 --pretty=%s)"
  if ! git diff --quiet -- static/codes.json || ! git diff --cached --quiet -- static/codes.json; then
    die "codes.json is not committed — commit it first, then tag."
  fi
  if git rev-parse "release/$n" >/dev/null 2>&1; then
    die "release/$n already exists (tags are immutable — use the next number)."
  fi
  confirm "Create and push release/$n at this commit?" || { warn "cancelled."; return; }
  npm run --silent tag -- "$n"
  ok "tagged. Next: ./ops.sh deploy $n"
  printf "\n"
}

# ╭───────────────────────────────────────────────────────────────────────╮
# │ deploy — build release/N and ship it to production                     │
# ╰───────────────────────────────────────────────────────────────────────╯
cmd_deploy() {
  local n="${1:-}"
  [[ -z "$n" ]] && die "which release? usage: ./ops.sh deploy <N>"
  n="${n#release/}"
  [[ "$n" =~ ^[0-9]+$ ]] || die "release number must be a positive integer (got '$n')"
  git rev-parse "release/$n" >/dev/null 2>&1 || die "release/$n does not exist — tag it first (./ops.sh tag $n)."

  head1 "DEPLOY release/$n → PRODUCTION"
  printf "  target  : ${BOLD}%s${RESET} (%s)\n" "$DEPLOY_TARGET" "$PROD_URL"
  printf "  commit  : %s\n" "$(git rev-list -n1 --abbrev-commit "release/$n")"
  printf "  current : %s (will become the rollback target)\n" "$(state_get '.current.tag')"
  printf "\n  ${DIM}phases: snapshot → build → deploy → state → commit → push${RESET}\n"
  if [[ "${OFFLINE:-}" == "1" ]]; then warn "OFFLINE=1 — rehearsal, nothing real is shipped"; fi
  confirm "Ship release/$n to production now?" || { warn "cancelled."; return; }

  if npm run --silent deploy -- "$n"; then
    head1 "POST-DEPLOY CHECK"
    cmd_verify
    ok "release/$n is live. Rollback with: ./ops.sh rollback"
  else
    die "deploy failed. Nothing live changed unless you saw the 'state' phase succeed. Re-run after fixing the cause."
  fi
}

# ╭───────────────────────────────────────────────────────────────────────╮
# │ rollback — step back to the previous release                           │
# ╰───────────────────────────────────────────────────────────────────────╯
cmd_rollback() {
  head1 "ROLLBACK"
  local cur target
  cur="$(state_get '.current.tag')"
  target="$(state_get '.previous[0].tag')"
  [[ -z "$target" ]] && die "nothing to roll back to — the previous stack is empty."
  printf "  live now      : ${BOLD}%s${RESET}\n" "$cur"
  printf "  roll back to  : ${BOLD}${YELLOW}%s${RESET}  (commit %s)\n" \
    "$target" "$(state_get '.previous[0].commit')"
  if [[ "${OFFLINE:-}" == "1" ]]; then warn "OFFLINE=1 — rehearsal, nothing real is shipped"; fi
  confirm "Roll production back from $cur to $target?" || { warn "cancelled."; return; }

  if npm run --silent rollback; then
    head1 "POST-ROLLBACK CHECK"
    cmd_verify
    ok "rolled back to $target. To go forward again: ./ops.sh deploy ${cur#release/}"
  else
    die "rollback failed — production unchanged unless the 'state' phase ran. Fix the cause and retry."
  fi
}

# ── help / dispatch ───────────────────────────────────────────────────────
cmd_help() {
  sed -n '3,22p' "$SCRIPT_DIR/ops.sh" | sed 's/^# \{0,1\}//'
}

main() {
  local cmd="${1:-status}"; shift || true
  case "$cmd" in
    status|st)            cmd_status "$@" ;;
    releases|rel|history) cmd_releases "$@" ;;
    diagnose|diag|doctor) cmd_diagnose "$@" ;;
    verify|check)         cmd_verify "$@" ;;
    tag)                  cmd_tag "$@" ;;
    deploy|ship)          cmd_deploy "$@" ;;
    rollback|undo)        cmd_rollback "$@" ;;
    help|-h|--help)       cmd_help ;;
    *) die "unknown command '$cmd' — try: ./ops.sh help" ;;
  esac
}
main "$@"
