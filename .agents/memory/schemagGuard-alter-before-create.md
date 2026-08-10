---
name: schemaGuard ALTER before CREATE crash pattern
description: An ALTER TABLE in schemaGuard before the matching CREATE TABLE causes a cascade abort on fresh DBs, preventing all later tables (including system_config) from being created and crashing the server.
---

## Rule
Every ALTER TABLE in schemaGuard.ts must appear AFTER the CREATE TABLE IF NOT EXISTS for that same table. Reversing the order is safe on dev DBs (where the table already exists) and completely silent, but causes an unrecoverable cascade abort on a fresh production DB.

**Why:** On a fresh production DB, only the Drizzle-schema tables exist (created by the publish migration). Tables that exist only in schemaGuard (e.g. `merchant_kyc_data`) are absent. An ALTER TABLE on a non-existent table throws "relation does not exist", which aborts the entire `runGuard()` run. All subsequent CREATE TABLEs — including `system_config` — never execute. If any scheduler then queries `system_config`, the process crashes.

**How to apply:**
- Before adding an ALTER TABLE guard for a schemaGuard-only table, grep for its CREATE TABLE. If the CREATE TABLE comes later in the file, move the ALTER TABLE to immediately after the CREATE TABLE.
- The Drizzle-schema tables (merchants, users, transactions, etc.) are safe to ALTER anywhere — they always exist in production.
- Defense-in-depth: wrap `await initReconciliationScheduler()` and any other awaited scheduler that queries DB tables in try/catch in index.ts, so a missing table cannot crash the process.

## Symptom
- Dev server starts fine (all tables present) — the bug is completely invisible in dev.
- Cloud Run promote fails with "app built successfully but failed to start" — crash loop on every container restart.
- Server log shows the schemaGuard exception, then a "relation system_config does not exist" crash in a scheduler.

## Fix applied (commit 5a41b946)
- Moved `merchant_kyc_data` ALTER TABLE block (aadhaar_status, bank_holder_name, udyam_number, udyam_status) from line ~814 to immediately after the `CREATE TABLE IF NOT EXISTS merchant_kyc_data` at line ~905.
- Wrapped `await initReconciliationScheduler()` in try/catch in index.ts.
