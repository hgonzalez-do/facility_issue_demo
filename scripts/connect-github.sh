#!/usr/bin/env bash
#
# Authorize the GitHub connection that Action Gateway uses to file issues.
#
#   ./scripts/connect-github.sh
#
# Prints a one-time authorization URL and verification code. Open the URL,
# approve, and the agents can create issues — no GitHub token ever reaches
# the sandbox.
#
# Why this needs a human: OAuth. deploy.sh can create every other resource
# unattended, but not this.
#
#   ./scripts/connect-github.sh --force   revoke and re-authorize
#
# Why --force exists. The connection record and the underlying GitHub token
# expire independently: the token can go stale while the record still reports
# "active", and the API refuses to mint a new authorization link for a
# connection it believes is fine. The symptom is tool calls failing with
# "requires an OAuth connection" while everything here looks healthy, and
# issues silently never appearing.
#
# --force DELETEs the connection first, which returns it to `revoked`, after
# which a POST issues a link again. That is the only call that breaks the
# deadlock — there is no "refresh" and no way to ask for a link while the
# record claims to be healthy.
#
# It is destructive by design: between the revoke and your click, no agent
# can file an issue. The agent's own run output also carries a fresh connect
# link on failure, so if a run is in flight, that link is the cheaper route.
#
# The actor is the subtle part. Action Gateway resolves a connection by
# actor id, and a *trigger-started* session runs as your DigitalOcean user
# UUID — not as your username. A connection authorized against any other
# actor is invisible to the demo, and the only symptom is issues silently
# never appearing. This script always targets the UUID.

set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -t 1 ]; then BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else BOLD=""; GREEN=""; YELLOW=""; DIM=""; RESET=""; fi

[ -f .env ] || { echo ".env not found" >&2; exit 1; }
set -a; . ./.env; set +a
[ -n "${DIGITALOCEAN_ACCESS_TOKEN:-}" ] || { echo "DIGITALOCEAN_ACCESS_TOKEN is not set in .env" >&2; exit 1; }
export DIGITALOCEAN_ACCESS_TOKEN
command -v doctl >/dev/null || { echo "doctl is required" >&2; exit 1; }
command -v jq    >/dev/null || { echo "jq is required" >&2; exit 1; }

ACTOR="$(doctl account get --format UUID --no-header | tr -d ' ')"
[ -n "$ACTOR" ] || { echo "could not determine your DigitalOcean user UUID" >&2; exit 1; }

API="https://api.digitalocean.com/v2/action-gateway/connections"
AUTH=(-H "Authorization: Bearer $DIGITALOCEAN_ACCESS_TOKEN")

force=""
[ "${1:-}" = "--force" ] && force=1

conn="$(curl -sf "${AUTH[@]}" "$API" \
  | jq -r --arg a "$ACTOR" '.connections[]? | select(.provider=="github" and .user_id==$a) | "\(.status) \(.id)"' \
  | head -1 || true)"
existing="${conn%% *}"
conn_id="${conn##* }"

if [ "$existing" = "active" ] && [ -z "$force" ]; then
  printf "\n  %s✓%s GitHub is already authorized for actor %s\n\n" "$GREEN" "$RESET" "$ACTOR"
  exit 0
fi

# --force means the record looks healthy and the token behind it is not, which
# is the one case where you actually need a new link and the one case the API
# refuses to mint one. DELETE returns the record to `revoked`, after which a
# POST issues a link again. There is no gentler call that achieves this.
if [ -n "$force" ] && [ -n "$conn_id" ] && [ "$conn_id" != "null" ]; then
  printf "\n  %s!%s Revoking the existing GitHub connection for actor %s\n" "$YELLOW" "$RESET" "$ACTOR"
  printf "    %sIssues will not be filed until you complete the link below.%s\n" "$DIM" "$RESET"
  if curl -sf -X DELETE "${AUTH[@]}" "$API/$conn_id" >/dev/null 2>&1; then
    printf "  %s✓%s revoked\n" "$GREEN" "$RESET"
  else
    printf "  %s!%s could not revoke %s — asking for a link anyway\n" "$YELLOW" "$RESET" "$conn_id"
  fi
fi

resp="$(curl -sf -X POST "${AUTH[@]}" -H "Content-Type: application/json" "$API" \
  -d "{\"provider\":\"github\",\"user_id\":\"$ACTOR\"}")" \
  || { echo "could not request an authorization link" >&2; exit 1; }

url="$(printf '%s' "$resp"  | jq -r '.authorization.connect_url // empty')"
code="$(printf '%s' "$resp" | jq -r '.authorization.verification_code // empty')"
exp="$(printf '%s' "$resp"  | jq -r '.authorization.expires_at // empty')"

if [ -z "$url" ]; then
  # The API returns no link when it considers the connection healthy, which
  # it does even when the token behind it has expired.
  printf "\n  %s✓%s GitHub connection is active for actor %s\n" "$GREEN" "$RESET" "$ACTOR"
  printf "  %sIf tools still fail with \"requires an OAuth connection\", the token\n" "$DIM"
  printf "  behind this record has expired. Re-run with --force to revoke it and\n"
  printf "  get a fresh link.%s\n\n" "$RESET"
  exit 0
fi

printf "\n  %sAuthorize GitHub for Action Gateway%s\n\n" "$BOLD" "$RESET"
printf "    %s\n\n" "$url"
printf "    verification code  %s%s%s\n" "$BOLD" "$code" "$RESET"
printf "    actor              %s\n" "$ACTOR"
[ -n "$exp" ] && printf "    expires            %s\n" "$exp"
printf "\n  %sLinks are one-time. Re-run this script for a fresh one.%s\n" "$DIM" "$RESET"
printf "  %sVerify afterwards with: ./scripts/connect-github.sh%s\n\n" "$DIM" "$RESET"
