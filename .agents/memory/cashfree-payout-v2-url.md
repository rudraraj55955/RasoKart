---
name: Cashfree Payouts V2 base URL
description: Correct base URL and auth pattern for Cashfree Payouts V2 Standard Transfer API
---

Cashfree Payouts V2 Standard Transfer uses base URLs `https://api.cashfree.com/payout` (live) /
`https://sandbox.cashfree.com/payout` (test) — **no `/v2` path segment**. V2 is selected purely via
the `x-api-version: 2024-01-01` header, with `x-client-id` / `x-client-secret` headers (no Bearer
token, no `transfer_token`).

**Why:** Appending `/v2` to the URL (e.g. `.../payout/v2/transfers`) silently routes to a legacy
Cashfree endpoint that expects OAuth-style Bearer token auth instead. This causes transfers to fail
with a generic "Token is not valid" error even though credential-test / V1-authorize calls succeed,
because those hit a different, correctly-versioned endpoint. The error message gives no hint that
the URL shape (not the credentials) is the actual problem.

**How to apply:** Any payout/transfer helper that talks to Cashfree V2 Payouts must NOT include a
`/v2` path segment in the base URL. If a "Token is not valid" error appears on transfer/beneficiary
calls while a direct V1 authorize curl or admin credential-test succeeds, check the URL path first,
not the credentials.
