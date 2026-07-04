---
name: Cashfree PG payin webhook secret fallback
description: Why Cashfree Payment Gateway (payin) webhooks can be signed with the Client Secret instead of the configured Webhook Secret, and how the verify response must behave for dashboard test pings.
---

Cashfree PG (payin) live webhooks are not guaranteed to be signed with whatever value is saved as "webhook secret" in admin config — in practice they are commonly signed with the account's Client Secret instead. Verifying against only one candidate secret causes real, correctly-configured webhooks to fail with a misleading "invalid signature" 401.

**Why:** Cashfree's dashboard lets a merchant configure a distinct webhook secret, but many PG accounts (including this one) sign with the Client Secret regardless. There's no way to know which one a given account uses without trying both.

**How to apply:** Always verify the signature by trying an array of candidate secrets (webhook secret first, then client secret — both decrypted and `.trim()`ed) with `.some(...)`, not a single hardcoded key. Compute the signature over `timestamp + rawBody` (exact raw bytes from the body-parser's `verify` hook, never `JSON.stringify(req.body)`).

Also: once the signature passes, Cashfree's dashboard "Test" button sends a dummy/nonexistent `order_id`. That case must still ack `HTTP 200` (never 401/500) with a message like "Webhook verified, order not found for test payload", and must never trigger a wallet credit — only a real DB order match should proceed to the atomic credit transaction. Do the order lookup before sending the response so the correct message/status can be chosen (the DB lookup is fast enough that Cashfree's ack timeout isn't at risk).
