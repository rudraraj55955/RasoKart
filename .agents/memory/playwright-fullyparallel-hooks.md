---
name: Playwright fullyParallel hook scope
description: file-level beforeAll/afterAll semantics under fullyParallel, and where to put shared-state snapshot/restore safely.
---

Under `fullyParallel: true`, Playwright can shard a single spec file's tests across multiple worker processes. A `test.beforeAll`/`test.afterAll` declared at the top of that file runs once *per worker process* handling tests from that file — not once for the whole file. A worker that finishes its assigned subset of tests early fires `afterAll` while a different worker may still be mid-test, and if that hook restores/overwrites shared external state (e.g. a global settings row a different test's still-running assertion depends on), it silently corrupts the other worker's test — producing intermittent, seemingly-unrelated value-mismatch failures that look like app bugs but are actually a test-isolation bug.

Also worth noting: 2 CPU cores can only usefully run ~2 concurrent Chromium instances; oversubscribing `workers` beyond the core count adds real timing flakiness (slow renders blowing through UI timeouts) that's easy to misdiagnose as app-level races — check `nproc` before tuning worker count.

**Why:** discovered when a "reliable fullyParallel e2e suite" task passed structurally (typecheck, individual runs) but a code-review run reproduced intermittent cross-test value corruption (e.g. VA retention expected 30, got a canary value from a sibling test) traced to a per-worker `afterAll` restoring a shared settings snapshot mid-run.

**How to apply:** for any state a whole *file* needs to capture once and restore once (not per-test), use Playwright's `globalSetup`/`globalTeardown` config options — both are guaranteed to run exactly once per `playwright test` invocation regardless of worker/shard count. Never rely on file-level `beforeAll`/`afterAll` for cross-worker-shared setup/teardown once `fullyParallel` is on.
