---
name: realdb test CI exclusion pattern
description: *.realdb.test.ts files need seeded demo users and running server; exclude them from the unit test CI step with find ! -name '*.realdb.test.ts' | xargs.
---

## Rule

Files named `*.realdb.test.ts` are integration tests that require:
1. Seeded demo users (merchant@demo.com, admin@rasokart.com, etc.)
2. Running API server (schemaGuard has executed)

The production-deploy CI unit test step (`pnpm --filter @workspace/api-server test`) runs BEFORE server startup and seed. Including realdb tests in that step causes 12/13 tests to fail with `{"error":"Unauthorized"}` because `generateToken()` creates valid JWTs but the users don't exist in the DB yet.

**Why:** Caught when `merchantEnrollments.realdb.test.ts` was added and matched the `src/**/*.test.ts` glob. The `schemaGuard.freshInstall.realdb.test.ts` file has the same naming convention and is subject to the same issue.

**How to apply:**

Use `find | sort | xargs` in `package.json` to exclude all realdb test files:

```json
"test": "find src -name '*.test.ts' ! -name '*.realdb.test.ts' | sort | xargs node --import tsx --test-concurrency=1 --test-force-exit --test"
```

Do NOT use Node's `--test-exclude` flag with a glob — in Node 24 the flag causes the test runner to hang when the glob is passed as a literal string (preventing shell expansion of `'src/**/*.test.ts'`).

Any new realdb test file must follow the `*.realdb.test.ts` naming convention to be automatically excluded. Add a CI job to run them separately after server startup if coverage is needed.
