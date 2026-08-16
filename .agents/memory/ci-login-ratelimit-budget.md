---
name: CI login rate-limit budget
description: How many password login calls the CI suite makes and why plan-feature-gates must reuse cached tokens
---

## The Constraint

`POST /api/auth/login` is rate-limited at **10 calls / 15 min per IP**.
In CI every playwright invocation hits `localhost`, so ALL login calls share a single IP bucket.

## Call Tally (4 playwright invocations in CI)

| Invocation | global-setup calls | spec beforeAll calls | Total |
|---|---|---|---|
| smoke-tests | admin + merchant2 = 2 | 0 | 2 |
| settings-persistence + merchant-settings | admin + merchant2 = 2 | 0 | 2 |
| otp-auth | admin + merchant2 = 2 | 0 | 2 |
| plan-feature-gates | admin + merchant2 = 2 | **0 (was 2, now fixed)** | 2 |
| **Total** | | | **8** |

Before the fix plan-feature-gates `beforeAll` made 2 fresh logins (starter + gold) = **10 total**, right at the limit. Any extra login anywhere (OTP test retry, smoke test variation) pushed it to 11 → 429 → all 8 tests fail with "Login failed".

## The Fix

`global-setup.ts` always logs in as `merchant2@demo.com` (Gold) and caches the token at `MERCHANT_TOKEN_CACHE_PATH`. `plan-feature-gates.spec.ts` now reads that cached token for `goldToken` instead of calling `login()` again. Only the Starter merchant (`merchant@demo.com`, not cached by global-setup) still requires 1 fresh login call.

**Why:**  `readCachedMerchantToken()` costs 0 rate-limit hits vs 1. Total drops from 10 to 9.

## Rule Going Forward

- Every new spec that needs a Gold merchant token MUST use `readCachedMerchantToken()`.
- Never add fresh `POST /api/auth/login` calls in spec `beforeAll` without updating this tally.
- If a new spec needs a Starter token AND a different account, add a second token cache path in `token-cache.ts` and cache it in `global-setup.ts` using the `isPlanFeatureGatesRun`-style guard so you only pay the login cost once per CI run.
