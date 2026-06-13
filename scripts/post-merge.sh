#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/scripts run db-migrate
pnpm --filter @workspace/api-server run seed
pnpm --filter @workspace/scripts run github-sync
