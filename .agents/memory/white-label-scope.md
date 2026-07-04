---
name: White-label scope boundary
description: Which surfaces must never show provider (Cashfree) names/ids vs which are allowed to.
---

When a task says "never expose [provider name]/raw errors/raw ids", that requirement is scoped to **merchant-facing and customer-facing** surfaces only, unless the task explicitly says otherwise.

**Why:** Admins are the ones configuring and operating the actual payment gateway integration. They need to see the real provider name, base URL, API version, and raw provider order IDs (e.g. in a payment logs table) to debug and configure the connection. Treating admin ops/config screens as needing the same white-labeling as customer UI is over-scoping and produces false-positive test failures.

**How to apply:** When verifying white-label requirements (e.g. via Playwright/e2e test), scope "must not contain provider name/raw ids" checks to merchant portal pages and dialogs. Admin config pages (e.g. `/admin/payin-gateway`) and admin ops tables are expected and allowed to show the provider name, base URL, and raw order/reference ids.
