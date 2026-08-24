---
name: Merchant login OTP lifecycle
description: Durable rules for payout merchant email/mobile OTP challenges and concurrent requests
---

For payout merchant LOGIN OTPs, use one transaction-scoped PostgreSQL advisory lock per canonical identifier. Treat the initial request as idempotent during cooldown, prevent it from bypassing resend limits, and invalidate older challenges when a new one is successfully delivered. Keep verification attempts and resend allowances as separate counters. Insert/update challenge state inside the transaction but only commit after the provider confirms delivery; provider failures must roll back the row and allowance.

**Why:** Concurrent browser retries and provider failures otherwise create multiple valid codes, lose counter increments, or consume resend capacity without delivering anything.

**How to apply:** Preserve this lifecycle for LOGIN specifically; do not change unrelated signup, KYC, admin-reset, or password-reset OTP purposes unless their contracts are explicitly being revised.