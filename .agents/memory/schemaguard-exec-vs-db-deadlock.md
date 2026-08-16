---
name: schemaGuard exec vs db deadlock
description: Every SQL statement inside runGuard() must use the exec executor, never the global drizzle db object — mixing the two causes indefinite lock deadlocks on a fresh database.
---

Every SQL inside `runGuard()` (in `artifacts/api-server/src/lib/schemaGuard.ts`) must use the `exec` executor argument, never the global `db` object.

**Why:** `runGuard()` is called inside a `BEGIN`/`ROLLBACK` transaction in the fresh-install test's `before()` hook. The transaction holds `ACCESS EXCLUSIVE` locks on tables it just created. If any code inside `runGuard()` uses the global drizzle `db` pool (a separate PG connection), it tries to acquire `ACCESS SHARE` or `ROW EXCLUSIVE` on the same tables — which the transaction already holds exclusively — causing an indefinite cross-connection lock deadlock. The test process hangs for minutes until the GitHub Actions `timeout-minutes` kills it.

Two specific locations that were fixed:
1. The `merchant_connections_credential_migration` block: `db.select()` + `db.update()` converted to `exec.execute(sql\`...\`)`.
2. The `iam_tables` block: `await up(db)` converted to `await up(exec)` — `GuardExecutor` and `DrizzleExecutor` are structurally identical so this is a safe substitution.

**How to apply:** Whenever adding new blocks inside `runGuard()`, use `exec.execute(sql\`...\`)` for all queries. Never import `db` from `lib/db` inside the guard function. If a helper like `up()` accepts a db argument, pass `exec` not `db`.
