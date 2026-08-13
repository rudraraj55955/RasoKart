#!/usr/bin/env sh
# Pre-commit hook: verify every pgTable() defined in lib/db/src/schema/ has a
# corresponding CREATE TABLE IF NOT EXISTS guard in either
# artifacts/api-server/src/lib/schemaGuard.ts or scripts/src/db-migrate.ts.
#
# Exits non-zero (blocks the commit) when a new table is added without a guard.
# This check is purely static — reads source files only, no database required.
#
# Installed automatically by: pnpm install  (via the root prepare script)
# Manual install:              sh scripts/install-hooks.sh

set -e

echo "⏳ schema-guard-coverage: checking all pgTable() definitions are guarded..."
pnpm --filter @workspace/scripts run schema-guard-coverage
