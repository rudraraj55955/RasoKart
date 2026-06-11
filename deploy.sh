#!/usr/bin/env bash
# deploy.sh — RasoKart VPS deployment script
# Usage: sudo bash deploy.sh
# Run from: /var/www/rasokart

set -euo pipefail

# ─────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────
APP_DIR="/var/www/rasokart"
API_DIR="$APP_DIR/artifacts/api-server"
WEB_DIR="$APP_DIR/artifacts/rpay"
DIST_DIR="$WEB_DIR/dist/public"
PM2_NAME="rasokart-api"
LOG_FILE="/var/log/rasokart/deploy.log"
BRANCH="main"

# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()     { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✓ $*${NC}" | tee -a "$LOG_FILE"; }
warn()    { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠ $*${NC}" | tee -a "$LOG_FILE"; }
die()     { echo -e "${RED}[$(date '+%H:%M:%S')] ✗ $*${NC}" | tee -a "$LOG_FILE"; exit 1; }
step()    { echo -e "\n${YELLOW}━━ $* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" | tee -a "$LOG_FILE"; }

# ─────────────────────────────────────────────
# Preflight
# ─────────────────────────────────────────────
mkdir -p /var/log/rasokart
exec > >(tee -a "$LOG_FILE") 2>&1

[[ "$(pwd)" == "$APP_DIR" ]] || { cd "$APP_DIR" || die "Could not cd to $APP_DIR"; }

if [[ -z "${DATABASE_URL:-}" ]]; then
  # Try to load from PM2 ecosystem config if DATABASE_URL not set in env
  if [[ -f "$APP_DIR/ecosystem.config.cjs" ]]; then
    warn "DATABASE_URL not set in environment — attempting to read from ecosystem.config.cjs"
    DATABASE_URL=$(node -e "const c=require('./ecosystem.config.cjs'); const app=c.apps.find(a=>a.name==='$PM2_NAME'); console.log(app?.env?.DATABASE_URL||app?.env_production?.DATABASE_URL||'')" 2>/dev/null || true)
  fi
  [[ -z "${DATABASE_URL:-}" ]] && die "DATABASE_URL is not set. Export it before running: export DATABASE_URL=postgres://..."
fi
export DATABASE_URL

log "Starting RasoKart deployment — $(date)"
log "App dir : $APP_DIR"
log "Branch  : $BRANCH"

# ─────────────────────────────────────────────
# Step 1 — Pull latest code
# ─────────────────────────────────────────────
step "1/7  Pull latest code"
git fetch origin "$BRANCH"
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")
if [[ "$LOCAL" == "$REMOTE" ]]; then
  warn "Already up to date ($LOCAL). Re-running build anyway."
else
  git pull origin "$BRANCH"
  log "Updated $(git rev-parse --short HEAD) ← $(git rev-parse --short "$LOCAL")"
fi

# ─────────────────────────────────────────────
# Step 2 — Install dependencies
# ─────────────────────────────────────────────
step "2/7  Install dependencies"
pnpm install --frozen-lockfile
log "Dependencies installed"

# ─────────────────────────────────────────────
# Step 3 — Push DB schema (idempotent)
# ─────────────────────────────────────────────
step "3/7  Push DB schema"
pnpm --filter @workspace/db run push
log "Schema up to date"

# ─────────────────────────────────────────────
# Step 4 — Build API server
# ─────────────────────────────────────────────
step "4/7  Build API server"
pnpm --filter @workspace/api-server run build
log "API server built → $API_DIR/dist/index.mjs"

# ─────────────────────────────────────────────
# Step 5 — Restart PM2
# ─────────────────────────────────────────────
step "5/7  Restart PM2 ($PM2_NAME)"
if pm2 describe "$PM2_NAME" &>/dev/null; then
  pm2 restart "$PM2_NAME"
  log "PM2 process restarted"
else
  warn "PM2 process '$PM2_NAME' not found — starting from ecosystem.config.cjs"
  [[ -f "$APP_DIR/ecosystem.config.cjs" ]] || die "ecosystem.config.cjs not found. Run initial setup first."
  pm2 start "$APP_DIR/ecosystem.config.cjs"
  pm2 save
  log "PM2 process started and saved"
fi

# Give the server a moment to boot before building frontend
sleep 3
if pm2 describe "$PM2_NAME" | grep -q "online"; then
  log "API server is online"
else
  warn "API server may not be running — check: pm2 logs $PM2_NAME"
fi

# ─────────────────────────────────────────────
# Step 6 — Build frontend
# ─────────────────────────────────────────────
step "6/7  Build frontend"
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/rpay run build
[[ -d "$DIST_DIR" ]] || die "Build output not found at $DIST_DIR"
log "Frontend built → $DIST_DIR ($(du -sh "$DIST_DIR" | cut -f1))"

# ─────────────────────────────────────────────
# Step 7 — Reload nginx
# ─────────────────────────────────────────────
step "7/7  Reload nginx"
nginx -t && systemctl reload nginx
log "Nginx reloaded"

# ─────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────
COMMIT=$(git rev-parse --short HEAD)
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  🚀  RasoKart deployed successfully  [${COMMIT}]${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Landing page : https://rasokart.com/"
echo "  Admin portal : https://rasokart.com/admin"
echo "  Merchant     : https://rasokart.com/merchant"
echo "  Agent        : https://rasokart.com/agent"
echo "  API health   : curl -s https://rasokart.com/api/healthz"
echo ""
echo "  PM2 status   : pm2 status"
echo "  API logs     : pm2 logs $PM2_NAME --lines 50"
echo "  Deploy log   : $LOG_FILE"
echo ""
