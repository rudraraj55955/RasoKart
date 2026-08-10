---
name: regclass-missing-table-crash
description: '::regclass cast in DO block WHERE clause throws when table is absent — crashes schemaGuard, zero production runtime logs'
---

# DO block `::regclass` crash pattern

## The rule

Never use `'tablename'::regclass` inside a DO block (or any PL/pgSQL block) when
the table might not exist on the target DB. Use a `pg_class` subquery instead:

```sql
-- BAD  – throws "relation does not exist" when table is absent
conrelid = 'tablename'::regclass

-- GOOD – returns empty-set for missing table, condition is safely false
conrelid IN (SELECT oid FROM pg_class WHERE relname = 'tablename')
```

**Why:** PostgreSQL evaluates `::regclass` eagerly at query-execution time, even
inside a `WHERE` predicate. When the table is absent the cast raises an unhandled
exception that aborts the entire DO block, which in schemaGuard means the api-server
never binds to its port, the autoscale startup probe times out, and the promote step
fails — with **zero runtime logs**, making the cause invisible.

**How to apply:** Any DO block that inspects `pg_constraint` or `pg_index` for a
table that may not exist (e.g. tables added after the last production deployment)
must use the `pg_class` subquery form. Core tables present since day 1 (users,
merchants, transactions, plans…) are lower-risk, but apply the safe form
uniformly for consistency.

## Symptom fingerprint

- Build phase succeeds, image pushed
- No runtime logs from production whatsoever
- Autoscale promote step fails / startup probe times out
- Same binary works perfectly in dev

## Affected commit

The consolidated UNIQUE constraint-rename DO block in `schemaGuard.ts` was
the first instance. Fixed by replacing all `::regclass` casts with
`IN (SELECT oid FROM pg_class WHERE relname=...)`.
