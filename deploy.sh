#!/usr/bin/env bash
#
# The Complaints Department — one-command deploy.
#
#   cp .env.example .env    # fill in the marked values
#   ./deploy.sh
#
# Stands up, on your own DigitalOcean team:
#
#   1. a Managed Postgres cluster, with the schema and two least-privilege roles
#   2. a Harness Runtime webhook trigger  — one microVM per complaint
#   3. a Harness Runtime cron trigger     — the closing executive summary
#   4. an App Platform service            — the form, the dashboard, the wall
#
# Re-running is safe: every step checks for what it already made.
# Tear the whole thing down with ./destroy.sh.

set -euo pipefail

# ── output ───────────────────────────────────────────────────────────────────

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

step()  { printf "\n%s▸ %s%s\n" "$BOLD$BLUE" "$*" "$RESET"; }
info()  { printf "  %s\n" "$*"; }
ok()    { printf "  %s✓%s %s\n" "$GREEN" "$RESET" "$*"; }
warn()  { printf "  %s!%s %s\n" "$YELLOW" "$RESET" "$*"; }
die()   { printf "\n%s✗ %s%s\n\n" "$RED$BOLD" "$*" "$RESET" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

STATE_FILE="$SCRIPT_DIR/.deploy-state.json"

# ── config ───────────────────────────────────────────────────────────────────

[ -f .env ] || die ".env not found. Start with: cp .env.example .env"

set -a
# shellcheck disable=SC1091
source .env
set +a

: "${STACK_NAME:=complaints-dept}"
: "${DO_REGION:=nyc3}"
: "${GITHUB_BRANCH:=main}"
: "${APP_SIZE:=basic-xxs}"
: "${DB_SIZE:=db-s-1vcpu-1gb}"
: "${DB_VERSION:=17}"
: "${INFERENCE_BASE_URL:=https://inference.do-ai.run}"
: "${INFERENCE_MODEL:=anthropic-claude-opus-5}"
: "${MARS_TICKET_TABLE:=tickets}"
: "${DB_NAME:=complaints}"
: "${GITHUB_ISSUE_REPO:=}"
: "${GITHUB_ISSUE_TOKEN:=}"
: "${SUMMARY_CRON:=}"
: "${SUMMARY_TIMEZONE:=America/New_York}"

# App Platform regions are the datacentre without the trailing digit.
DO_REGION_SLUG="$(printf '%s' "$DO_REGION" | sed -E 's/[0-9]+$//')"
DB_CLUSTER_NAME="${STACK_NAME}-db"

INFERENCE_HOST="$(printf '%s' "$INFERENCE_BASE_URL" | sed -E 's#^https?://##; s#/.*$##')"

# ── preflight ────────────────────────────────────────────────────────────────

step "Preflight"

for bin in doctl jq node dig; do
  command -v "$bin" >/dev/null 2>&1 || die "$bin is required but not on PATH."
done

node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge 22 ] || die "Node 22+ required (found $(node -v))."

