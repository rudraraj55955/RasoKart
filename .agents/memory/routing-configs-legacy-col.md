---
name: routing_configs legacy column NOT NULL
description: The original routing_configs CREATE TABLE used (name, is_active) but Drizzle schema uses (config_name, is_enabled). On existing DBs both coexist; old NOT NULL column blocks Drizzle INSERTs.
---

## Rule

Whenever db-migrate.ts renames a column via ADD COLUMN IF NOT EXISTS, the OLD column must also be patched:

```sql
ALTER TABLE routing_configs ALTER COLUMN name DROP NOT NULL;
ALTER TABLE routing_configs ALTER COLUMN name SET DEFAULT '';
```

Without this, Drizzle INSERTs that use the new schema (only supplying `config_name`) will violate the NOT NULL constraint on the old `name` column that still exists on existing production DBs.

**Why:** The original `routing_configs` CREATE TABLE in db-migrate.ts had `name TEXT NOT NULL` with no default. When the Drizzle schema was updated to use `config_name`, the migration added `config_name` as a new column but never patched the old `name` column's NOT NULL constraint. On fresh DBs the new CREATE TABLE uses the correct schema, but on existing DBs (production) both columns coexist and the old NOT NULL blocks all INSERTs from the updated Drizzle schema.

**How to apply:** Any time a db-migrate.ts migration renames a column (old → new via ADD COLUMN), also add:
```sql
ALTER TABLE <table> ALTER COLUMN <old_col> DROP NOT NULL;
ALTER TABLE <table> ALTER COLUMN <old_col> SET DEFAULT <safe_default>;
```

This was the root cause of the priority-conflict real-DB test failure: the test INSERT used `config_name` but `name TEXT NOT NULL` had no default → PG error.
