#!/bin/bash
set -e
PNPM_NO_UPDATE_NOTIFIER=1 pnpm install --frozen-lockfile
pnpm --filter @workspace/scripts run db-migrate
pnpm --filter @workspace/api-server run seed
pnpm --filter @workspace/scripts run github-sync
