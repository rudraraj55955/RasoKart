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

## Specific incident
- `users.name`: db-migrate's CREATE TABLE omitted `name`; schemaGuard didn't add it. seed.ts inserts `name: "Super Admin"` etc. → crash on fresh DB.
- `merchant_plans` UNIQUE constraint: db-migrate had no UNIQUE on `merchant_id`; seed uses `onConflictDoUpdate({ target: merchantPlansTable.merchantId })` → Postgres "no unique constraint matching ON CONFLICT specification".
- Both fixed by adding ALTER TABLE + CREATE UNIQUE INDEX IF NOT EXISTS to db-migrate.ts and schemaGuard.ts.
