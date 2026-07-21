---
name: Dashboard demo detection
description: How demoDataOnly is detected and why notifications must use the same window as the health card.
---

## The rule
`GET /api/dashboard/stats` computes `demoDataOnly = true` when `SELECT count(*) FROM merchants WHERE id NOT IN (1,2,3,80) = 0`.
Clears automatically when first real merchant joins (their id won't be in the seed list).

**Why:** All seed merchants get IDs 1, 2, 3, 80 via idempotent upsert. Any real merchant gets a higher auto-increment id.

## Notification vs health card window
Both `dashboard/notifications` (failed-callbacks entry) and `dashboard/webhook-health` must use the same 24-hour look-back window.
If one uses all-time and the other uses 24h, the banner says "6 failed" while the health card says "healthy" — a visible contradiction.

**How to apply:** When adding any new time-windowed stat to the health card, find the matching notification path and align the window.
