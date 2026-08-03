# RasoKart — Hetzner VPS Deployment Guide

## Prerequisites

- Hetzner Cloud account
- Domain pointed to your VPS IP (`rasokart.com`)
- SSH access to your VPS
- GitHub repo: `https://github.com/rudraraj55955/RPAY.git`

---

## Quick Update (Existing Deployment)

If the VPS is already running, SSH in and run:

```bash
cd /home/rasokart/app
git pull origin main
pnpm install --frozen-lockfile
pnpm --filter @workspace/scripts run db-migrate  # idempotent, no TTY required — always safe to run
pnpm --filter @workspace/api-server run build
pm2 restart rasokart-api
BASE_PATH=/ pnpm --filter @workspace/rpay run build
# nginx serves the updated dist/ folder automatically

# Confirm the deploy applied schema/columns correctly AND that every documented
# demo/test account can authenticate (password hash, role, active). This is the
# same deep check Replit uses as the autoscale startup gate (see artifact.toml).
# The response includes a "commit" field with the SHA baked in at build time —
# compare it against the HEAD of the repo to confirm the correct code is live:
#   git rev-parse HEAD
curl -s https://rasokart.com/api/healthz/deep

# For Hetzner (PM2) deploys, also run the standalone credential check for a
# more detailed per-account breakdown in the terminal output:
pnpm --filter @workspace/scripts run verify-demo-credentials

# Smoke-test all 6 alert email send-sample endpoints + preview routes.
# Requires SMTP_HOST and SMTP_USER to be set in the environment (ecosystem.config.cjs).
# Skips with a warning if those vars are absent — never blocks a deploy.
pnpm --filter @workspace/scripts run verify-alert-email-samples
```

If `/api/healthz/deep` returns `"status":"degraded"` or `"demo_credentials":false`, do not
consider the deploy complete — a documented demo/test account is broken (wrong password hash,
wrong role, or deactivated). Investigate `seed.ts` before telling anyone the deploy succeeded.

---

## 1. Provision the VPS

**Recommended spec:**
- Type: **CX21** or higher (2 vCPU, 4 GB RAM)
- Image: **Ubuntu 24.04 LTS**
- Location: Bangalore (or nearest to your users)
- Add your SSH public key during setup

**Firewall rules (Hetzner Firewall):**
```
Inbound TCP 22   (SSH)
Inbound TCP 80   (HTTP → redirect to HTTPS)
Inbound TCP 443  (HTTPS)
Outbound: all
```

---

## 2. Initial Server Setup

```bash
# SSH in
ssh root@YOUR_VPS_IP

# Update system
apt update && apt upgrade -y

# Install Node.js 24 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 24
nvm use 24
node --version   # v24.x.x

# Install pnpm
npm install -g pnpm

# Install PostgreSQL 17
apt install -y postgresql postgresql-contrib
systemctl enable --now postgresql

# Install Nginx
apt install -y nginx certbot python3-certbot-nginx
systemctl enable --now nginx

# Install PM2 (process manager)
npm install -g pm2
```

---

## 3. Configure PostgreSQL

```bash
# Create DB and user
sudo -u postgres psql <<EOF
CREATE USER rasokart_user WITH PASSWORD 'CHANGE_THIS_STRONG_PASSWORD';
CREATE DATABASE rasokart OWNER rasokart_user;
GRANT ALL PRIVILEGES ON DATABASE rasokart TO rasokart_user;
EOF

# Test connection
psql -U rasokart_user -d rasokart -h localhost -c "SELECT 1;"
```

---

## 4. Deploy the Application

```bash
# Create app directory
mkdir -p /var/www/rasokart
cd /var/www/rasokart

# Clone repository
git clone https://github.com/rudraraj55955/RPAY.git .

# Install dependencies
pnpm install --frozen-lockfile

# Build lib packages (required before frontend/server build)
pnpm run typecheck:libs
```

---

## 5. Environment Variables

All env vars are set inside `ecosystem.config.cjs` (PM2 process config) — **not** in a `.env` file.
The repo includes a ready-made template at `ecosystem.config.cjs`. Edit it in-place:

```bash
# Generate a secure SESSION_SECRET first
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Edit the template — fill in DATABASE_URL and SESSION_SECRET
nano /var/www/rasokart/ecosystem.config.cjs
```

