#!/usr/bin/env bash
#
# scripts/bootstrap-vps-deploy-user.sh
#
# ONE-TIME setup script. Run manually, once, as root on the production VPS
# (167.233.77.68) before the first automated deploy. It never runs as part of
# CI/CD, and it does not touch the live database or the running application.
#
# What it does:
#   - Creates a dedicated, limited "deploy" system user (no root/sudo shell).
#   - Grants that user ownership of /var/www/rasokart only.
#   - Grants that user passwordless sudo for EXACTLY the pm2 subcommands the
#     deploy scripts need, run as root — nothing else. No blanket sudo.
#   - Sets up ~/.ssh/authorized_keys for key-based login only (no password
#     auth for this user).
#   - Marks /var/www/rasokart as a git `safe.directory` for that user.
#
# The SAME deploy user and SAME SSH key are used by both the "production-auto"
# (frontend-only) and "production-sensitive" (backend/DB) GitHub environments
# - the difference between them is which GitHub Environment gate the workflow
# passes through and which deploy-*.sh script runs, not the VPS credentials.
#
# Usage (as root on the VPS):
#   bash scripts/bootstrap-vps-deploy-user.sh "ssh-ed25519 AAAA... deploy@github-actions"
#
set -Eeuo pipefail

DEPLOY_USER="rasokart_deploy"
APP_DIR="/var/www/rasokart"
PUBLIC_KEY="${1:-}"

if [ -z "$PUBLIC_KEY" ]; then
  echo "Usage: $0 \"<ssh-public-key-for-github-actions>\"" >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "This bootstrap script must be run as root (one-time only)." >&2
  exit 1
fi

echo "==> Creating limited deploy user '$DEPLOY_USER' (no root privileges)..."
if id "$DEPLOY_USER" &>/dev/null; then
  echo "User $DEPLOY_USER already exists, skipping creation."
else
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
fi

echo "==> Setting up SSH key-based access for $DEPLOY_USER..."
DEPLOY_HOME="/home/$DEPLOY_USER"
mkdir -p "$DEPLOY_HOME/.ssh"
touch "$DEPLOY_HOME/.ssh/authorized_keys"
grep -qxF "$PUBLIC_KEY" "$DEPLOY_HOME/.ssh/authorized_keys" || echo "$PUBLIC_KEY" >> "$DEPLOY_HOME/.ssh/authorized_keys"
chmod 700 "$DEPLOY_HOME/.ssh"
chmod 600 "$DEPLOY_HOME/.ssh/authorized_keys"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/.ssh"

echo "==> Granting ownership of $APP_DIR to $DEPLOY_USER (existing files are preserved, not deleted)..."
mkdir -p "$APP_DIR"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

echo "==> Configuring git safe.directory for $DEPLOY_USER..."
sudo -u "$DEPLOY_USER" git config --global --add safe.directory "$APP_DIR"

echo "==> Granting scoped, passwordless sudo (pm2 restart/save only - used by the sensitive deploy path; the frontend-only path never restarts pm2)..."
PM2_BIN="$(command -v pm2 || echo /usr/bin/pm2)"
cat > /etc/sudoers.d/rasokart_deploy <<EOF
# Managed by scripts/bootstrap-vps-deploy-user.sh — do not hand-edit.
# Grants $DEPLOY_USER exactly the two pm2 subcommands the sensitive deploy
# script needs. No blanket sudo, no shell, no other binaries. The
# frontend-only deploy path (deploy-frontend-production.sh) never needs sudo
# at all since it never restarts pm2.
$DEPLOY_USER ALL=(root) NOPASSWD: $PM2_BIN restart rasokart-api --update-env, $PM2_BIN save
EOF
chmod 440 /etc/sudoers.d/rasokart_deploy
visudo -cf /etc/sudoers.d/rasokart_deploy

echo "==> Disabling password auth is a global sshd_config change — verify manually if desired:"
echo "    PasswordAuthentication no   (in /etc/ssh/sshd_config, then: systemctl restart sshd)"

echo ""
echo "Bootstrap complete. Nothing was deleted; no existing files under $APP_DIR were touched beyond ownership."
echo ""
echo "Next steps:"
echo "  1. Ensure $APP_DIR contains the cloned repo, .env, and PM2 is already"
echo "     running the 'rasokart-api' process under this same deploy user"
echo "     (or adjust the sudoers rule above to match whichever user runs pm2)."
echo "  2. Add the matching PRIVATE key as the SAME GitHub secret"
echo "     VPS_SSH_PRIVATE_KEY in BOTH the 'production-auto' and"
echo "     'production-sensitive' GitHub Environments (see"
echo "     docs/HYBRID_PRODUCTION_DEPLOYMENT.md)."
echo "  3. Set VPS_USER=$DEPLOY_USER, VPS_HOST=167.233.77.68, VPS_PORT=22 in"
echo "     both environments."
