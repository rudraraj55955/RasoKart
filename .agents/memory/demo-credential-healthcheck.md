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
in both `seed.ts` and `verify-demo-credentials.ts` to match.
