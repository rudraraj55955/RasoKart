#!/usr/bin/env bash
#
# scripts/classify-deployment.sh
#
# Classifies a git diff (BASE_SHA..HEAD_SHA) as either:
#   frontend_auto       - every changed file matches the conservative
#                          presentation-only ALLOWLIST below.
#   sensitive_approval  - anything else, including empty/failed diffs.
#
# Philosophy: ALLOWLIST, not denylist. A file must positively match one of
# the known-safe patterns to qualify for automatic deployment. Any file that
# doesn't match, or that we can't confidently classify, defaults to
# sensitive_approval. When in doubt, this script is wrong on the side of
# requiring a human.
#
# Usage:
#   scripts/classify-deployment.sh <base-sha> <head-sha>
#
# Output (to stdout, machine-readable, last two lines):
#   DEPLOYMENT_TYPE=frontend_auto|sensitive_approval
#   REASON=<short human-readable reason>
#
# Also writes a full breakdown (changed files + per-file verdict) to stderr
# and to $GITHUB_STEP_SUMMARY when running inside GitHub Actions.
#
set -Eeuo pipefail

BASE_SHA="${1:-}"
HEAD_SHA="${2:-}"

if [ -z "$BASE_SHA" ] || [ -z "$HEAD_SHA" ]; then
  echo "Usage: $0 <base-sha> <head-sha>" >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# The allowlist: conservative, built from the REAL directories in this repo
# (artifacts/rpay/src). Every entry here is pure presentation — no data
# fetching, no auth, no business logic:
#
#   artifacts/rpay/src/styles/**       - standalone CSS files
#   artifacts/rpay/src/index.css       - global stylesheet
#   artifacts/rpay/src/components/ui/**- shadcn/ui primitives (buttons, cards,
#                                        dialogs, etc.) - visual only, no
#                                        fetches, no route logic
#   artifacts/rpay/public/**           - static assets: images, icons,
#                                        favicon, manifest, robots.txt
#
# Deliberately EXCLUDED from the allowlist even though they are "frontend":
#   - src/pages/**        (business logic, data fetching, forms, routes)
#   - src/components/admin/**, src/components/merchant/**, src/components/layout/**
#     (wired to app state/business logic, not purely visual)
#   - src/hooks/**, src/lib/** (application logic)
# These are common places for silent business-logic changes to hide, so they
# always require approval even though they live under "frontend".
# ---------------------------------------------------------------------------
ALLOWLIST_PATTERNS=(
  '^artifacts/rpay/src/styles/.*\.css$'
  '^artifacts/rpay/src/index\.css$'
  '^artifacts/rpay/src/components/ui/.*\.(tsx|ts)$'
  '^artifacts/rpay/public/.*$'
)

# Hard-block patterns: even a file that happens to match the allowlist above
# is force-classified sensitive if it also matches one of these. Defense in
# depth in case an allowlist regex is ever loosened by mistake.
HARDBLOCK_PATTERNS=(
  '(^|/)\.github/workflows/'
  '(^|/)\.env($|\..*$)'
  '(^|/)package\.json$'
  '(^|/)pnpm-lock\.yaml$'
  '(^|/)pnpm-workspace\.yaml$'
  '(^|/)scripts/deploy-.*\.sh$'
  '(^|/)scripts/classify-deployment\.sh$'
  '(^|/)scripts/bootstrap-.*\.sh$'
  '(^|/)lib/db/'
  '(^|/)lib/api-spec/'
  '(^|/)lib/api-client-react/generated/'
  '(^|/)lib/api-zod/generated/'
  '(^|/)artifacts/api-server/'
  '(^|/)\.replit-artifact/'
  '\.sql$'
  '\.dump(\.enc)?$'
)

CHANGED_FILES="$(git diff --name-only "$BASE_SHA" "$HEAD_SHA" || true)"

if [ -z "$CHANGED_FILES" ]; then
  echo "DEPLOYMENT_TYPE=sensitive_approval"
  echo "REASON=No changed files could be determined between $BASE_SHA and $HEAD_SHA - defaulting to safe/manual."
  exit 0
fi

FILE_COUNT=0
NON_ALLOWLISTED=()
BLOCKED_BY_HARDBLOCK=()

matches_any() {
  local file="$1"
  shift
  local pattern
  for pattern in "$@"; do
    if echo "$file" | grep -qE "$pattern"; then
      return 0
    fi
  done
  return 1
}

while IFS= read -r file; do
  [ -z "$file" ] && continue
  FILE_COUNT=$((FILE_COUNT + 1))

  if matches_any "$file" "${HARDBLOCK_PATTERNS[@]}"; then
    BLOCKED_BY_HARDBLOCK+=("$file")
    continue
  fi

  if ! matches_any "$file" "${ALLOWLIST_PATTERNS[@]}"; then
    NON_ALLOWLISTED+=("$file")
  fi
done <<< "$CHANGED_FILES"

{
  echo "### Deployment classification"
  echo ""
  echo "Comparing \`$BASE_SHA\` -> \`$HEAD_SHA\` ($FILE_COUNT changed file(s))"
  echo ""
  echo "**Changed files:**"
  echo '```'
  echo "$CHANGED_FILES"
  echo '```'
} >&2

if [ ${#BLOCKED_BY_HARDBLOCK[@]} -gt 0 ] || [ ${#NON_ALLOWLISTED[@]} -gt 0 ]; then
  {
    echo ""
    echo "**Result: sensitive_approval**"
    if [ ${#BLOCKED_BY_HARDBLOCK[@]} -gt 0 ]; then
      echo ""
      echo "Hard-blocked paths (always require approval regardless of allowlist):"
      printf -- '- %s\n' "${BLOCKED_BY_HARDBLOCK[@]}"
    fi
    if [ ${#NON_ALLOWLISTED[@]} -gt 0 ]; then
      echo ""
      echo "Files outside the presentation-only allowlist:"
      printf -- '- %s\n' "${NON_ALLOWLISTED[@]}"
    fi
  } >&2

  ALL_BLOCKING=("${BLOCKED_BY_HARDBLOCK[@]}" "${NON_ALLOWLISTED[@]}")
  REASON="Blocked by: ${ALL_BLOCKING[*]}"
  echo "DEPLOYMENT_TYPE=sensitive_approval"
  echo "REASON=$REASON"
  exit 0
fi

{
  echo ""
  echo "**Result: frontend_auto**"
  echo ""
  echo "Every changed file matched the presentation-only allowlist (CSS/styles,"
  echo "static public/ assets, or shadcn ui/ primitives with no business logic)."
} >&2

echo "DEPLOYMENT_TYPE=frontend_auto"
echo "REASON=All $FILE_COUNT changed file(s) matched the presentation-only allowlist (styles, public assets, ui primitives)."
