---
name: Replit deploy migration runs before container startup
description: Replit's deployment pipeline diffs the Drizzle schema against the production DB and applies migrations BEFORE the app container starts. schemaGuard cannot rescue a conflicting migration.
---

## Rule
The Drizzle schema files (`lib/db/src/schema/`) must match the **production database** column definitions exactly. Any schema drift causes Replit's pre-startup migration to generate conflicting SQL.

## Why
Replit's autoscale deployment pipeline:
1. Builds the container image
2. Diffs the Drizzle schema against the **production** PostgreSQL database
3. Generates and applies a migration SQL
4. *Only then* starts the application container

schemaGuard.ts runs inside step 4. If step 3 fails, the container never starts and schemaGuard never runs. This means schemaGuard cannot fix a conflict that step 3 introduced.

## The concrete incident
`account_visibility_rules.id` was changed in the Drizzle schema from `serial()` to `generatedAlwaysAsIdentity()`. Production still had `SERIAL` (sequence `account_visibility_rules_id_seq` existed). The generated migration emitted:

```sql
ALTER TABLE account_visibility_rules ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY
  (sequence name "account_visibility_rules_id_seq" ...)
```

PostgreSQL tried to create `account_visibility_rules_id_seq` for the IDENTITY column, but it already existed (from SERIAL). Result: `relation "account_visibility_rules_id_seq" already exists` — at migration time, not runtime.

**Fix:** Revert schema to `serial("id")` to match production exactly. No migration generated = no conflict.

## How to apply
- When changing a column type or ID strategy in the Drizzle schema, ask: does the production DB already have this column in a different form?
- If yes: either (a) keep the schema matching the current production state, or (b) write a fully idempotent pre-startup migration that handles the old state gracefully (using IF NOT EXISTS, DO $$ guards, or renaming the conflicting sequence before creating the new one).
- Never rely on schemaGuard to fix a conflict that blocks container startup.
- Dev DB (`DATABASE_URL`) state may diverge from production (schemaGuard runs in dev). When in doubt, check production separately.
