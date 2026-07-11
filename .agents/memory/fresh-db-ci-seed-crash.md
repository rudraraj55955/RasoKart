---
name: Fresh-DB CI seed crash pattern
description: How omitting seed-required columns from db-migrate/schemaGuard causes HTTP 502 in CI on a fresh Postgres database.
---

## The rule
Every column that `seed.ts` explicitly INSERTs or uses in `onConflictDoUpdate` **must** appear in both `db-migrate.ts` (for deploy-time migration) and `schemaGuard.ts` (for in-process defense-in-depth). If either is missing, a fresh-DB run (CI, new VPS, clean environment) will crash seed → server never binds to port → nginx 502 on every health-check retry.

**Why:** The dev/existing DB already has all columns from prior `drizzle-kit push` runs, so the omission is invisible locally. CI uses a brand-new Postgres with no prior data, so db-migrate is the only schema source — any gap propagates to seed failure.

**How to apply:**
1. When adding a column to a Drizzle schema file, grep `seed.ts` to see if that column is used in any INSERT/VALUES or onConflictDoUpdate `set:{}`.
2. If yes, add `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` to **both** `scripts/src/db-migrate.ts` and `artifacts/api-server/src/lib/schemaGuard.ts`.
3. Constraints (UNIQUE, etc.) needed by `onConflictDoUpdate` must also appear in both: `CREATE UNIQUE INDEX IF NOT EXISTS ...`.

## Known incidents (all fixed)
- `users.name`: db-migrate's CREATE TABLE omitted `name`; schemaGuard didn't add it. seed.ts inserts `name: "Super Admin"` etc. → crash on fresh DB.
- `merchant_plans` UNIQUE constraint: db-migrate had no UNIQUE on `merchant_id`; seed uses `onConflictDoUpdate({ target: merchantPlansTable.merchantId })` → Postgres "no unique constraint matching ON CONFLICT specification".
- `system_config`: db-migrate and schemaGuard both missing the table entirely. `initReconciliationScheduler()` SELECTs from it at startup, before `app.listen()` — crashes the process before the health endpoint ever binds → nginx 502.
- All fixed by adding CREATE TABLE IF NOT EXISTS / ALTER TABLE IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS to both db-migrate.ts and schemaGuard.ts.

## Tables known to be missing from db-migrate (non-fatal on fresh DB)
The following tables exist in the live DB but are absent from db-migrate.ts — their schedulers fail gracefully (caught, logged at WARN, don't crash the server): withdrawals, report_schedules, scheduled_audit_reports, callback_logs, system_settings. The server still starts and /api/healthz returns 200.
