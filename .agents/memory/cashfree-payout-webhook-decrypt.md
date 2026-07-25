---
name: Cashfree payout webhook secret decryption
description: The webhook route must decrypt system_config secrets before using them as HMAC keys; raw encrypted blob always fails verification.
---

## Rule
`cashfree_payout_client_secret` and `cashfree_payout_webhook_secret` in `system_config` are stored as `enc:v1:<ivHex>:<tagHex>:<ctHex>` (AES-256-GCM). Any route that reads these and uses them as HMAC keys MUST call `decryptSecret()` first.

**Why:** The webhook route was passing the raw `enc:v1:...` string as the HMAC-SHA256 secret, so `HMAC(timestamp+body, "enc:v1:...")` can never match what Cashfree computes with the real key. Every signature failed with `webhook_signature_mismatch`.

**How to apply:**
- Import `decryptSecret` from `../helpers/cryptoUtils`
- Call it before any HMAC operation: `const secret = decryptSecret(rawValue).ok ? (decryptSecret(rawValue) as {ok:true;value:string}).value : ""`
- Use a single active secret (no multi-secret fallback in production): webhook_secret if non-empty, else client_secret
- The `cashfreePayout.ts` operational route already does this correctly — the webhook route was the only outlier

## Related
- `artifacts/api-server/src/helpers/cryptoUtils.ts` — encryption/decryption helpers
- `artifacts/api-server/src/routes/cashfreePayoutWebhook.ts` — fixed webhook route
- `artifacts/api-server/src/routes/cashfreePayout.ts` — reference for correct decryption pattern
