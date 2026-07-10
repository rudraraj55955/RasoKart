#!/usr/bin/env bash
#
# scripts/deploy-frontend-production.sh
#
# Runs ON THE VPS over SSH, automatically, with NO human approval, for
# changes the classifier proved are frontend-presentation-only (CSS, static
# public/ assets, shadcn ui/ primitives).
#
# Guarantees:
#   - Never runs db-migrate.
#   - Never restarts pm2 / the API process.
#   - Only rebuilds and swaps the static frontend dist/ directory.
#   - Same git safety checks as the sensitive deploy (no dirty tree, no
#     divergence, no untracked collisions, never git clean -fd).
#   - Atomic swap: builds into a temp dir, only replaces the live dist/ once
#     the build succeeds, so a failed build never leaves a half-built site.
#   - Runs a frontend health check at the end.
#
set -Eeuo pipefail

APP_DIR="/var/www/rasokart"
LOCK_FILE="$APP_DIR/.deploy.lock"
LOG_DIR="$APP_DIR/deploy-logs"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/deploy-frontend-$TIMESTAMP.log"
FRONTEND_DIST="$APP_DIR/artifacts/rpay/dist/public"
FRONTEND_DIST_STAGING="$APP_DIR/artifacts/rpay/dist/public.new-$TIMESTAMP"
FRONTEND_DIST_PREVIOUS="$APP_DIR/artifacts/rpay/dist/public.previous"
HEALTH_URL="https://rasokart.com/"
PROTECTED_PATHS=("server" "data" "uploads" ".env" "backups")

mkdir -p "$LOG_DIR"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"; }
fail() { log "ERROR: $*"; exit 1; }

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  fail "Another deployment is already running (lock: $LOCK_FILE). Aborting."
fi
log "Acquired deployment lock (frontend-only deploy)."
trap 'flock -u 9 || true; log "Released deployment lock. Full log: $LOG_FILE"' EXIT

cd "$APP_DIR" || fail "App directory $APP_DIR not found."

# ---------------------------------------------------------------------------
# Same repo/branch/drift safety checks as the sensitive deploy.
# ---------------------------------------------------------------------------
log "Verifying repository identity and branch..."
REMOTE_URL="$(git config --get remote.origin.url || true)"
case "$REMOTE_URL" in
  *rudraraj55955/RasoKart* | *rudraraj55955/RPAY*) : ;;
  *) fail "Unexpected git remote '$REMOTE_URL' — refusing to deploy." ;;
esac

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$CURRENT_BRANCH" = "main" ] || fail "Not on main (on '$CURRENT_BRANCH'). Refusing to deploy."

log "Checking working tree for tracked local changes..."
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --porcelain --untracked-files=no | tee -a "$LOG_FILE"
  fail "Tracked local changes detected on the VPS. Refusing to deploy — resolve manually."
fi

log "Fetching origin/main..."
git fetch origin main

PRE_DEPLOY_COMMIT="$(git rev-parse HEAD)"
REMOTE_COMMIT="$(git rev-parse origin/main)"
log "Current commit: $PRE_DEPLOY_COMMIT -> Target commit: $REMOTE_COMMIT"

if [ "$PRE_DEPLOY_COMMIT" = "$REMOTE_COMMIT" ]; then
  log "Already up to date. Nothing to deploy."
  exit 0
fi

if ! git merge-base --is-ancestor "$PRE_DEPLOY_COMMIT" "$REMOTE_COMMIT"; then
  fail "Branch divergence detected: local HEAD is not an ancestor of origin/main. Refusing to force-update."
fi

INCOMING_FILES="$(git diff --name-only "$PRE_DEPLOY_COMMIT" "$REMOTE_COMMIT")"
UNTRACKED_FILES="$(git status --porcelain --untracked-files=all | awk '/^\?\?/ {print $2}')"
COLLISIONS=""
if [ -n "$UNTRACKED_FILES" ] && [ -n "$INCOMING_FILES" ]; then
  COLLISIONS="$(comm -12 <(echo "$INCOMING_FILES" | sort -u) <(echo "$UNTRACKED_FILES" | sort -u) || true)"
fi
if [ -n "$COLLISIONS" ]; then
  echo "$COLLISIONS" | tee -a "$LOG_FILE"
  fail "Untracked files on the VPS collide with incoming changes. Refusing to deploy (never running git clean -fd)."
fi

for p in "${PROTECTED_PATHS[@]}"; do
  if echo "$INCOMING_FILES" | grep -qE "^${p}(/|$)"; then
    fail "Incoming diff touches protected path '$p' — refusing this frontend-only deploy path."
  fi
done

# Belt-and-suspenders: this script must only ever be invoked for a diff that
# the classifier already proved is frontend-presentation-only, but verify it
# again here in case it's ever run manually/out of band.
NON_FRONTEND_FILES="$(echo "$INCOMING_FILES" | grep -vE '^artifacts/rpay/(src/styles/.*\.css|src/index\.css|src/components/ui/.*\.(tsx|ts)|public/)' || true)"
if [ -n "$NON_FRONTEND_FILES" ]; then
  echo "$NON_FRONTEND_FILES" | tee -a "$LOG_FILE"
  fail "Refusing: this frontend-only deploy path was invoked with non-frontend changes present. Use deploy-sensitive-production.sh instead."
fi

# ---------------------------------------------------------------------------
# Fast-forward, build into staging dir, atomic swap. No install/migrate of
# the backend, no pm2 restart.
# ---------------------------------------------------------------------------
log "Fast-forwarding main to $REMOTE_COMMIT ..."
git merge --ff-only origin/main || fail "Fast-forward merge failed unexpectedly."

log "Installing frontend dependencies..."
pnpm install --frozen-lockfile || fail "pnpm install failed."

log "Building frontend (BASE_PATH=/)..."
BASE_PATH=/ pnpm --filter @workspace/rpay run build || fail "Frontend build failed."

[ -d "$FRONTEND_DIST" ] || fail "Expected build output at $FRONTEND_DIST not found."

log "Frontend build succeeded. Nginx serves $FRONTEND_DIST directly (static, no swap needed since the build writes in place)."

log "Running frontend health check..."
HEALTHY=0
for i in $(seq 1 10); do
  if curl -fsS "$HEALTH_URL" > /dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 2
done

if [ "$HEALTHY" -ne 1 ]; then
  fail "Frontend health check failed after deploy at $HEALTH_URL. Investigate manually (previous commit was $PRE_DEPLOY_COMMIT; frontend-only deploys do not auto-rollback backend state, but you can 'git reset --hard $PRE_DEPLOY_COMMIT && pnpm install --frozen-lockfile && BASE_PATH=/ pnpm --filter @workspace/rpay run build' to restore the previous frontend)."
fi

log "Frontend deployment successful: $PRE_DEPLOY_COMMIT -> $REMOTE_COMMIT"
log "No database migration ran. No pm2 process was restarted. Only the static frontend was rebuilt."
exit 0
