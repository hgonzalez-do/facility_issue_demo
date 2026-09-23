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

existing="$(curl -sf "${AUTH[@]}" "$API" \
  | jq -r --arg a "$ACTOR" '.connections[]? | select(.provider=="github" and .user_id==$a) | .status' \
  | head -1 || true)"

if [ "$existing" = "active" ]; then
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
  printf "\n  %s✓%s GitHub already authorized for actor %s\n\n" "$GREEN" "$RESET" "$ACTOR"
  exit 0
fi

printf "\n  %sAuthorize GitHub for Action Gateway%s\n\n" "$BOLD" "$RESET"
printf "    %s\n\n" "$url"
printf "    verification code  %s%s%s\n" "$BOLD" "$code" "$RESET"
printf "    actor              %s\n" "$ACTOR"
[ -n "$exp" ] && printf "    expires            %s\n" "$exp"
printf "\n  %sLinks are one-time. Re-run this script for a fresh one.%s\n" "$DIM" "$RESET"
printf "  %sVerify afterwards with: ./scripts/connect-github.sh%s\n\n" "$DIM" "$RESET"
