#!/bin/bash
set -e
PNPM_NO_UPDATE_NOTIFIER=1 pnpm install --frozen-lockfile
pnpm --filter @workspace/scripts run db-migrate
pnpm --filter @workspace/api-server run seed
pnpm --filter @workspace/scripts run verify-demo-credentials
# Verify all 6 alert email "send-sample" endpoints and preview routes.
# Skips gracefully with a warning (exit 0) when SMTP_HOST / SMTP_USER are not
# set in the environment — so cold-start deploys without email configured are
# not blocked.  Set those vars in ecosystem.config.cjs to enable the full check.
pnpm --filter @workspace/scripts run verify-alert-email-samples
pnpm --filter @workspace/scripts run verify-priority-conflict-tests

# GitHub mirroring is best-effort. The sync command records its own failure
# state and sends the configured admin alert, but a missing/expired GitHub
# credential must not make the application post-merge setup fail.
if ! GITHUB_SYNC_FORCE=true pnpm --filter @workspace/scripts run github-sync; then
  echo "POST_MERGE: GitHub sync failed; continuing with post-merge setup."
fi
