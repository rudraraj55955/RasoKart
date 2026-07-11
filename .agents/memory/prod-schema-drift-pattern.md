---
name: Production DB schema drift pattern
description: CREATE TABLE IF NOT EXISTS silently skips on existing tables; unique indexes on post-deploy columns fail with PG 42703.
---

## Rule
After every `CREATE TABLE IF NOT EXISTS <t>` in `db-migrate.ts`, add `ALTER TABLE <t> ADD COLUMN IF NOT EXISTS` for **every column that was added after the table first landed in production** — before any `CREATE INDEX` or `CREATE UNIQUE INDEX` that references those columns.

**Why:** `CREATE TABLE IF NOT EXISTS` is a complete no-op when the table already exists. Any column added to the schema after the table was first deployed will be missing on the production DB. An index on that missing column throws PG 42703 ("column does not exist") at migration time, rolling back the whole deploy.

Confirmed by Run #25: `withdrawals` was created on initial VPS deploy, `idempotency_key` was added later. The `CREATE TABLE IF NOT EXISTS withdrawals` silently skipped; then `CREATE UNIQUE INDEX ... ON withdrawals(merchant_id, idempotency_key)` crashed with PG 42703. The old single-blob `db.execute()` buried the error after 1500 lines of SQL dump in CI logs — only visible after splitting into 12 named sections.

**How to apply:**
1. For each table in `db-migrate.ts` that already exists on production, identify every column whose ALTER TABLE history shows it was added after the initial CREATE.
2. Add `ALTER TABLE <t> ADD COLUMN IF NOT EXISTS <col> <type> [DEFAULT];` immediately after the `CREATE TABLE IF NOT EXISTS` block, before any index creation for that table.
3. Columns that are part of a UNIQUE INDEX are the critical ones — the index will fail if the column is missing.
4. Nullable columns and columns with defaults are both safe to add with `IF NOT EXISTS`.
5. The pattern is idempotent: re-running on a fresh DB (where CREATE TABLE actually ran) is a no-op for the ADD COLUMN statements.