Change these two lines:
```
DATABASE_URL: "postgres://rasokart_user:CHANGE_THIS@localhost:5432/rasokart",
SESSION_SECRET: "REPLACE_WITH_64_CHAR_HEX_FROM_CRYPTO_RANDOM",
```

---

## 6. Run Database Migrations

```bash
cd /var/www/rasokart

# Export DATABASE_URL so the migration script can connect
export DATABASE_URL="postgres://rasokart_user:YOUR_PASSWORD@localhost:5432/rasokart"

# Idempotent CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS migration —
# no TTY required (unlike `drizzle-kit push`), safe to re-run on every deploy.
# This is the canonical migration path for this project; do NOT use
# `pnpm --filter @workspace/db run push` in production (it requires an
# interactive TTY and will hang/fail under PM2 or CI).
pnpm --filter @workspace/scripts run db-migrate
```

The API server runs a second, in-process schema guard (`artifacts/api-server/src/lib/schemaGuard.ts`)
on every startup, before seeding — so even if this migration step is ever skipped
or fails on a fresh/older DB, the server still self-heals the columns/tables it
depends on (`users.is_super_admin`, `company_settings`, `merchant_auth_otps`,
UPI gateway columns, routing tables, `quiet_hours_queue` delivery columns,
`payout_wallet_load_orders` with all indexes) instead of 502ing. Seed failures
are logged but are **never fatal** — the server always starts and serves requests
even if seeding hits an unexpected error.

**KYC tables are included in both places**: `db-migrate.ts` creates
`merchant_kyc`, `kyc_review_history`, `merchant_kyc_data` (incl. `aadhaar_status`
and `udyam_*` columns), `merchant_kyc_verifications`, `kyc_verification_logs`,
`verification_logs`, and `merchant_kyc_settings` directly, and `schemaGuard.ts`
self-heals the same tables/columns on every server boot as a second safety net.
A fresh VPS database gets full KYC support (manual document upload KYC, the
auto-KYC PAN/Aadhaar pipeline, and Super Admin auto-KYC provider settings)
from running step 6 alone, before the server is ever started.

### Permanent SQL migration files

The file `artifacts/api-server/src/migrations/0002_payout_wallet_load_orders.sql`
is a permanent, idempotent SQL migration that you can apply directly against the
production database with `psql` when you need to explicitly pre-create the
`payout_wallet_load_orders` table and its indexes before the first server start
(e.g. zero-downtime blue-green deploys where you want schema changes applied
before binary swap):

```bash
psql "$DATABASE_URL" -f artifacts/api-server/src/migrations/0002_payout_wallet_load_orders.sql
```

All statements use `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` — safe to run on
any existing DB and will never overwrite admin-configured `system_config` values.

The API server seed runs automatically on startup — it creates the admin account
(`admin@rasokart.com` / `Admin@123456`) and demo merchant data idempotently.

---

## 7. Configure PM2 Process Manager

```bash
# Create log directory
mkdir -p /var/log/rasokart

# Build API server
cd /var/www/rasokart
pnpm --filter @workspace/api-server run build

# Start with PM2 using the ecosystem config from the repo
pm2 start /var/www/rasokart/ecosystem.config.cjs
pm2 save
pm2 startup   # follow the printed sudo command to enable on boot
```

---

## 8. Build the Frontend for Static Serving

```bash
cd /var/www/rasokart

# Build Vite frontend (PORT is required by vite.config.ts even during build)
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/rpay run build

# Output lands in: /var/www/rasokart/artifacts/rpay/dist/public/
ls artifacts/rpay/dist/public/index.html   # confirm
```

---

## 9. Configure Nginx (Multi-Subdomain)

All five role subdomains (`superadmin`, `admin`, `merchant`, `payoutmerchant`, `agent`) serve the
**same compiled React SPA** static dist. The SPA detects `window.location.hostname` at runtime and
activates the correct portal — no separate build per subdomain.

The API always lives at `rasokart.com/api`. There is no `api.rasokart.com` split.

Legacy portal paths (`/admin`, `/merchant`, `/agent`, `/payout-admin`) on the apex domain return
`301` redirects to the matching subdomain so bookmarked URLs still work.

