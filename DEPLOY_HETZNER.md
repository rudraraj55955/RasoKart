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
pnpm --filter @workspace/db run push          # only if schema changed
pnpm --filter @workspace/api-server run build
pm2 restart rasokart-api
BASE_PATH=/ pnpm --filter @workspace/rpay run build
# nginx serves the updated dist/ folder automatically
```

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

# Export DATABASE_URL so drizzle-kit can connect
export DATABASE_URL="postgres://rasokart_user:YOUR_PASSWORD@localhost:5432/rasokart"

# Push schema (idempotent — safe to re-run)
pnpm --filter @workspace/db run push
```

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

## 9. Configure Nginx

```nginx
# /etc/nginx/sites-available/rasokart
server {
    listen 80;
    server_name rasokart.com www.rasokart.com;
    return 301 https://rasokart.com$request_uri;
}

server {
    listen 443 ssl http2;
    server_name rasokart.com;

    ssl_certificate     /etc/letsencrypt/live/rasokart.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rasokart.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Security headers
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-XSS-Protection "1; mode=block";
    add_header Referrer-Policy strict-origin-when-cross-origin;

    # API — proxy to Express
    location /api/ {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_buffering    off;
    }

    # Frontend — serve static files (React SPA)
    # Vite outputs to dist/public/ (not dist/ directly)
    root /var/www/rasokart/artifacts/rpay/dist/public;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets aggressively
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2|woff|ttf)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

```bash
# Enable site
ln -s /etc/nginx/sites-available/rasokart /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Get SSL certificate (www + apex)
certbot --nginx -d rasokart.com -d www.rasokart.com \
  --non-interactive --agree-tos -m admin@rasokart.com
```

---

## 10. Post-Deploy Checklist

```bash
# Verify API is running
curl -s https://rasokart.com/api/healthz

# Check PM2 status
pm2 status

# Tail logs
pm2 logs rasokart-api --lines 50

# Test admin login
curl -s -X POST https://rasokart.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@rasokart.com","password":"Admin@123456"}'

# Confirm landing page loads
curl -sI https://rasokart.com | grep HTTP
```

### Route verification

| URL | Expected |
|-----|----------|
| `https://rasokart.com/` | Public landing page |
| `https://rasokart.com/admin` | Admin login |
| `https://rasokart.com/merchant` | Merchant login |
| `https://rasokart.com/agent` | Agent login |
| `https://rasokart.com/merchant/apply` | Merchant application |
| `https://rasokart.com/admin/dashboard` | Admin dashboard (after login) |
| `https://rasokart.com/merchant/dashboard` | Merchant dashboard (after login) |
| `https://rasokart.com/agent/dashboard` | Agent dashboard (after login) |

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
pnpm --filter @workspace/db run push          # if schema changed
pnpm --filter @workspace/api-server run build
pm2 restart rasokart-api
BASE_PATH=/ pnpm --filter @workspace/rpay run build
# nginx serves updated dist/ automatically
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
| `SMTP_HOST` | Optional | SMTP server for finance report emails |
| `SMTP_PORT` | Optional | SMTP port (default 587) |
| `SMTP_USER` | Optional | SMTP username |
| `SMTP_PASS` | Optional | SMTP password |
| `SMTP_FROM` | Optional | From address for outbound emails |

---

*Last updated: 2026-06-10*
