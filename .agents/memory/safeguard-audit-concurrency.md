---
name: Safeguard audit concurrency
description: Why overlapping production safeguard audits use GitHub Actions concurrency instead of an API-level label lock.
---

Serialize scheduled and manually dispatched production safeguard audits with one GitHub Actions concurrency group and keep `cancel-in-progress` disabled.

**Why:** A repository label used as a mutex can be abandoned when a runner is cancelled or terminated before cleanup. Later audits can then stall indefinitely and fail to notify the owner. Workflow concurrency is managed outside the runner and safely queues both runs.

**How to apply:** Keep all production safeguard audit entry points in the same workflow concurrency group. Preserve marker-based issue lookup as the idempotency check after each queued run starts.