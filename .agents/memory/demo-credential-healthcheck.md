---
name: Demo credential health check
description: How and where documented demo/test account logins are automatically verified
---

`seed.ts` runs `verifyDemoCredentials()` at the end of `seed()`. It checks
every account listed in `DEMO_CREDENTIALS` (mirrors replit.md's "Demo
Credentials" table) — existence, `isActive`, expected role, and a real
`bcrypt.compare` against the documented password — and logs a structured
`logger.error` per broken account plus a summary error, or a single
`logger.info` pass line. It intentionally does not throw/exit: seed's
upsert pattern already self-heals these accounts on every restart, so this
is a loud detection signal, not a hard startup gate.

A standalone, read-only counterpart lives at
`scripts/src/verify-demo-credentials.ts` (`pnpm --filter @workspace/scripts
run verify-demo-credentials`), useful for CI/post-deploy checks where you
want a non-zero exit code instead of just a log line.

**Why:** merchant@demo.com / merchant2@demo.com previously went missing
from a dev DB with nothing catching it until someone hit a failed login by
hand.

**How to apply:** whenever you add, remove, or change a documented demo
account in replit.md's Demo Credentials table, update `DEMO_CREDENTIALS`
in `lib/demo-credentials/src/index.ts` only — `seed.ts`,
`routes/health.ts`, and `scripts/src/verify-demo-credentials.ts` all
import from there, so one edit propagates everywhere automatically.
Also update replit.md's Demo Credentials table to keep it in sync.

Admins can also permanently remove a demo account via the admin-portal
merchant detail action (`POST /merchants/:id/remove-demo-account`), which
writes to a `demo_account_removals` DB table that `seed.ts` consults so the
account is never re-upserted. If you e2e-test that removal flow in a shared
dev DB, revert it afterward (delete the `demo_account_removals` row,
reactivate the user, reset merchant status) — otherwise the account stays
gone and the health check above starts failing on every future restart.
