#!/usr/bin/env bash
#
# scripts/deploy-sensitive-production.sh
#
# Runs ON THE VPS (invoked over SSH) ONLY after a human has clicked
# "Approve and deploy" on the GitHub "production-sensitive" Environment gate.
# Used for any change the classifier could not prove was
# presentation-only (backend, DB, auth, payouts, KYC, webhooks, infra,
# dependencies, etc.).
#
# Safety properties:
#   - Deployment lock: refuses to run if another deploy is in progress
#     (shared lock file with the frontend-only script - they never overlap).
#   - Timestamped logs under /var/www/rasokart/deploy-logs/.
#   - Refuses to proceed on a dirty working tree, branch divergence, or
#     untracked files that would collide with the pull — never runs
#     `git clean -fd`.
#   - Never touches server/, data/, uploads/, .env, backups/, or any runtime
#     files.
#   - Takes a full pg_dump backup before running migrations.
#   - Records the pre-deploy commit and rolls back to it (code + pm2 restart)
#     if build, restart, or the deep health check fails.
#   - Loads /var/www/rasokart/.env without ever printing its contents; never
#     overwrites .env.
#   - Never restores a Replit database dump or syncs Replit DB records — that
#     remains a deliberate, manual, separate process.
#
set -Eeuo pipefail

APP_DIR="/var/www/rasokart"
LOCK_FILE="$APP_DIR/.deploy.lock"
LOG_DIR="$APP_DIR/deploy-logs"
BACKUP_DIR="$APP_DIR/backups"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/deploy-sensitive-$TIMESTAMP.log"
PM2_APP="rasokart-api"
HEALTH_URL="https://rasokart.com/api/healthz/deep"
PROTECTED_PATHS=("server" "data" "uploads" ".env" "backups")

mkdir -p "$LOG_DIR" "$BACKUP_DIR"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"; }
fail() { log "ERROR: $*"; exit 1; }

# ---------------------------------------------------------------------------
# 0. Deployment lock.
# ---------------------------------------------------------------------------
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  fail "Another deployment is already running (lock: $LOCK_FILE). Aborting."
fi
log "Acquired deployment lock (sensitive/approved deploy)."

cleanup() { flock -u 9 || true; log "Released deployment lock. Full log: $LOG_FILE"; }
trap cleanup EXIT

cd "$APP_DIR" || fail "App directory $APP_DIR not found."

# ---------------------------------------------------------------------------
# 1. Verify repository identity and branch.
# ---------------------------------------------------------------------------
log "Verifying repository identity and branch..."
REMOTE_URL="$(git config --get remote.origin.url || true)"
case "$REMOTE_URL" in
  *rudraraj55955/RasoKart* | *rudraraj55955/RPAY*) : ;;
  *) fail "Unexpected git remote '$REMOTE_URL' — refusing to deploy." ;;
esac

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$CURRENT_BRANCH" = "main" ] || fail "Not on main (on '$CURRENT_BRANCH'). Refusing to deploy."

# ---------------------------------------------------------------------------
# 2. Preflight: fail safely on any local drift before pulling.
# ---------------------------------------------------------------------------
log "Checking working tree for tracked local changes..."
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --porcelain --untracked-files=no | tee -a "$LOG_FILE"
  fail "Tracked local changes detected on the VPS. Refusing to deploy — resolve manually (never auto-discarded)."
fi

log "Fetching origin/main..."
git fetch origin main

PRE_DEPLOY_COMMIT="$(git rev-parse HEAD)"
REMOTE_COMMIT="$(git rev-parse origin/main)"
log "Current commit:  $PRE_DEPLOY_COMMIT"
log "Target commit:   $REMOTE_COMMIT"

if [ "$PRE_DEPLOY_COMMIT" = "$REMOTE_COMMIT" ]; then
  log "Already up to date with origin/main. Nothing to deploy."
  exit 0
fi

if ! git merge-base --is-ancestor "$PRE_DEPLOY_COMMIT" "$REMOTE_COMMIT"; then
  DIVERGED_COMMITS="$(git log --oneline "$REMOTE_COMMIT..$PRE_DEPLOY_COMMIT" | tr '\n' ';')"
  if [ "${FORCE_RESET_TO_ORIGIN:-false}" = "true" ]; then
    log "WARN: Branch divergence detected — local HEAD ($PRE_DEPLOY_COMMIT) is not an ancestor of origin/main ($REMOTE_COMMIT)."
    log "WARN: FORCE_RESET_TO_ORIGIN=true — hard-resetting local HEAD to origin/main."
    log "WARN: VPS-only commits being abandoned: $DIVERGED_COMMITS"
    git reset --hard "$REMOTE_COMMIT"
    # Rollback target becomes the new HEAD (orphaned commits are gone).
    PRE_DEPLOY_COMMIT="$REMOTE_COMMIT"
  else
    fail "Branch divergence detected: local HEAD is not an ancestor of origin/main. Refusing to force-update. Re-run the workflow with force_reset_to_origin=true to override, or investigate manually. VPS-only commits: $DIVERGED_COMMITS"
  fi
fi

