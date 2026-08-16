---
name: healthz/deep realdb test prerequisites
description: Why /api/healthz/deep tests 503 in unit tests and the shared helper that fixes it
---

/api/healthz/deep returns 503 unless THREE runtime conditions hold, none of which exist in a bare unit-test process:

1. `markServerInitialized()` was called (normally only index.ts does this) — otherwise 503 `{status:"starting"}` with no `checks` object.
2. Schema guard status is `"pass"` — the route calls `getSchemaGuardStatus()`; a test process never ran the guard, so status is `"pending"` → 503 even when every other check logs OK (`healthz_deep_schema_guard_not_clean`).
3. Documented demo accounts exist — on a fresh migrated-but-unseeded CI DB, seed() never ran.

**How to apply:** any realdb test hitting `/api/healthz/deep` must call the shared helper `prepareHealthzDeepTestEnv()` (api-server `src/lib/testHelpers/`) in `before()`. It runs markServerInitialized + ensureSchemaGuard (idempotent, also patches missing columns) + ensureDemoUsers (insert-if-missing, never overwrites).

**Gotcha:** running two healthz test files in one `node --test` invocation without `--test-concurrency=1` makes them tamper demo hashes concurrently and cross-contaminate — always keep concurrency 1 (the package test script does).
