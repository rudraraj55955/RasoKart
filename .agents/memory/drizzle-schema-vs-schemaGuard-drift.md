---
name: Drizzle schema vs schemaGuard ALTER TABLE drift
description: Columns added to the DB via schemaGuard ALTER TABLE but missing from the Drizzle schema file cause runtime 500 errors when a route queries that column via Drizzle ORM.
---

## The Rule
When adding a new column to an existing table via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in schemaGuard.ts, you MUST also add the corresponding field to the Drizzle schema definition in `lib/db/src/schema/<table>.ts`.

**Why:** Drizzle generates SQL from its TS schema object. If `table.someColumn` doesn't exist on the schema object, accessing it throws a runtime error. TypeScript won't catch this — the column exists in the DB but not in Drizzle's type, so TS sees it as undefined/any and the SQL generation fails at runtime. The server returns 500 with no helpful message from the DB layer.

**How to apply:**
1. Add the column to `lib/db/src/schema/<table>.ts`
2. Run `pnpm run typecheck:libs` to rebuild lib declarations
3. Restart the API server — no migration needed since schemaGuard's `ALTER TABLE IF NOT EXISTS` already handles the DB

**Real example:** `error_code`, `error_description`, `error_source`, `captured_at`, `settlement_id` were added to `razorpay_payment_orders` via schemaGuard ALTER TABLE but were absent from `razorpayPaymentOrdersTable` in Drizzle — the analytics endpoint returned 500 until the fields were added to the schema.
