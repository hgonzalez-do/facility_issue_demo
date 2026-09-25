#!/usr/bin/env bash
#
# Delete every issue in the tracker, then re-align the ticket sequence.
#
#   ./scripts/clear-issues.sh          # shows what it will delete, asks first
#   ./scripts/clear-issues.sh --yes    # no prompt
#   ./scripts/clear-issues.sh --keep-db  # delete issues, leave the database
#
# Deliberately a human-run script, not something the app can do.
#
# Deleting an issue needs admin on the repository and is only exposed through
# GitHub's GraphQL API — `gh issue delete` wraps it. The credential that can
# do this is your `gh` login, which carries account-wide `repo` scope. The
# demo's own GitHub credential lives in Action Gateway, can create and update
# issues but not delete them, and is reachable only from inside a sandbox.
# That asymmetry is on purpose: the running demo should not be able to erase
# its own audit trail, and the web tier should not hold a token that could.
#
# Note what deletion does not do: GitHub never reuses an issue number. After
# clearing, the next issue is still the next number, which is why this script
# re-aligns the ticket sequence rather than resetting it to 1.

set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
else BOLD=""; DIM=""; RED=""; GREEN=""; RESET=""; fi

die() { printf "\n%s✗ %s%s\n\n" "$RED$BOLD" "$*" "$RESET" >&2; exit 1; }

yes=""; keep_db=""
for a in "$@"; do
  case "$a" in
    --yes|-y)  yes=1 ;;
    --keep-db) keep_db=1 ;;
    *) die "unknown flag: $a" ;;
  esac
done

[ -f .env ] || die ".env not found."
set -a; . ./.env; set +a
: "${GITHUB_ISSUE_REPO:=}"
[ -n "$GITHUB_ISSUE_REPO" ] || die "GITHUB_ISSUE_REPO is not set in .env"

command -v gh >/dev/null || die "the GitHub CLI (gh) is required: https://cli.github.com"
gh auth status >/dev/null 2>&1 || die "gh is not authenticated. Run: gh auth login"

mapfile -t numbers < <(gh issue list --repo "$GITHUB_ISSUE_REPO" --state all --limit 500 \
  --json number --jq '.[].number' 2>/dev/null || true)

if [ ${#numbers[@]} -eq 0 ]; then
  printf "\n  %s✓%s No issues in %s.\n" "$GREEN" "$RESET" "$GITHUB_ISSUE_REPO"
else
  printf "\n  %sAbout to permanently delete %d issue(s) from %s:%s\n\n" \
    "$BOLD$RED" "${#numbers[@]}" "$GITHUB_ISSUE_REPO" "$RESET"
  gh issue list --repo "$GITHUB_ISSUE_REPO" --state all --limit 500 \
    --json number,title --jq '.[] | "    #\(.number)  \(.title)"'
  printf "\n  %sDeletion is permanent — issues cannot be restored, unlike closing.%s\n" "$DIM" "$RESET"

  if [ -z "$yes" ]; then
    printf "\n  Type %sdelete%s to confirm: " "$BOLD" "$RESET"
    read -r reply
    [ "$reply" = "delete" ] || die "Did not match. Nothing deleted."
  fi

  printf "\n"
  for n in "${numbers[@]}"; do
    if gh issue delete "$n" --repo "$GITHUB_ISSUE_REPO" --yes >/dev/null 2>&1; then
      printf "    deleted #%s\n" "$n"
    else
      printf "    %s!%s could not delete #%s (needs admin on the repository)\n" "$RED" "$RESET" "$n"
    fi
  done
fi

# GitHub keeps counting from where it left off, so find where that is and
# point the ticket sequence at the same number. Otherwise ticket #1 is filed
# as issue #27 and every footer disagrees with the issue it sits on.
highest="$(gh issue list --repo "$GITHUB_ISSUE_REPO" --state all --limit 500 \
  --json number --jq 'if length == 0 then 0 else (max_by(.number).number) end' 2>/dev/null || echo 0)"

# Deleted issues are gone from the list but their numbers are still spent, so
# a probe is the only reliable way to read the counter back.
probe="$(gh api -X POST "repos/$GITHUB_ISSUE_REPO/issues" \
  -f title="counter probe" -f body="Delete me." --jq '.number' 2>/dev/null || true)"
if [ -n "$probe" ]; then
  gh issue delete "$probe" --repo "$GITHUB_ISSUE_REPO" --yes >/dev/null 2>&1 || true
  next=$((probe + 1))
else
  next=$((highest + 1))
  printf "\n  %s!%s Could not probe the issue counter; guessing #%s.\n" "$RED" "$RESET" "$next"
fi

printf "\n  Next GitHub issue will be %s#%s%s\n" "$BOLD" "$next" "$RESET"

if [ -n "$keep_db" ]; then
  printf "  %sDatabase left alone. Re-align it yourself with:%s\n" "$DIM" "$RESET"
  printf "    npm run db:reset -- --yes --start-at %s\n\n" "$next"
else
  npm run db:reset -- --yes --start-at "$next" >/dev/null 2>&1 \
    && printf "  %s✓%s Database wiped; next ticket is #%s, matching.\n\n" "$GREEN" "$RESET" "$next" \
    || printf "  %s!%s Database reset failed — run it yourself:\n    npm run db:reset -- --yes --start-at %s\n\n" "$RED" "$RESET" "$next"
fi