missing=()
[ -n "${DIGITALOCEAN_ACCESS_TOKEN:-}" ] || missing+=("DIGITALOCEAN_ACCESS_TOKEN")
[ -n "${GITHUB_REPO:-}" ]              || missing+=("GITHUB_REPO")
[ -n "${ADMIN_PASSWORD:-}" ]           || missing+=("ADMIN_PASSWORD")
[ ${#missing[@]} -eq 0 ] || die "Missing in .env: ${missing[*]}"

# Inference falls back to the DO token, which is a valid credential for it.
: "${INFERENCE_API_KEY:=$DIGITALOCEAN_ACCESS_TOKEN}"

if [ "${ADMIN_PASSWORD}" = "complaints" ]; then
  warn "ADMIN_PASSWORD is still the example value. The dashboard will be trivially guessable."
fi

export DIGITALOCEAN_ACCESS_TOKEN
doctl account get >/dev/null 2>&1 || die "doctl cannot authenticate with DIGITALOCEAN_ACCESS_TOKEN."

account="$(doctl account get --format Email --no-header 2>/dev/null | tr -d ' ')"
ok "doctl authenticated as $account"
info "stack:    $STACK_NAME"
info "region:   $DO_REGION (app region $DO_REGION_SLUG)"
info "repo:     $GITHUB_REPO @ $GITHUB_BRANCH"
info "model:    $INFERENCE_MODEL via $INFERENCE_HOST"

# Warn early rather than after a paid cluster exists.
if ! doctl harness-runtime triggers list >/dev/null 2>&1; then
  warn "Harness Runtime (MARS) is not reachable for this team."
  warn "It is in public preview — the deploy will stop before creating triggers."
fi

# ── helpers ──────────────────────────────────────────────────────────────────

# doctl returns a bare object from some subcommands and a single-element array
# from others. `first_of` normalises both so field lookups cannot blow up.
first_of() { jq -r 'if type=="array" then (.[0] // {}) else . end | '"$1"' // empty'; }

# ── state ────────────────────────────────────────────────────────────────────
# Records what was created so a re-run is idempotent and destroy.sh knows the
# blast radius. Contains the webhook secret, so it is gitignored.

state_get() { [ -f "$STATE_FILE" ] && jq -r --arg k "$1" '.[$k] // empty' "$STATE_FILE" || true; }
state_set() {
  local tmp; tmp="$(mktemp)"
  [ -f "$STATE_FILE" ] || echo '{}' > "$STATE_FILE"
  jq --arg k "$1" --arg v "$2" '.[$k] = $v' "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
  chmod 600 "$STATE_FILE"
}

# ── 1. Managed Postgres ──────────────────────────────────────────────────────

step "1/5  Managed Postgres"

db_id="$(doctl databases list --format ID,Name --no-header 2>/dev/null \
  | awk -v n="$DB_CLUSTER_NAME" '$2==n {print $1}' | head -1)"

if [ -n "$db_id" ]; then
  ok "cluster $DB_CLUSTER_NAME already exists ($db_id)"
else
  info "creating $DB_CLUSTER_NAME ($DB_SIZE, $DO_REGION) — this takes a few minutes"
  # `databases create` has no --format/--no-header, and --wait writes progress
  # to stdout, so its output is not parseable. Create, then look the id up by
  # name through the same path the already-exists branch uses.
  doctl databases create "$DB_CLUSTER_NAME" \
    --engine pg --version "$DB_VERSION" --size "$DB_SIZE" --num-nodes 1 \
    --region "$DO_REGION" --wait >/dev/null \
    || die "cluster creation failed."
  db_id="$(doctl databases list --format ID,Name --no-header 2>/dev/null \
    | awk -v n="$DB_CLUSTER_NAME" '$2==n {print $1}' | head -1)"
  [ -n "$db_id" ] || die "cluster created but could not be found by name."
  ok "created $db_id"
fi
state_set db_cluster_id "$db_id"

info "waiting for cluster to report online"
for _ in $(seq 1 60); do
  status="$(doctl databases get "$db_id" --format Status --no-header 2>/dev/null | tr -d ' ')"
  [ "$status" = "online" ] && break
  sleep 10
done
[ "$status" = "online" ] || die "cluster $db_id is '$status', not online."
ok "online"

doctl databases db list "$db_id" --format Name --no-header 2>/dev/null | grep -qx "$DB_NAME" \
  && ok "database '$DB_NAME' exists" \
  || { doctl databases db create "$db_id" "$DB_NAME" >/dev/null && ok "created database '$DB_NAME'"; }

conn_json="$(doctl databases connection "$db_id" --output json)"
DB_HOST="$(echo "$conn_json" | first_of '.host')"
DB_PORT="$(echo "$conn_json" | first_of '.port')"
DB_USER="$(echo "$conn_json" | first_of '.user')"
DB_PASS="$(echo "$conn_json" | first_of '.password')"

ADMIN_DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=require"

# The MARS sandbox reaches Postgres over the cluster's public endpoint.
# VPC attachment would be better, but MARS currently rejects it in every
# region available to this team, so the agent manifests allowlist this host
# in `egress` and rely on TLS plus a tightly scoped role.
DB_PUBLIC_HOST="$DB_HOST"

# Resolved to an IP because the agent manifests need `egress.allow_ips` for
# it: a host allowlist only passes HTTP(S), and Postgres is on 25060.
DB_PUBLIC_IP="$(dig +short "$DB_PUBLIC_HOST" 2>/dev/null | grep -E '^[0-9.]+$' | head -1)"
[ -n "$DB_PUBLIC_IP" ] || die "could not resolve $DB_PUBLIC_HOST to an IP."
ok "database endpoint $DB_PUBLIC_HOST ($DB_PUBLIC_IP)"

# NOTE: do not add trusted sources to this cluster. The first rule turns the
# allowlist on and blocks everything not named — including the MARS sandboxes,
# whose egress addresses are not published.

# ── 2. schema + least-privilege roles ────────────────────────────────────────

step "2/5  Schema and roles"

MARS_DB_PASSWORD="$(state_get mars_db_password)"
MARS_REPORTER_PASSWORD="$(state_get mars_reporter_password)"
[ -n "$MARS_DB_PASSWORD" ]       || MARS_DB_PASSWORD="$(openssl rand -hex 24)"
[ -n "$MARS_REPORTER_PASSWORD" ] || MARS_REPORTER_PASSWORD="$(openssl rand -hex 24)"
state_set mars_db_password "$MARS_DB_PASSWORD"
state_set mars_reporter_password "$MARS_REPORTER_PASSWORD"

[ -d node_modules ] || { info "installing dependencies"; npm install --silent; }

# DigitalOcean signs cluster certs with its own CA. Fetch it so both the
# migration and the running app can verify the connection properly instead of
# turning verification off.
DB_CA_CERT="$(doctl databases get-ca "$db_id" --output json 2>/dev/null \
  | first_of '.certificate' | base64 --decode 2>/dev/null || true)"
if printf '%s' "$DB_CA_CERT" | grep -q 'BEGIN CERTIFICATE'; then
  ok "fetched cluster CA certificate"
else
  warn "could not fetch the cluster CA — connections will be encrypted but unverified"
  DB_CA_CERT=""
fi
export DB_CA_CERT

ADMIN_DATABASE_URL="$ADMIN_DATABASE_URL" \
MARS_DB_PASSWORD="$MARS_DB_PASSWORD" \
MARS_REPORTER_PASSWORD="$MARS_REPORTER_PASSWORD" \
  node scripts/migrate-postgres.js || die "migration failed."

MARS_DATABASE_URL="postgresql://mars_writer:${MARS_DB_PASSWORD}@${DB_PUBLIC_HOST}:${DB_PORT}/${DB_NAME}?sslmode=require"
MARS_REPORTER_DATABASE_URL="postgresql://mars_reporter:${MARS_REPORTER_PASSWORD}@${DB_PUBLIC_HOST}:${DB_PORT}/${DB_NAME}?sslmode=require"

# ── 3. webhook trigger ───────────────────────────────────────────────────────

step "3/5  Harness Runtime webhook trigger"

export INFERENCE_BASE_URL INFERENCE_MODEL INFERENCE_HOST INFERENCE_API_KEY
export MARS_TICKET_TABLE MARS_DATABASE_URL MARS_REPORTER_DATABASE_URL DB_PUBLIC_HOST DB_PUBLIC_IP
export GITHUB_ISSUE_REPO GITHUB_ISSUE_TOKEN

if [ -n "$GITHUB_ISSUE_TOKEN" ] && [ -n "$GITHUB_ISSUE_REPO" ]; then
  info "tickets will also open issues in $GITHUB_ISSUE_REPO"
elif [ -n "$GITHUB_ISSUE_REPO" ]; then
  warn "GITHUB_ISSUE_REPO is set but GITHUB_ISSUE_TOKEN is not — no issues will be opened"
fi

# The spec actually sent, and the extra --secret args, both depend on whether
# a GitHub token is configured. An empty --secret is rejected outright, and a
# placeholder would be worse: the prompt skips the issue step only when
# GITHUB_TOKEN is absent from the environment, so a dummy value would have the
# agent confidently posting to GitHub with a credential that cannot work.
COMPLAINT_SPEC="$SCRIPT_DIR/.complaint-agent.rendered.yaml"
if [ -n "$GITHUB_ISSUE_TOKEN" ]; then
  cp agents/complaint-agent.yaml "$COMPLAINT_SPEC"
  gh_secret=(--secret "GITHUB_TOKEN=${GITHUB_ISSUE_TOKEN}")
else
  grep -v '^  GITHUB_TOKEN:' agents/complaint-agent.yaml > "$COMPLAINT_SPEC"
  gh_secret=()
fi

WEBHOOK_TRIGGER="${STACK_NAME}-intake"
MARS_WEBHOOK_URL="$(state_get webhook_url)"
MARS_WEBHOOK_SECRET="$(state_get webhook_secret)"

existing="$(doctl harness-runtime triggers list --output json 2>/dev/null \
  | jq -r --arg n "$WEBHOOK_TRIGGER" '.[]? | select(.name==$n) | .trigger_id // .id' | head -1)"

if [ -n "$existing" ] && [ -n "$MARS_WEBHOOK_URL" ] && [ -n "$MARS_WEBHOOK_SECRET" ]; then
  # Push the current prompt and manifest to the existing trigger rather than
  # leaving it alone. Both are copied into the trigger at create time, so
  # without this an edit to agents/complaint-prompt.txt would sit in the repo
  # doing nothing while the old wording kept running — a silent no-op that is
  # very hard to spot from the outside. Updating in place keeps the webhook
  # URL and its secret, which recreating would not.
  doctl harness-runtime validate "$COMPLAINT_SPEC" >/dev/null \
    || die "agents/complaint-agent.yaml failed validation."

  update_out="$(doctl harness-runtime triggers update "$existing" \
    --prompt "$(cat agents/complaint-prompt.txt)" \
    --spec "$COMPLAINT_SPEC" \
    --secret "ANTHROPIC_API_KEY=${INFERENCE_API_KEY}" \
    --secret "MARS_DATABASE_URL=${MARS_DATABASE_URL}" \
    ${gh_secret[@]+"${gh_secret[@]}"} 2>&1)" \
    && ok "trigger $WEBHOOK_TRIGGER updated with the current prompt and manifest" \
    || warn "trigger $WEBHOOK_TRIGGER could not be updated, so it is STILL RUNNING ITS PREVIOUS PROMPT:
    $(printf '%s' "$update_out" | tail -3 | tr '\n' ' ')"
  state_set webhook_trigger_id "$existing"
else
  if [ -n "$existing" ]; then
    # The secret is shown once at creation. Without it in state we cannot sign
    # deliveries, so replace the trigger rather than ship a broken webhook.
    warn "trigger exists but its secret is not in local state — recreating"
    doctl harness-runtime triggers delete "$existing" --force >/dev/null 2>&1 || true
  fi

  doctl harness-runtime validate "$COMPLAINT_SPEC" >/dev/null \
    || die "agents/complaint-agent.yaml failed validation."

  info "creating $WEBHOOK_TRIGGER"
  created="$(doctl harness-runtime triggers create \
    --kind webhook --provider custom \
    --name "$WEBHOOK_TRIGGER" \
    --session-mode fresh \
    --spec "$COMPLAINT_SPEC" \
    --prompt "$(cat agents/complaint-prompt.txt)" \
    --secret "ANTHROPIC_API_KEY=${INFERENCE_API_KEY}" \
    --secret "MARS_DATABASE_URL=${MARS_DATABASE_URL}" \
    ${gh_secret[@]+"${gh_secret[@]}"} \
    --output json 2>&1)" || die "trigger creation failed:\n$created"

  MARS_WEBHOOK_URL="$(echo "$created" | first_of '(.webhook.webhook_url // .webhook_url)')"
  MARS_WEBHOOK_SECRET="$(echo "$created" | first_of '(.webhook_secret // .webhook.secret // .secret)')"
  trigger_id="$(echo "$created" | first_of '(.trigger_id // .id)')"

  [ -n "$MARS_WEBHOOK_URL" ]    || die "no webhook_url in trigger response:\n$created"
  [ -n "$MARS_WEBHOOK_SECRET" ] || die "no one-time secret in trigger response:\n$created"

  state_set webhook_trigger_id "$trigger_id"
  state_set webhook_url "$MARS_WEBHOOK_URL"
  state_set webhook_secret "$MARS_WEBHOOK_SECRET"
  ok "created — secret saved to .deploy-state.json (shown once, gitignored)"
fi

# ── 4. cron trigger ──────────────────────────────────────────────────────────

step "4/5  Harness Runtime cron trigger"

if [ -z "$SUMMARY_CRON" ]; then
  info "SUMMARY_CRON not set — skipping the scheduled summary."
  info "Set it in .env (e.g. '45 16 * * *') and re-run to add the closing beat."
else
  CRON_TRIGGER="${STACK_NAME}-summary"
  existing_cron="$(doctl harness-runtime triggers list --output json 2>/dev/null \
    | jq -r --arg n "$CRON_TRIGGER" '.[]? | select(.name==$n) | .trigger_id // .id' | head -1)"

  if [ -n "$existing_cron" ]; then
    doctl harness-runtime triggers update "$existing_cron" \
      --prompt "$(cat agents/summary-prompt.txt)" \
      --spec agents/summary-agent.yaml \
      --secret "ANTHROPIC_API_KEY=${INFERENCE_API_KEY}" \
      --secret "MARS_DATABASE_URL=${MARS_REPORTER_DATABASE_URL}" \
      >/dev/null 2>&1 \
      && ok "trigger $CRON_TRIGGER updated with the current prompt and manifest" \
      || warn "trigger $CRON_TRIGGER exists but could not be updated"
  else
    doctl harness-runtime validate agents/summary-agent.yaml >/dev/null \
      || die "agents/summary-agent.yaml failed validation."

    info "creating $CRON_TRIGGER — '$SUMMARY_CRON' $SUMMARY_TIMEZONE"
    cron_out="$(doctl harness-runtime triggers create \
      --kind cron \
      --name "$CRON_TRIGGER" \
      --cron-expr "$SUMMARY_CRON" \
      --timezone "$SUMMARY_TIMEZONE" \
      --session-mode fresh \
      --spec agents/summary-agent.yaml \
      --prompt "$(cat agents/summary-prompt.txt)" \
      --secret "ANTHROPIC_API_KEY=${INFERENCE_API_KEY}" \
      --secret "MARS_DATABASE_URL=${MARS_REPORTER_DATABASE_URL}" \
      --output json 2>&1)" || die "cron trigger creation failed:\n$cron_out"

    state_set cron_trigger_id "$(echo "$cron_out" | first_of '(.trigger_id // .id)')"
    ok "created"
  fi
fi

# ── 5. App Platform ──────────────────────────────────────────────────────────

step "5/5  App Platform"

SESSION_SECRET="$(state_get session_secret)"
[ -n "$SESSION_SECRET" ] || SESSION_SECRET="$(openssl rand -hex 32)"
state_set session_secret "$SESSION_SECRET"

export STACK_NAME DO_REGION_SLUG DB_CLUSTER_NAME DB_NAME APP_SIZE
export GITHUB_REPO GITHUB_BRANCH
export MARS_WEBHOOK_URL MARS_WEBHOOK_SECRET
export ADMIN_PASSWORD SESSION_SECRET

# Base64 so a multi-line PEM survives the YAML round trip intact.
DB_CA_CERT_B64="$(printf '%s' "$DB_CA_CERT" | base64 | tr -d '\n')"
export DB_CA_CERT_B64

# render-spec substitutes only our own placeholders, so App Platform's
# ${db.DATABASE_URL} binding survives intact. It fails loudly on a typo.
spec="$(node scripts/render-spec.js)" || die "could not render the app spec."

app_id="$(doctl apps list --format ID,Spec.Name --no-header 2>/dev/null \
  | awk -v n="$STACK_NAME" '$2==n {print $1}' | head -1)"

if [ -n "$app_id" ]; then
  info "updating existing app $app_id"
  printf '%s' "$spec" | doctl apps update "$app_id" --spec - --wait >/dev/null \
    || die "app update failed."
  ok "updated"
else
  info "creating app $STACK_NAME — first build takes a few minutes"
  app_id="$(printf '%s' "$spec" | doctl apps create --spec - --wait --format ID --no-header \
    | head -1 | tr -d ' ')" || die "app creation failed."
  [ -n "$app_id" ] || die "app creation returned no id."
  ok "created $app_id"
fi
state_set app_id "$app_id"

APP_URL="$(doctl apps get "$app_id" --format DefaultIngress --no-header | tr -d ' ')"

# Assert the web tier and the agents landed on the same database.
#
# When they do not, nothing errors: the app writes complaints to one database,
# the agents look for them in another, and every ticket insert fails a foreign
# key inside a sandbox you are not watching. The wall just stays empty. Worth
# eight lines to make that loud instead of mysterious.
live_db="$(doctl apps spec get "$app_id" --format json 2>/dev/null \
  | jq -r '.databases[]? | select(.name=="db") | .db_name // "defaultdb"')"
if [ "$live_db" = "$DB_NAME" ]; then
  ok "app and agents both on database '$DB_NAME'"
else
  die "database mismatch: the app is bound to '${live_db}' but the agents write to '${DB_NAME}'. Every ticket insert will fail a foreign key and the wall will stay empty. Check the db_name field in .do/app.template.yaml."
fi

# ── done ─────────────────────────────────────────────────────────────────────

printf "\n%s%s  The Complaints Department is open.%s\n\n" "$BOLD" "$GREEN" "$RESET"
printf "    form       %s/\n"             "$APP_URL"
printf "    QR (proj)  %s/qr\n"           "$APP_URL"
printf "    dashboard  %s/admin\n"        "$APP_URL"
printf "    wall       %s/admin/wall\n\n" "$APP_URL"
printf "    %sdatabase%s   %s\n" "$DIM" "$RESET" "$DB_CLUSTER_NAME"
printf "    %sapp%s        %s\n" "$DIM" "$RESET" "$app_id"
printf "    %smodel%s      %s\n" "$DIM" "$RESET" "$INFERENCE_MODEL"
if [ -n "$SUMMARY_CRON" ]; then
  printf "    %ssummary%s    '%s' %s\n" "$DIM" "$RESET" "$SUMMARY_CRON" "$SUMMARY_TIMEZONE"
fi
printf "\n  Sign in to the dashboard with ADMIN_PASSWORD from your .env.\n"
printf "  Tear it all down with ./destroy.sh\n\n"