```nginx
# /etc/nginx/sites-available/rasokart-subdomains
#
# Shared SSL config snippet — referenced by all server blocks.
# Assumes a single multi-SAN cert covering all seven names (see certbot command below).

# ── HTTP → HTTPS redirects ────────────────────────────────────────────────────
server {
    listen 80;
    server_name rasokart.com www.rasokart.com
                superadmin.rasokart.com admin.rasokart.com
                merchant.rasokart.com payoutmerchant.rasokart.com
                agent.rasokart.com;
    return 301 https://$host$request_uri;
}

# ── Apex domain (rasokart.com) ────────────────────────────────────────────────
server {
    listen 443 ssl http2;
    server_name rasokart.com www.rasokart.com;

    ssl_certificate     /etc/letsencrypt/live/rasokart.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rasokart.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache   shared:SSL:10m;

    # Security headers
    add_header Strict-Transport-Security  "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options     nosniff                              always;
    add_header X-Frame-Options            SAMEORIGIN                           always;
    add_header X-XSS-Protection           "1; mode=block"                      always;
    add_header Referrer-Policy            strict-origin-when-cross-origin      always;

    # ── Legacy path redirects (bookmarked URLs keep working) ────────────────
    location = /admin        { return 301 https://admin.rasokart.com/; }
    location ^~ /admin/      { return 301 https://admin.rasokart.com$request_uri; }
    location = /merchant     { return 301 https://merchant.rasokart.com/; }
    location ^~ /merchant/   { return 301 https://merchant.rasokart.com$request_uri; }
    location = /agent        { return 301 https://agent.rasokart.com/; }
    location ^~ /agent/      { return 301 https://agent.rasokart.com$request_uri; }
    location = /payout-admin { return 301 https://payoutmerchant.rasokart.com/; }
    location ^~ /payout-admin/ { return 301 https://payoutmerchant.rasokart.com$request_uri; }

    # ── API — proxy to Express ───────────────────────────────────────────────
    location /api/ {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   CF-Connecting-IP  $http_cf_connecting_ip;
        proxy_read_timeout 60s;
        proxy_buffering    off;
    }

    # ── Frontend — React SPA static files ───────────────────────────────────
    root  /var/www/rasokart/artifacts/rpay/dist/public;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2|woff|ttf)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}

# ── Role subdomains — all 5 serve the same SPA ───────────────────────────────
server {
    listen 443 ssl http2;
    server_name superadmin.rasokart.com admin.rasokart.com
                merchant.rasokart.com payoutmerchant.rasokart.com
                agent.rasokart.com;

    ssl_certificate     /etc/letsencrypt/live/rasokart.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rasokart.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache   shared:SSL:10m;

    # Security headers
    add_header Strict-Transport-Security  "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options     nosniff                              always;
    add_header X-Frame-Options            SAMEORIGIN                           always;
    add_header X-XSS-Protection           "1; mode=block"                      always;
    add_header Referrer-Policy            strict-origin-when-cross-origin      always;
    # Required so subdomain JS can call rasokart.com/api (CORS enforced by Express)
    add_header Cross-Origin-Opener-Policy same-origin-allow-popups             always;

    # ── API — proxy to Express (same backend as apex) ───────────────────────
    # Subdomains need the proxy too: the React SPA uses apiUrl() which issues
    # cross-origin calls to https://rasokart.com/api/* on production subdomains,
    # but the same relative /api/* path must work in dev/staging where all
    # subdomains may run on the same server. Keep the proxy here for full parity.
    location /api/ {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              rasokart.com;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   CF-Connecting-IP  $http_cf_connecting_ip;
        proxy_read_timeout 60s;
        proxy_buffering    off;
    }

    root  /var/www/rasokart/artifacts/rpay/dist/public;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2|woff|ttf)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

```bash
# Enable site and verify config
ln -sf /etc/nginx/sites-available/rasokart-subdomains /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# ── SSL certificate — multi-SAN covering all 7 names ─────────────────────────
# Option A: wildcard cert via DNS-01 challenge (recommended — single cert for all subdomains)
# Requires Cloudflare/Route53 DNS API credentials for certbot-dns-* plugin.
certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  -d rasokart.com -d "*.rasokart.com" \
  --non-interactive --agree-tos -m admin@rasokart.com

