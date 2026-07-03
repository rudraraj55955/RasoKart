---
name: Cashfree Payouts V2 beneficiary lifecycle
description: How beneficiary creation/reuse is wired into withdrawal approve/retry to avoid beneficiary_not_found
---

Cashfree Payouts V2 Standard Transfer requires a beneficiary to exist server-side before transfer; there is no separate "add bank details" UI step in this app (bank fields live only on the withdrawal row), so beneficiary ensure/create must happen at approve/retry time, not earlier.

**Flow**: deterministic `beneficiaryKey` from bank account+IFSC → look up `payout_beneficiaries` row (merchantId+env scoped) → if `active`, reuse `providerBeneficiaryId`; else call Create Beneficiary; on `beneficiary_already_exists` subCode, fetch/confirm the existing one; persist result (`active`/`failed` + safe `last_error`) before attempting transfer. Transfer's `beneficiary_details` must include `bank_account_number`/`bank_ifsc` as sibling fields to `beneficiary_id`, not nested.

**Why:** Cashfree 404s with `beneficiary_not_found` if the transfer references a beneficiary_id that was never created (or was created under different bank details) on their side; the local DB was previously never tracking Cashfree's beneficiary identity at all.

**How to apply:** Any change to withdrawal approve/retry payout logic must go through `ensurePayoutBeneficiary`/`invalidatePayoutBeneficiary` in `withdrawals.ts` — do not call `cashfreePayoutCreateTransfer` without first resolving a beneficiary. Ensure flow must never throw (wrap network calls in try/catch, return `ok:false` on failure) so approve/retry always completes with a graceful `PAYOUT_BENEFICIARY_ERROR` failureReason instead of a 500. Log only whitelisted fields (`payout_beneficiary_create_attempted`: withdrawalId, localBeneficiaryId, providerBeneficiaryId, httpStatus, subCode, providerMessage) — never bank account numbers, secrets, tokens, or raw provider responses.
