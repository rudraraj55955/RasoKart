---
name: Cashfree Payout V2 webhook signing
description: How Cashfree Payouts V2 signs webhooks, what went wrong in production, and the fix applied.
---

# Cashfree Payout V2 Webhook Signing

## The rule
Cashfree Payouts V2 signs outbound webhooks with the **Payout Client Secret** (`x-client-secret`). There is no separate webhook signing secret — the Cashfree dashboard (Developers → Webhooks) shows only URL and Version.

Algorithm: `HMAC-SHA256(timestamp_string + raw_request_body, payoutClientSecret)` → base64
Headers: `x-webhook-signature` (base64 HMAC), `x-webhook-timestamp` (Unix epoch seconds, string)

**Why:** Confirmed by: (1) user observation of the live Cashfree dashboard, (2) original implementation comment in `cashfreePayoutWebhook.ts`, (3) VPS dual-secret live test.

## Secret priority in the code
```
activeSecret = decryptedWebhookSecret || decryptedClientSecret
```
`cashfree_payout_webhook_secret` takes priority when non-empty. Must be EMPTY for correct behaviour — Cashfree has no separate webhook secret, so this field should never hold a value.

## Production incident (2026-08-14, resolved)
- `cashfree_payout_webhook_secret` had a PLAINTEXT[54] value (`cfsk_m...e5ef`) set 2026-07-03 — NOT the Client Secret.
- This blocked `cashfree_payout_client_secret` (the correct key, AES-encrypted, decrypts to `...199d`).
- All real Cashfree webhooks failed (`signature_mismatch`) from 2026-08-04 onward.
- The 3 `signature_verified=true` rows on 2026-07-25 were manually crafted internal tests (`WBHTEST_` prefix), not from Cashfree.
- Fix: `DELETE FROM system_config WHERE key = 'cashfree_payout_webhook_secret'` — zero code changes.

## Key derivation (cryptoUtils.ts)
`AES_KEY = SHA-256(SESSION_SECRET)` — NOT `RASOKART_ENCRYPTION_KEY` (that env var is unrelated).
Stored format: `enc:v1:<ivHex>:<tagHex>:<ciphertextHex>` — exactly 3 colon-separated parts after prefix.

## UI gap (pending defect)
Leaving the Webhook Secret field blank and clicking Save is a silent no-op — the frontend omits empty fields (`if (webhookSecret !== "") body.webhookSecret = ...`). The backend `upsertOrDelete` already handles `""` as a delete. A Clear button or explicit empty-send is needed.

## How to apply
- If webhook verification fails with `signature_mismatch`, check `cashfree_payout_webhook_secret` first.
- If it has any value, delete the row — the field MUST be empty.
- The active secret should always be `cashfree_payout_client_secret`.
- Replay protection: ±5-minute timestamp window is correct; Cashfree dashboard "Test Webhook" sends stale timestamps — always use VPS-local WEBHOOK_TEST POST for verification, not the dashboard test button.