# Option B: individual SANs via HTTP-01 (use when DNS challenge is unavailable)
# All 7 names must resolve to this VPS IP before running.
certbot --nginx \
  -d rasokart.com -d www.rasokart.com \
  -d superadmin.rasokart.com -d admin.rasokart.com \
  -d merchant.rasokart.com -d payoutmerchant.rasokart.com \
  -d agent.rasokart.com \
  --non-interactive --agree-tos -m admin@rasokart.com

# Both options produce a single cert pair at:
#   /etc/letsencrypt/live/rasokart.com/fullchain.pem
#   /etc/letsencrypt/live/rasokart.com/privkey.pem
# Both apex and subdomain server blocks reference the same pair.

# ── If using Cloudflare Full (Strict) SSL ─────────────────────────────────────
# Subdomains are already HTTPS at the Cloudflare edge — only the origin cert
# (the apex cert above) matters for the Cloudflare-to-VPS TLS leg.
# Certbot HTTP-01 challenge still works as long as CF proxy is paused during
# certificate issuance.
```

---

## 10. Post-Deploy Checklist

```bash
# Verify API is running
curl -s https://rasokart.com/api/healthz

# Deep readiness check — DB connection + every column/table the schema guard
# manages (users.is_super_admin, company_settings, merchant_auth_otps, UPI
# gateway columns, routing tables, agent_commission_ledger). Returns 503 with a
# per-check breakdown if anything drifted, instead of a raw 502.
curl -s https://rasokart.com/api/healthz/deep

# Check PM2 status
pm2 status

# Tail logs
pm2 logs rasokart-api --lines 50

# Test admin login
curl -s -X POST https://rasokart.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@rasokart.com","password":"Admin@123456"}'

# Test merchant login (canonical path + aliases — all three must return 200
# with a token for a valid merchant, and JSON 401 — never raw HTML — for bad creds)
curl -s -X POST https://rasokart.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"merchant@demo.com","password":"Merchant@123456"}'
curl -s -X POST https://rasokart.com/api/merchant/login \
  -H "Content-Type: application/json" \
  -d '{"email":"merchant@demo.com","password":"Merchant@123456"}'
curl -s -X POST https://rasokart.com/api/auth/merchant/login \
  -H "Content-Type: application/json" \
  -d '{"email":"merchant@demo.com","password":"Merchant@123456"}'

# Confirm landing page loads
curl -sI https://rasokart.com | grep HTTP

# ── Subdomain smoke test ──────────────────────────────────────────────────────
# Checks HTTPS reachability of all 5 subdomains, healthz/deep, and that the auth
# endpoint returns structured JSON (not HTML) for wrong credentials.
# Run after every deploy that touches Nginx config or the SPA build.
bash /var/www/rasokart/scripts/src/verify-subdomains.sh

# ── Legacy redirect verification ─────────────────────────────────────────────
# Old bookmarked URLs must redirect to the matching subdomain (not 404).
curl -sI https://rasokart.com/admin       | grep -i location
curl -sI https://rasokart.com/merchant    | grep -i location
curl -sI https://rasokart.com/agent       | grep -i location
curl -sI https://rasokart.com/payout-admin | grep -i location
# Expected: Location: https://<subdomain>.rasokart.com/
```

### Route verification

| URL | Expected |
|-----|----------|
| `https://rasokart.com/` | Public landing page |
| `https://rasokart.com/admin` | **301 → https://admin.rasokart.com/** |
| `https://rasokart.com/merchant` | **301 → https://merchant.rasokart.com/** |
| `https://rasokart.com/agent` | **301 → https://agent.rasokart.com/** |
| `https://rasokart.com/payout-admin` | **301 → https://payoutmerchant.rasokart.com/** |
| `https://admin.rasokart.com/` | Admin login portal |
| `https://superadmin.rasokart.com/` | Super Admin login portal |
| `https://merchant.rasokart.com/` | Merchant login portal |
| `https://payoutmerchant.rasokart.com/` | Payout merchant login portal |
| `https://agent.rasokart.com/` | Agent login portal |
| `https://rasokart.com/api/healthz/deep` | `{"status":"ok"}` |

### Role isolation verification

