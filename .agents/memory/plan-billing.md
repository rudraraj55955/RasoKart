---
name: Plan billing enforcement
description: How RPay feature gating works end-to-end — from DB flags to UI lock badges
---

## Rule
planLimits.ts is the single source of truth for feature access checks. It gates:
- daily/monthly transaction limits
- apiAccess / webhookAccess flags
- plan expiry (isExpired → blocks QR/VA/payout creation)

## How to apply
- `GET /api/plans/me/usage` returns all flags; MerchantSidebar and dashboard consume it.
- Lock badges on API Keys and Webhooks nav items come from `useGetMyPlanUsage().apiAccess`.
- `isExpired` comes from comparing `expiresAt` with `now()` server-side.

## Tier defaults (2026-06)
| Tier | API | Webhooks | Settlement | Daily Tx |
|------|-----|----------|-----------|----------|
| Starter | ✗ | ✗ | 3% | 50 |
| Silver | ✓ | ✓ | 2% | 200 |
| Gold | ✓ | ✓ | 1.5% | 1000 |
| Platinum | ✓ | ✓ | 1% | 5000 |
| Custom | ✓ | ✓ | 0.5% | unlimited |
