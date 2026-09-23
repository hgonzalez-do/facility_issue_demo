#!/usr/bin/env bash
#
# Tears down everything deploy.sh created, in reverse order.
#
#   ./destroy.sh            # asks first, shows what it will delete
#   ./destroy.sh --yes      # no prompt
#
# Reads .deploy-state.json for ids, and falls back to matching on STACK_NAME
# so it still works if that file was lost.

set -euo pipefail

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; RESET=""
fi

info() { printf "  %s\n" "$*"; }
ok()   { printf "  %s✓%s %s\n" "$GREEN" "$RESET" "$*"; }
die()  { printf "\n%s✗ %s%s\n\n" "$RED$BOLD" "$*" "$RESET" >&2; exit 1; }

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE=".deploy-state.json"

[ -f .env ] || die ".env not found."
set -a; # shellcheck disable=SC1091
source .env; set +a

: "${STACK_NAME:=complaints-dept}"
[ -n "${DIGITALOCEAN_ACCESS_TOKEN:-}" ] || die "DIGITALOCEAN_ACCESS_TOKEN is not set in .env"
export DIGITALOCEAN_ACCESS_TOKEN

command -v doctl >/dev/null || die "doctl is required."
command -v jq    >/dev/null || die "jq is required."

state_get() { [ -f "$STATE_FILE" ] && jq -r --arg k "$1" '.[$k] // empty' "$STATE_FILE" || true; }

DB_CLUSTER_NAME="${STACK_NAME}-db"

app_id="$(state_get app_id)"
[ -n "$app_id" ] || app_id="$(doctl apps list --format ID,Spec.Name --no-header 2>/dev/null \
  | awk -v n="$STACK_NAME" '$2==n {print $1}' | head -1)"

db_id="$(state_get db_cluster_id)"
[ -n "$db_id" ] || db_id="$(doctl databases list --format ID,Name --no-header 2>/dev/null \
  | awk -v n="$DB_CLUSTER_NAME" '$2==n {print $1}' | head -1)"

webhook_id="$(state_get webhook_trigger_id)"
cron_id="$(state_get cron_trigger_id)"
for pair in "webhook_id:${STACK_NAME}-intake" "cron_id:${STACK_NAME}-summary"; do
  var="${pair%%:*}"; name="${pair#*:}"
  if [ -z "${!var}" ]; then
    found="$(doctl harness-runtime triggers list --output json 2>/dev/null \
      | jq -r --arg n "$name" '.[]? | select(.name==$n) | .trigger_id // .id' | head -1)"
    printf -v "$var" '%s' "$found"
  fi
done

printf "\n%sThis will permanently delete:%s\n\n" "$BOLD$RED" "$RESET"
[ -n "$webhook_id" ] && info "webhook trigger  ${STACK_NAME}-intake   ($webhook_id)"
[ -n "$cron_id" ]    && info "cron trigger     ${STACK_NAME}-summary  ($cron_id)"
[ -n "$app_id" ]     && info "app              ${STACK_NAME}          ($app_id)"
[ -n "$db_id" ]      && info "database         ${DB_CLUSTER_NAME}     ($db_id)  ${RED}and every ticket in it${RESET}"

if [ -z "$webhook_id$cron_id$app_id$db_id" ]; then
  printf "\n  Nothing found for stack '%s'. Nothing to do.\n\n" "$STACK_NAME"
  exit 0
fi

if [ "${1:-}" != "--yes" ] && [ "${1:-}" != "-y" ]; then
  printf "\n  Type the stack name to confirm: "
  read -r reply
  [ "$reply" = "$STACK_NAME" ] || die "Did not match. Nothing deleted."
fi

printf "\n"
[ -n "$webhook_id" ] && { doctl harness-runtime triggers delete "$webhook_id" --force >/dev/null 2>&1 && ok "deleted webhook trigger" || info "webhook trigger already gone"; }
[ -n "$cron_id" ]    && { doctl harness-runtime triggers delete "$cron_id" --force >/dev/null 2>&1 && ok "deleted cron trigger" || info "cron trigger already gone"; }
[ -n "$app_id" ]     && { doctl apps delete "$app_id" --force >/dev/null 2>&1 && ok "deleted app" || info "app already gone"; }
[ -n "$db_id" ]      && { doctl databases delete "$db_id" --force >/dev/null 2>&1 && ok "deleted database" || info "database already gone"; }

[ -f "$STATE_FILE" ] && rm -f "$STATE_FILE" && ok "cleared .deploy-state.json"

printf "\n  %sGone.%s Sessions already run are billed; nothing further will start.\n\n" "$BOLD" "$RESET"