| Scenario | Expected |
|----------|----------|
| Admin logs in on `admin.rasokart.com` | Allowed — redirects to `/admin/dashboard` |
| Admin logs in on `superadmin.rasokart.com` without `is_super_admin` | Denied — toast + redirect to `/admin` |
| Merchant token used on `admin.rasokart.com` | Denied — "wrong portal" toast + redirect to `/merchant` |
| Agent token used on `merchant.rasokart.com` | Denied — "wrong portal" toast + redirect to `/agent` |

---

## 11. Change Default Passwords

**Immediately after deploying to production:**

1. Log in to the admin portal at `https://rasokart.com/admin`
2. Navigate to **Users** → change admin password
3. Remove or suspend demo merchant accounts (`merchant@demo.com`, `merchant2@demo.com`)

---

## 12. Ongoing Maintenance

### Update deployment
```bash
cd /home/rasokart/app
git pull origin main
pnpm install --frozen-lockfile
pnpm run typecheck:libs                        # rebuild lib declarations
pnpm --filter @workspace/scripts run db-migrate  # idempotent, no TTY required
pnpm --filter @workspace/api-server run build
pm2 restart rasokart-api
BASE_PATH=/ pnpm --filter @workspace/rpay run build
# nginx serves updated dist/ automatically

# Verify the deploy actually applied schema/columns correctly before moving on:
curl -s https://rasokart.com/api/healthz/deep

# Smoke-test all 6 alert email send-sample endpoints + preview routes.
# Requires SMTP_HOST and SMTP_USER to be set. Skips with a warning if absent.
pnpm --filter @workspace/scripts run verify-alert-email-samples
```

### Backups
```bash
# Database backup (add to cron)
pg_dump -U rasokart_user rasokart | gzip > /backups/rasokart-$(date +%Y%m%d).sql.gz

# Cron job (daily at 2 AM)
echo "0 2 * * * rasokart pg_dump -U rasokart_user rasokart | gzip > /backups/rasokart-\$(date +\%Y\%m\%d).sql.gz" | crontab -
```

### Log rotation
```bash
# /etc/logrotate.d/rasokart
/var/log/rasokart/*.log {
    daily
    rotate 14
    compress
    missingok
    notifempty
    postrotate
        pm2 reloadLogs
    endscript
}
```

---

## 13. Monitoring (Optional)

### Uptime monitoring
- Add `https://rasokart.com/api/healthz` to UptimeRobot (free tier)

### Error alerting
```bash
pm2 install pm2-slack       # Slack alerts on crash
pm2 install pm2-logrotate   # Auto log rotation
```

---

## Architecture

```
Internet
    │
    ▼
[Hetzner VPS — Ubuntu 24.04]
    │
[Nginx :443]  ←  TLS termination + static files
    ├── /api/* → [Express API :8080 via PM2]
    │                    │
    │              [PostgreSQL :5432]
    │
    └── /* → [Vite static dist]
              React SPA (landing + admin + merchant + agent portals)
              Routes: /  /admin  /merchant  /agent  /agent/dashboard  …
```

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `SESSION_SECRET` | ✅ | 64-char random secret for JWT signing |
| `PORT` | ✅ | API server port (default 8080) |
| `NODE_ENV` | ✅ | Set to `production` |
| `CORS_ALLOWED_ORIGIN` | Optional | Comma-separated extra origins to allow in CORS (beyond `*.rasokart.com`). Useful for staging mirrors or custom domains. Example: `https://staging.example.com` |
| `SMTP_HOST` | Optional* | SMTP server hostname (e.g. `smtp.sendgrid.net`) |
| `SMTP_PORT` | Optional* | SMTP port (default 587) |
| `SMTP_USER` | Optional* | SMTP username / API key username |
| `SMTP_PASS` | Optional* | SMTP password / API key |
| `SMTP_FROM` | Optional* | From address for outbound emails (e.g. `noreply@rasokart.com`) |

> **\* Alert email post-merge check** — `SMTP_HOST` and `SMTP_USER` must both be set for
> `verify-alert-email-samples` to run during post-merge (the script uses an internal
> Ethereal test account to send, but uses these vars to detect that email is configured
> in the environment). When they are absent the step skips with a warning (exit 0) so
> cold-start deploys are never blocked. Set all five `SMTP_*` vars in
> `ecosystem.config.cjs` on every environment where you want the full email template
> smoke test to run automatically on each merge.

---

*Last updated: 2026-07-11*
