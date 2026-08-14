---
name: Cashfree PG payin webhook secret fallback
description: Why Cashfree Payment Gateway (payin) webhooks can be signed with the Client Secret instead of the configured Webhook Secret, how the verify response must behave for dashboard test pings, and the two-route architecture in production.
---

Cashfree PG (payin) live webhooks are not guaranteed to be signed with whatever value is saved as "webhook secret" in admin config — in practice they are commonly signed with the account's Client Secret instead. Verifying against only one candidate secret causes real, correctly-configured webhooks to fail with a misleading "invalid signature" 401.

**Why:** Cashfree's dashboard lets a merchant configure a distinct webhook secret, but many PG accounts (including this one) sign with the Client Secret regardless. There's no way to know which one a given account uses without trying both.

**How to apply:** Always verify the signature by trying an array of candidate secrets (webhook secret first, then client secret — both decrypted and `.trim()`ed) with `.some(...)`, not a single hardcoded key. Compute the signature over `timestamp + rawBody` (exact raw bytes from the body-parser's `verify` hook, never `JSON.stringify(req.body)`).

Also: once the signature passes, Cashfree's dashboard "Test" button sends a dummy/nonexistent `order_id`. That case must still ack `HTTP 200` (never 401/500) with a message like "Webhook verified, order not found for test payload", and must never trigger a wallet credit — only a real DB order match should proceed to the atomic credit transaction.

**Admin UI encryption rule (critical):** systemConfig.ts saves BOTH cashfree_webhook_secret and cashfree_client_secret through encryptSecret() (enc:v1: AES-256-GCM). Any webhook route reading these from system_config MUST call decryptSecret() via a resolveSecret() helper before using the value as an HMAC key. Using the raw enc:v1:… blob as an HMAC key causes all legitimate Cashfree webhooks to return 401 silently. This was a live P0 production bug fixed in commit ff0acb6c (deployed 2026-08-15).

**Two-route architecture (production state as of 2026-08-15):**
- POST /api/payment/cashfree-webhook (cashfreeWebhook.ts) — CANONICAL, HARD fail-closed, new wallet model (merchant_wallets + wallet_ledger + transactions), deployed and active. Cashfree dashboard points here. Uses cashfree_webhook_secret (priority) → cashfree_client_secret (fallback).
- POST /api/webhooks/payin/cashfree (payinWebhook.ts) — added by a merged task, SOFT (no-credential fallback accepts unsigned), LEGACY accounting (merchants.balance + ledger_entries). NOT registered in Cashfree dashboard. Pending deprecation or alignment.

**Replit executeSql ≠ VPS production DB:** Replit's executeSql with environment:"production" queries the Replit-managed DB, NOT the VPS production PostgreSQL. For credential presence checks, SSH into VPS and query via node + pg from the pnpm store path: `/var/www/rasokart/node_modules/.pnpm/pg@8.20.0/node_modules/pg`.
