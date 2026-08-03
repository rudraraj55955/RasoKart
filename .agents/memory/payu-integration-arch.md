---
name: PayU UAT integration architecture
description: Key design decisions for the PayU Hosted Checkout integration — credential storage, hash formula, idempotency, and capability honesty contract.
---

## Credential storage — dual-env
- UAT Key/Salt → `provider_integrations.apiKeyEncrypted` / `apiSecretEncrypted`
- Live Key/Salt → `provider_integrations.clientIdEncrypted` / `clientSecretEncrypted`
- **Critical**: the column split applies to ALL three loaders: `loadPayuCreds` (payuOrders.ts) AND `loadPayuKeyForEnv`/`loadPayuSaltForEnv` (payuWebhook.ts). Forgetting the webhook loaders causes live callbacks to fail hash verification.
- Credentials NEVER returned in any response — only masked first/last 4 chars
- Env var override: `PAYU_UAT_KEY`/`PAYU_UAT_SALT` (UAT), `PAYU_LIVE_KEY`/`PAYU_LIVE_SALT` (Live)
- Live mode gated: live creds present + `PAYU_LIVE_VERIFIED === "true"` in system_config
- `PUT /config` accepts `env: "uat"|"live"` (default "uat"); saving live creds resets verification
- New keys: `PAYU_LIVE_VERIFIED` ("true"/"false"), `PAYU_LIVE_VERIFIED_AT` (ISO timestamp)
- `POST /verify-live`: 4-step server probe; writes verification keys only on full pass
- `lib/db/dist` must be rebuilt (`cd lib/db && npx tsc`) when schema/systemConfig.ts changes — api-server uses compiled `.d.ts` via project references

## Hash formulas (SHA-512)
- Payment hash: `sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt)`
- Response hash (reverse): `sha512(salt|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)`
- The `||||||` = 6 empty pipes between udf5 and the next field
- Use timing-safe comparison (crypto.timingSafeEqual) for response hash checks

## Idempotency — wallet credit
- `creditWalletForPayu()` in payuOrders.ts (shared by webhook + browser return)
- Atomic UPDATE status INITIATED/PENDING→SUCCESS; if 0 rows updated → duplicate
- Both s2s webhook and browser return use the same function → exactly one wins
- UTR format: `PAYU-{mihpayid}` or `PAYU-{txnid}` — unique constraint on transactions.utr

## Route mount ordering
- `router.use("/payment", payuWebhookRouter)` — public, no auth, before all auth-guarded routes
- PayU s2s (`/payment/payu-s2s`) ACKs 200 immediately, then processes async
- Browser return (`/payment/payu-return`) verifies hash, then 302-redirects to `/merchant/deposits?payu_status=...`

## Capability audit contract
- `hostedCheckout: true` — the only active capability in UAT
- `refund, settlement, subscription, paymentLinks, payout: false` — requires provider activation
- Admin panel shows honest capability matrix; capabilityNote explains why others are inactive
- Never show these as working without real provider activation

## Onboarding status progression
- `ONBOARDING_PENDING`: no credentials saved
- `UAT_AVAILABLE`: UAT key+salt saved (enabled or not)
- `LIVE_PENDING_ACTIVATION`: live credentials not yet received from PayU
- `PAYOUT_PENDING_ACTIVATION`: always shown (separate PayU Payout agreement needed)

## PayU UAT URLs
- Payment: `https://test.payu.in/_payment`
- Status enquiry: `https://test.payu.in/merchant/postservice.php?form=2`
- Live payment: `https://secure.payu.in/_payment`
- Live status: `https://info.payu.in/merchant/postservice.php?form=2`

**Why:** Keeping credentials server-side (never in frontend) and using timing-safe hash comparison prevents replay attacks and credential leakage. Capability honesty prevents merchant confusion about what actually works in UAT vs live.
