# RPay — Hetzner VPS Deployment Guide

## Prerequisites

- Hetzner Cloud account
- Domain pointed to your VPS IP (e.g. `rpay.yourdomain.com`)
- SSH access to your VPS

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
CREATE USER rpay_user WITH PASSWORD 'CHANGE_THIS_STRONG_PASSWORD';
CREATE DATABASE rpay OWNER rpay_user;
GRANT ALL PRIVILEGES ON DATABASE rpay TO rpay_user;
EOF

# Test connection
psql -U rpay_user -d rpay -h localhost -c "SELECT 1;"
```

---

## 4. Deploy the Application

```bash
# Create app user
useradd -m -s /bin/bash rpay
su - rpay

# Clone repository
git clone https://github.com/YOUR_USERNAME/RPay.git /home/rpay/app
cd /home/rpay/app

# Install dependencies
pnpm install --frozen-lockfile

# Build all packages
pnpm run build
pnpm --filter @workspace/api-server run build
```

---

## 5. Environment Variables

```bash
# Create environment file
cat > /home/rpay/app/artifacts/api-server/.env.production << 'EOF'
NODE_ENV=production
PORT=8080
DATABASE_URL=postgres://rpay_user:CHANGE_THIS_STRONG_PASSWORD@localhost:5432/rpay
SESSION_SECRET=GENERATE_64_CHAR_RANDOM_STRING_HERE
EOF

# Generate a secure SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## 6. Run Database Migrations

```bash
cd /home/rpay/app

# Push schema to production database
DATABASE_URL=postgres://rpay_user:CHANGE_THIS_STRONG_PASSWORD@localhost:5432/rpay \
  pnpm --filter @workspace/db run push
```

---

## 7. Configure PM2 Process Manager

```bash
# Create PM2 ecosystem config
cat > /home/rpay/app/ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [
    {
      name: "rpay-api",
      cwd: "/home/rpay/app/artifacts/api-server",
      script: "./dist/index.mjs",
      env: {
        NODE_ENV: "production",
        PORT: 8080,
        DATABASE_URL: "postgres://rpay_user:CHANGE_THIS@localhost:5432/rpay",
        SESSION_SECRET: "YOUR_64_CHAR_SECRET_HERE",
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      error_file: "/var/log/rpay/api-error.log",
      out_file: "/var/log/rpay/api-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
EOF

# Create log directory
mkdir -p /var/log/rpay && chown rpay:rpay /var/log/rpay

# Build and start
cd /home/rpay/app/artifacts/api-server
pnpm run build

cd /home/rpay/app
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # follow the printed command to enable on boot
```

---

## 8. Build the Frontend for Static Serving

```bash
cd /home/rpay/app/artifacts/rpay

# Build Vite frontend (production)
BASE_PATH=/ pnpm run build
# Output: /home/rpay/app/artifacts/rpay/dist/
```

---

## 9. Configure Nginx

```nginx
# /etc/nginx/sites-available/rpay
server {
    listen 80;
    server_name rpay.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name rpay.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/rpay.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rpay.yourdomain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Security headers
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-XSS-Protection "1; mode=block";
    add_header Referrer-Policy strict-origin-when-cross-origin;

    # API — proxy to Express
    location /api/ {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_buffering    off;
    }

    # Frontend — serve static files
    root /home/rpay/app/artifacts/rpay/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2|woff|ttf)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

```bash
# Enable site
ln -s /etc/nginx/sites-available/rpay /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Get SSL certificate
certbot --nginx -d rpay.yourdomain.com --non-interactive --agree-tos -m admin@yourdomain.com
```

---

## 10. Post-Deploy Checklist

```bash
# Verify API is running
curl -s https://rpay.yourdomain.com/api/healthz

# Check PM2 status
pm2 status

# Tail logs
pm2 logs rpay-api --lines 50

# Test admin login
curl -s -X POST https://rpay.yourdomain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@rpay.com","password":"Admin@123456"}'
```

---

## 11. Change Default Admin Password

**Immediately after deploying to production:**

1. Log in to the admin portal at `https://rpay.yourdomain.com/admin/login`
2. Navigate to Account Settings
3. Change the admin password to a strong, unique password
4. Update the merchant demo passwords or remove demo accounts

---

## 12. Ongoing Maintenance

### Update deployment
```bash
cd /home/rpay/app
git pull origin main
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push   # if schema changed
pnpm --filter @workspace/api-server run build
pm2 restart rpay-api
pnpm --filter @workspace/rpay run build
```

### Backups
```bash
# Database backup (add to cron)
pg_dump -U rpay_user rpay | gzip > /backups/rpay-$(date +%Y%m%d).sql.gz

# Cron job (daily at 2 AM)
echo "0 2 * * * rpay pg_dump -U rpay_user rpay | gzip > /backups/rpay-\$(date +\%Y\%m\%d).sql.gz" | crontab -
```

### Log rotation
```bash
# /etc/logrotate.d/rpay
/var/log/rpay/*.log {
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

### Hetzner monitoring (built-in)
- CPU, RAM, network graphs in Hetzner Cloud console

### Uptime monitoring
- Add `https://rpay.yourdomain.com/api/healthz` to UptimeRobot (free tier)

### Error alerting
- PM2 can send email/webhook on process crash:
  ```bash
  pm2 install pm2-slack    # Slack alerts
  pm2 install pm2-logrotate
  ```

---

## Architecture Diagram

```
Internet
    │
    ▼
[Hetzner VPS - Ubuntu 24.04]
    │
[Nginx :443]
    ├── /api/* → [Express API :8080]
    │                    │
    │              [PostgreSQL :5432]
    │
    └── /* → [Vite static dist]
                  (React SPA)
```

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `SESSION_SECRET` | ✅ | 64-char random secret for sessions |
| `PORT` | ✅ | API server port (default 8080) |
| `NODE_ENV` | ✅ | Set to `production` |
| `JWT_SECRET` | Optional | Defaults to SESSION_SECRET if not set |

---

*Generated by RPay production audit — 2026-06-08*
