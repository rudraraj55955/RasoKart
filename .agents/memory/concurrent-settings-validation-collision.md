---
name: Concurrent settings validation collision
description: Why settings-persistence validations can fail only when completion commands run concurrently.
---

Settings-persistence checks that snapshot, mutate, and restore global configuration must not be treated as independent when they share one development database.

**Why:** The completion validator can run multiple configured commands concurrently. A script changing a shared setting can invalidate a Playwright suite's baseline between its snapshot and reload assertion, producing different failures across runs even though the exact failing suite passes in isolation.

**How to apply:** When a completion-only settings failure reports an unexpected value written by another settings check, rerun the exact command alone. If the isolated suite passes and task-specific checks pass, document the cross-command collision rather than changing unrelated product code.