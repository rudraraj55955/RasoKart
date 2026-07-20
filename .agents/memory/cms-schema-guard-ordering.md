---
name: CMS schema guard ordering
description: Promotional CMS tables must be placed BEFORE the IAM migration in schemaGuard.ts to avoid cascade abort
---

## Rule
The `promotional_campaigns` and `promotional_analytics` CREATE TABLE statements in `schemaGuard.ts` must appear **before** the `await up(db)` call (IAM migration) in the `runGuard` function.

**Why:** The IAM migration (`lib/db/src/migrations/add-iam-rbac.ts`) throws a FK constraint violation error on non-fresh DBs where `role_permissions` already has data. This throws before reaching any subsequent statements in `runGuard`, causing all subsequent tables to never be created (cascade abort). The promotional tables were added after the IAM block and were never created on the existing dev DB — had to create them manually via psql.

**How to apply:** Any new tables added to `schemaGuard.ts` should be placed before the `// ── IAM tables ──` block (currently at the end of the function). Until the IAM FK issue is fixed, the IAM block is effectively the "abort wall" — nothing after it runs on the existing DB.

## Related
- See `schemagGuard-cascade-abort.md` for the general cascade abort pattern
- The IAM FK error: `insert or update on table "role_permissions" violates foreign key constraint "rp_permission_key_fk"` — this is a pre-existing constraint conflict, not introduced by CMS work
