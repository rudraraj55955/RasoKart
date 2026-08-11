#!/usr/bin/env bash
# scripts/setup-docs-subdomain.sh
#
# ONE-TIME setup for the docs.rasokart.com subdomain on the VPS.
# Run as root (or with sudo) AFTER the DNS CNAME record is live:
#
#   sudo bash scripts/setup-docs-subdomain.sh
#
# Prerequisites:
#   1. DNS CNAME record added: docs → rasokart.com (Cloudflare-proxied)
#   2. Nginx installed (already the case on rasokart.com VPS)
#   3. This script is run from /var/www/rasokart/
#
# What this script does:
#   - Copies infra/nginx/rasokart-docs.conf to /etc/nginx/sites-available/
#   - Enables the site via symlink
#   - Tests and reloads Nginx
#   - Optionally runs certbot for Full Strict SSL mode
#   - Verifies the setup with a curl health-check
#
# DOES NOT:
#   - Touch the running rasokart-api PM2 process
#   - Modify the database
#   - Change auth/payment/provider configuration

set -Eeuo pipefail

APP_DIR="/var/www/rasokart"
NGINX_AVAILABLE="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"
CONF_SRC="$APP_DIR/infra/nginx/rasokart-docs.conf"
CONF_DEST="$NGINX_AVAILABLE/rasokart-docs.conf"
CONF_LINK="$NGINX_ENABLED/rasokart-docs.conf"
DOMAIN="docs.rasokart.com"

log() { echo "[$(date -u +%H:%M:%SZ)] $*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

# ── 0. Sanity checks ─────────────────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || fail "Run as root: sudo bash scripts/setup-docs-subdomain.sh"
[ -d "$APP_DIR" ] || fail "App directory $APP_DIR not found. Run from VPS."
[ -f "$CONF_SRC" ] || fail "Nginx config not found at $CONF_SRC"
command -v nginx >/dev/null || fail "Nginx not installed"

log "Setting up docs.rasokart.com Nginx config..."

# ── 1. Install config ─────────────────────────────────────────────────────────
log "Copying $CONF_SRC → $CONF_DEST"
cp "$CONF_SRC" "$CONF_DEST"
chmod 644 "$CONF_DEST"

# ── 2. Enable site ────────────────────────────────────────────────────────────
if [ -L "$CONF_LINK" ]; then
    log "Symlink already exists: $CONF_LINK (overwriting)"
    rm -f "$CONF_LINK"
fi
log "Enabling site: ln -s $CONF_DEST $CONF_LINK"
ln -s "$CONF_DEST" "$CONF_LINK"

# ── 3. Create ACME challenge directory (for future certbot use) ───────────────
mkdir -p /var/www/certbot
log "ACME challenge dir ready: /var/www/certbot"

# ── 4. Test Nginx config ─────────────────────────────────────────────────────
log "Testing Nginx configuration..."
nginx -t || fail "Nginx config test failed. Check $CONF_DEST for errors."

# ── 5. Reload Nginx ──────────────────────────────────────────────────────────
log "Reloading Nginx..."
systemctl reload nginx
log "Nginx reloaded."

# ── 6. Optional: certbot for Full Strict SSL mode ────────────────────────────
echo ""
echo "┌─────────────────────────────────────────────────────────────────────┐"
echo "│  SSL NOTE                                                           │"
echo "│                                                                     │"
echo "│  Cloudflare Universal SSL handles HTTPS for docs.rasokart.com       │"
echo "│  automatically (orange-cloud proxied CNAME).                        │"
echo "│                                                                     │"
echo "│  If your Cloudflare SSL mode is 'Full (strict)', you also need      │"
echo "│  a cert on the VPS. Run:                                            │"
echo "│                                                                     │"
echo "│    sudo certbot certonly --nginx -d docs.rasokart.com               │"
echo "│                                                                     │"
echo "│  Then uncomment the HTTPS server block in rasokart-docs.conf and    │"
echo "│  run: sudo nginx -t && sudo systemctl reload nginx                  │"
echo "└─────────────────────────────────────────────────────────────────────┘"
echo ""

# ── 7. Verify HTTP reachability (from VPS, bypassing Cloudflare) ─────────────
log "Verifying local Nginx is serving docs.rasokart.com on port 80..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Host: docs.rasokart.com" http://127.0.0.1/ 2>/dev/null || echo "000")
if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "301" ] || [ "$HTTP_STATUS" = "302" ]; then
    log "✓ Local Nginx responds HTTP $HTTP_STATUS for docs.rasokart.com"
else
    echo "WARNING: Local probe returned HTTP $HTTP_STATUS (expected 200 — may be normal if SPA not yet built)"
fi

# Probe short URL aliases
for PATH_CHECK in /openapi.yaml /openapi.json /swagger; do
    S=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Host: docs.rasokart.com" "http://127.0.0.1${PATH_CHECK}" 2>/dev/null || echo "000")
    log "  $PATH_CHECK → HTTP $S"
done

echo ""
log "┌─────────────────────────────────────────────────────────────────────┐"
log "│  NEXT STEPS (human action required)                                 │"
log "│                                                                     │"
log "│  1. Add DNS record in Cloudflare:                                   │"
log "│     Type:   CNAME                                                   │"
log "│     Name:   docs                                                    │"
log "│     Target: rasokart.com                                            │"
log "│     Proxy:  Proxied (orange cloud ON)                               │"
log "│                                                                     │"
log "│  2. Wait 1–5 minutes for DNS propagation.                           │"
log "│                                                                     │"
log "│  3. Verify:                                                         │"
log "│     curl -I https://docs.rasokart.com/openapi.yaml                  │"
log "│     curl -I https://docs.rasokart.com/swagger                       │"
log "│                                                                     │"
log "│  Rollback (removes only the docs vhost, rasokart.com unaffected):   │"
log "│    sudo rm -f $CONF_LINK && sudo systemctl reload nginx │"
log "└─────────────────────────────────────────────────────────────────────┘"

log "setup-docs-subdomain.sh complete."
