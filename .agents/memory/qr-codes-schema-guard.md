---
name: qr_codes missing column guards
description: qr_codes table had no ALTER TABLE guards in schemaGuard.ts — full-row SELECT failed on production with 500
---

# qr_codes columns never guarded in schemaGuard.ts

## The rule
Any new column added to `lib/db/src/schema/qrCodes.ts` (or any table that has no explicit `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` block in `schemaGuard.ts`) will silently fail on a production DB that predates the column addition.

## Why
The `qr_codes` table was created in the initial DB push. Columns `order_id`, `callback_url`, `merchant_reference`, `ekqr_order_id`, `ekqr_payment_url`, `provider_key`, `provider_order_id`, `provider_payment_url` were added to the Drizzle schema incrementally as features shipped. None received `ALTER TABLE` guards in `schemaGuard.ts`. Result: `SELECT qrCodesTable.*` (used by list and public endpoints) threw "column does not exist" → HTTP 500. Count-only queries (`GET /api/qr-codes/stats`) worked because they never select all columns.

## How to apply
After adding any column to any Drizzle schema file, add a matching `ALTER TABLE <table> ADD COLUMN IF NOT EXISTS ...` block in `artifacts/api-server/src/lib/schemaGuard.ts`. All new columns must be nullable or have a DEFAULT (never NOT NULL without DEFAULT) so the guard can run safely against a table that already has rows. This is the same pattern used for `cashfree_payment_orders` (payinSchemaGuard.ts) and all other tables in schemaGuard.ts.
