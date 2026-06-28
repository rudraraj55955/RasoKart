---
name: Rate limiter store reuse
description: express-rate-limit v8 throws ERR_ERL_STORE_REUSE when two limiters share one DbRateLimitStore instance
---

The rule: every call to `makeRateLimiter({ store: ... })` must get its own `new DbRateLimitStore()` instance. Never pass the singleton `dbRateLimitStore` to more than one limiter.

**Why:** express-rate-limit v8 added a validation that throws `ERR_ERL_STORE_REUSE` at startup if it detects the same store object reference used across multiple `rateLimit()` calls. This crashes the server before it can listen.

**How to apply:** In any route file that creates multiple rate limiters backed by the DB store, import the class (`DbRateLimitStore`) not the singleton (`dbRateLimitStore`) and call `new DbRateLimitStore()` inline for each limiter.
