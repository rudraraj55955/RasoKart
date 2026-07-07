---
name: Payout status sync correction
description: How to handle the case where a payout shows FAILED locally but SUCCESS on Cashfree provider side.
---

# Payout status sync correction

## The problem
When Cashfree stores its own numeric cf_transfer_id (e.g. 12353104445) as our `providerReferenceId`,
GET /transfers?transfer_id=12353104445 returns 404 because that param expects our RKPAY_... string.
Simultaneously, the old refresh-status route blocked all FAILED rows as "terminal state".

## The fix
1. `cashfreePayoutGetTransferStatus`: if `?transfer_id=` returns 404 AND referenceId is all digits → retry with `?cf_transfer_id=` fallback.
2. `refresh-status`: only SUCCESS/REVERSED are truly terminal. FAILED rows WITH a providerReferenceId must be re-checkable.
3. When a FAILED→SUCCESS correction happens: wallet mutation is `availableDelta: -amt, totalPayoutDelta: +amt, totalReversalsDelta: -amt` (txnType: `payout_success_correction`). The normal `holdDelta: -amt` path is WRONG here because hold was already released to available when FAILED was first recorded.

## New retry gate
`retry` route returns 409 `hasProviderReference: true` when `providerReferenceId` exists on a FAILED row. Admin must run "Check Payout Status" first to confirm actual outcome before retrying.

## hasProviderReference field
Admin-only boolean in Withdrawal response. Used by UI to show "Check Payout Status" instead of Retry when the payout reached the provider.

## Webhook
Payout webhook now also looks up and updates `withdrawalsTable` (in addition to the old `cashfreePayoutsTable`). Matched by `providerReferenceId IN (transferId, cfTransferId)`. Includes wallet mutations with same FAILED→SUCCESS correction logic. Signature fallback: tries webhook secret, then client secret.

**Why:** Cashfree numeric cf_transfer_id stored as providerReferenceId + old terminal-state block prevented any admin from ever reconciling a provider-successful but locally-failed payout.
