---
name: Payout slip public page field mismatch
description: buildSlipData returns flat fields; original frontend type used nested/renamed fields causing crash
---

## Rule
`buildSlipData` in `withdrawals.ts` returns flat field names that differ from how the original `payout-slip-public.tsx` `SlipData` type was written.

Correct mapping:
- API `merchantBusinessName` (flat string) — NOT `merchant.businessName`
- API `utrDisplay` — NOT `utr`
- API `transactionDateTime` — NOT `processedAt`

**Why:** The frontend page was written with a prototype type that didn't match the actual server implementation. The mismatch caused a runtime crash ("Something went wrong" error boundary) because `slip.merchant` was `undefined`.

**How to apply:** When adding new fields to `buildSlipData`, update BOTH the server return shape AND `payout-slip-public.tsx`'s `SlipData` type in lock-step. Also update `payout-verify-public.tsx` if the public verify endpoint shape changes.

## Route gap
`verificationUrl` in slip data points to `/verify-payout/:verificationToken`. This frontend route was initially missing. Added `payout-verify-public.tsx` and wired it in `App.tsx`.
