---
name: Threading new provider config through all call sites
description: When adding an optional config param to a shared provider helper, grep the whole src tree for every call site — legacy-looking route files can still be mounted and active.
---

When adding a new parameter (e.g. `providerConfig` for base URL/API version overrides) to a shared helper function, updating the "obvious" call sites (main routes/withdrawals.ts) is not enough.

**Why:** This repo has multiple route files that look like duplicates or legacy leftovers (e.g. `routes/cashfreePayout.ts` alongside `routes/withdrawals.ts`, or `helpers/payoutStuckCleanupScheduler.ts` calling the same provider helpers on a cron). All of them were still mounted in `routes/index.ts` / registered as active schedulers, so skipping them would have left silent inconsistent behavior (some code paths honoring an admin-configured override, others silently falling back to hardcoded defaults).

**How to apply:** After changing a shared helper's signature, `grep` the entire `src/` tree for every import/call of that helper name before considering the change complete — do not rely on memory of "which files use this." Cross-check each hit against `routes/index.ts` (or scheduler registration) to confirm it's actually live, not dead code.
