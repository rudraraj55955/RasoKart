---
name: Payin order status casing
description: cashfree_payment_orders.status must use the shared PAYIN_ORDER_STATUS uppercase constants, not ad-hoc string literals
---

`cashfreePaymentOrdersTable.status` is a plain `text` column (no DB enum), so nothing at the DB layer stops
code from silently drifting on casing (e.g. lowercase `"paid"` vs uppercase `"PAID"`). This previously broke
the merchant deposit daily-limit query in production: the SUM(...) WHERE status=$2 query used lowercase
`"paid"` while other/newer code paths expected uppercase, so the aggregate matched zero rows silently (or
errored) depending on the code path.

**Why:** a text column plus multiple call sites (webhook handlers, order-creation routes, admin filters,
frontend status checks) inserting/comparing status as raw literals will always drift eventually — there's no
compiler or DB constraint to catch a `"paid"` vs `"PAID"` mismatch.

**How to apply:** always import and use `PAYIN_ORDER_STATUS` (`CREATED | PENDING | PAID | FAILED | EXPIRED`,
all uppercase) from `@workspace/db` (`lib/db/src/schema/cashfreePayments.ts`) for every read/write/compare of
this column — server routes, webhooks, AND the frontend (`activeOrderStatus.status === "PAID"`, admin status
filter dropdown values, etc). Never reintroduce a raw string literal for this field. If a future column becomes
similarly ad-hoc typed, prefer converting it to a real Postgres enum or at minimum a shared constants module up front.