log "Checking for untracked-file collisions with incoming changes..."
INCOMING_FILES="$(git diff --name-only "$PRE_DEPLOY_COMMIT" "$REMOTE_COMMIT")"
UNTRACKED_FILES="$(git status --porcelain --untracked-files=all | awk '/^\?\?/ {print $2}')"
COLLISIONS=""
if [ -n "$UNTRACKED_FILES" ] && [ -n "$INCOMING_FILES" ]; then
  COLLISIONS="$(comm -12 <(echo "$INCOMING_FILES" | sort -u) <(echo "$UNTRACKED_FILES" | sort -u) || true)"
fi
if [ -n "$COLLISIONS" ]; then
  echo "$COLLISIONS" | tee -a "$LOG_FILE"
  fail "Untracked files on the VPS collide with incoming changes: $(echo "$COLLISIONS" | tr '\n' ',' ). Refusing to deploy (never running git clean -fd)."
fi

for p in "${PROTECTED_PATHS[@]}"; do
  if echo "$INCOMING_FILES" | grep -qE "^${p}(/|$)"; then
    fail "Incoming deploy touches protected path '$p' — refusing. Protected paths (server/, data/, uploads/, .env, backups/) are never modified by CI/CD."
  fi
done

# ---------------------------------------------------------------------------
# 3. Load environment without ever printing it. Never overwritten below.
# ---------------------------------------------------------------------------
[ -f "$APP_DIR/.env" ] || fail ".env not found at $APP_DIR/.env"
set -a
# shellcheck disable=SC1091
source "$APP_DIR/.env"
set +a
[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL missing after loading .env"
log ".env loaded (values not logged, file not modified)."

# ---------------------------------------------------------------------------
# 4. Database backup before ANY migration runs. This is a NEW backup of the
#    live production DB, taken now - it is never overwritten or replaced by
#    any Replit-side dump, and no Replit dump is ever restored here.
# ---------------------------------------------------------------------------
BACKUP_FILE="$BACKUP_DIR/rasokart-pre-deploy-$TIMESTAMP.sql.gz"
log "Backing up production database to $BACKUP_FILE ..."
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE" || fail "Database backup failed. Refusing to proceed without a backup."
log "Backup complete ($(du -h "$BACKUP_FILE" | cut -f1))."

# ---------------------------------------------------------------------------
# 5. Pull code (fast-forward only, already validated above).
# ---------------------------------------------------------------------------
log "Fast-forwarding main to $REMOTE_COMMIT ..."
git merge --ff-only origin/main || fail "Fast-forward merge failed unexpectedly."

# ---------------------------------------------------------------------------
# 6. Rollback helper - restores code + restarts pm2 on the previous commit.
#    Never touches the DB backup or attempts destructive DB rollback.
# ---------------------------------------------------------------------------
rollback() {
  log "!!! Rolling back application code to previous commit $PRE_DEPLOY_COMMIT !!!"
  git reset --hard "$PRE_DEPLOY_COMMIT"
  pnpm install --frozen-lockfile || true
  pnpm --filter @workspace/api-server run build || true
  pm2 restart "$PM2_APP" --update-env || true
  pm2 save || true
  BASE_PATH=/ pnpm --filter @workspace/rpay run build || true
  log "Rollback of application code complete. No database rollback was attempted automatically."
  log "If a migration in this deploy needs reverting, that is a deliberate manual DBA decision — see backup at $BACKUP_FILE."
}

# ---------------------------------------------------------------------------
# 7. Install, migrate, build, restart.
# ---------------------------------------------------------------------------
log "Installing dependencies..."
pnpm install --frozen-lockfile || { rollback; fail "pnpm install failed. Rolled back application code."; }

log "Running database migrations (idempotent, no TTY required)..."
pnpm --filter @workspace/scripts run db-migrate || { rollback; fail "Migration failed. Rolled back application code (migration itself is NOT auto-reverted - idempotent by design)."; }

log "Building API server..."
pnpm --filter @workspace/api-server run build || { rollback; fail "API server build failed. Rolled back."; }

log "Restarting API server via pm2..."
pm2 restart "$PM2_APP" --update-env || { rollback; fail "pm2 restart failed. Rolled back."; }
pm2 save

log "Building web frontend..."
BASE_PATH=/ pnpm --filter @workspace/rpay run build || { rollback; fail "Frontend build failed. Rolled back."; }

# ---------------------------------------------------------------------------
# 8. Deep health check - deployment is only considered successful if this
#    passes. Any failure triggers rollback. Never claim success otherwise.
# ---------------------------------------------------------------------------
log "Waiting for API to become healthy..."
HEALTHY=0
for i in $(seq 1 15); do
  if curl -fsS "$HEALTH_URL" > /tmp/deploy-healthz.json 2>/dev/null; then
    HEALTHY=1
    break
  fi
  sleep 2
done

if [ "$HEALTHY" -ne 1 ]; then
  cat /tmp/deploy-healthz.json 2>/dev/null | tee -a "$LOG_FILE" || true
  rollback
  fail "Deep health check did not return success after deploy. Rolled back application code to $PRE_DEPLOY_COMMIT."
fi
cat /tmp/deploy-healthz.json | tee -a "$LOG_FILE"
log "Deep health check passed."

log "Verifying documented demo/test credentials..."
pnpm --filter @workspace/scripts run verify-demo-credentials || { rollback; fail "Demo credential verification failed after deploy. Rolled back."; }

log "Deployment successful: $PRE_DEPLOY_COMMIT -> $REMOTE_COMMIT"
log "Backup retained at: $BACKUP_FILE (production DB was never overwritten by any Replit dump)."
exit 0
