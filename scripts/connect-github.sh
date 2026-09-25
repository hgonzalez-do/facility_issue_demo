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
#   ./scripts/connect-github.sh --force   re-check and print status
#
# A caveat this script cannot work around. The connection record and the
# underlying GitHub token expire independently: the token can go stale while
# the record still reports "active", and the API refuses to mint a new
# authorization link for a connection it believes is fine. The symptom is
# tool calls failing with "requires an OAuth connection" while everything
# here looks healthy, and issues silently never appearing.
#
# When that happens, the agent's own run output contains a fresh connect link
# and verification code — Action Gateway mints one on the failure. Use that,
# or revoke the connection in the control panel (Managed Agents > Action
# Gateway > Connections) and run this script again.
#
# The actor is the subtle part. Action Gateway resolves a connection by
# actor id, and a *trigger-started* session runs as your DigitalOcean user
# UUID — not as your username. A connection authorized against any other
# actor is invisible to the demo, and the only symptom is issues silently
# never appearing. This script always targets the UUID.

set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -t 1 ]; then BOLD=$'\033[1m'; GREEN=$'\033[32m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else BOLD=""; GREEN=""; DIM=""; RESET=""; fi

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

existing="$(curl -sf "${AUTH[@]}" "$API" \
  | jq -r --arg a "$ACTOR" '.connections[]? | select(.provider=="github" and .user_id==$a) | .status' \
  | head -1 || true)"

if [ "$existing" = "active" ] && [ -z "$force" ]; then
  printf "\n  %s✓%s GitHub is already authorized for actor %s\n\n" "$GREEN" "$RESET" "$ACTOR"
  exit 0
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
  printf "  behind this record has expired. Revoke the connection in the control\n"
  printf "  panel and re-run, or use the link in the agent's run output.%s\n\n" "$RESET"
  exit 0
fi

printf "\n  %sAuthorize GitHub for Action Gateway%s\n\n" "$BOLD" "$RESET"
printf "    %s\n\n" "$url"
printf "    verification code  %s%s%s\n" "$BOLD" "$code" "$RESET"
printf "    actor              %s\n" "$ACTOR"
[ -n "$exp" ] && printf "    expires            %s\n" "$exp"
printf "\n  %sLinks are one-time. Re-run this script for a fresh one.%s\n" "$DIM" "$RESET"
printf "  %sVerify afterwards with: ./scripts/connect-github.sh%s\n\n" "$DIM" "$RESET"
