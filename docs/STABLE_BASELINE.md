# RasoKart Payment Core — Stable Baseline

**Created:** 2026-08-13  
**Production SHA:** `6e85afbe`  
**Rollback SHA:** `6210196b` (CORS fix) → `8d1230e5` (try/catch fix)  
**Status:** ✅ RASOKART PAYMENT CORE — STABLE BASELINE

---

## Scope

This document records the known-good production baseline for the RasoKart
Payment Core as of the above SHA.  Future work **must not regress** any item
listed here.  Before merging any payment-path change, re-run the test matrix
in Section 5.

---

## 1. Included in This Baseline

| Component | State |
|---|---|
| PayU Payin (Live mode) | ✅ Enabled, credentials verified, ₹100 E2E pass |
| PayU browser return callback (`/api/payment/payu-return`) | ✅ CORS bypass, try/catch, safe body, GET handler |
| PayU S2S webhook (`/api/payment/payu-s2s`) | ✅ CORS bypass, immediate 200 ACK, async credit |
| PayU duplicate/idempotency guard | ✅ Atomic `WHERE status IN (INITIATED,PENDING) RETURNING` |
| Razorpay payin flow | ✅ Existing working flow intact, no regression |
| Merchant wallet credit (`creditWalletForPayu`) | ✅ Atomic, outer try/catch, outcome-typed return |
| Merchant transaction records | ✅ Written on PayU success/failure |
| Merchant callback signing secret | ✅ AES-256-GCM encrypted at rest, HMAC-SHA256 verification |
| Callback CORS bypass | ✅ `PAYMENT_CALLBACK_PATHS` set in app.ts |
| IAM / RBAC enforcement | ✅ Live on VPS (migration 2026-07-19), 71 permissions, 497 role_permissions |
| Merchant isolation | ✅ All queries scoped by `merchantId` |
| Super Admin bypass | ✅ `isSuperAdmin` flag, `__all__` pass-through in `resolveUserPermissions` |
| schemaGuard | ✅ 115/115 Drizzle tables guarded; 0 known gaps |
| Schema-guard CI enforcement | ✅ `schema-guard-coverage` runs in CI on every push and every PR; new unguarded tables block merge |
| Demo merchant callback secrets | ✅ AES-256-GCM seeded for merchant@demo.com, merchant2@demo.com, merchant3@demo.com |

---

## 2. Critical Files — Do Not Modify Without Re-Running Tests

| File | Why Critical |
|---|---|
| `artifacts/api-server/src/app.ts` | CORS bypass for PayU return/S2S callbacks |
| `artifacts/api-server/src/routes/payuWebhook.ts` | Browser return + S2S handler, CORS bypass |
| `artifacts/api-server/src/routes/payinOrders.ts` | `creditWalletForPayu` — atomic wallet credit |
| `artifacts/api-server/src/middlewares/callbackAuth.ts` | HMAC-SHA256 signature verification, decrypt path |
| `artifacts/api-server/src/routes/callbacks.ts` | Callback secret rotation (encrypt at rest) |
| `artifacts/api-server/src/lib/schemaGuard.ts` | `payu_payment_orders` column guards |
| `artifacts/api-server/src/helpers/cryptoUtils.ts` | AES-256-GCM encrypt/decrypt for all secrets |
| `artifacts/api-server/src/routes/index.ts` | Route mounting order — must not introduce duplicates |
| `artifacts/api-server/src/middlewares/auth.ts` | `requireAuth`, `requireAdmin`, `requireSuperAdmin` |

---

## 3. Environment Requirements (VPS Production)

| Variable | Purpose | Required |
|---|---|---|
| `SESSION_SECRET` | AES-256-GCM key derivation for all encrypted secrets | ✅ Must be set |
| `DATABASE_URL` | PostgreSQL connection | ✅ Must be set |
| `PAYU_LIVE_KEY` | PayU live merchant key (fallback if DB config missing) | ⚠️ Set via Admin → PayU |
| `PAYU_LIVE_SALT` | PayU live salt (fallback if DB config missing) | ⚠️ Set via Admin → PayU |
| `RAZORPAY_KEY_ID` | Razorpay API key | ✅ Must be set |
| `RAZORPAY_KEY_SECRET` | Razorpay API secret | ✅ Must be set |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhook HMAC | ✅ Must be set |
| `MSG91_AUTH_KEY` | Email OTP delivery | ⚠️ Required for OTP login |

**PayU live mode is controlled via `system_config` table** (`payu_enabled`, `payu_env`, `payu_live_verified`).  
The VPS `.env` values `PAYU_LIVE_KEY`/`PAYU_LIVE_SALT` are only fallback; primary is Admin UI → PayU Settings.

---

## 4. Payment Flow Architecture

```
Customer browser
    │
    │  POST (form) from secure.payu.in
    ▼
CORS bypass middleware (app.ts:73-108)
    │  Access-Control-Allow-Origin: *
    │  Skips allowlist check for PAYMENT_CALLBACK_PATHS
    ▼
POST /api/payment/payu-return  (payuWebhook.ts)
    │  1. Safe body default (req.body ?? {})
    │  2. verifyPayuResponseHash(hash, key, salt, fields)
    │  3. creditWalletForPayu(txnid, amount, merchantId, mihpayid)
    │     └─ UPDATE WHERE status IN (INITIATED,PENDING) RETURNING
    │     └─ outcome: credited|duplicate|error|credit_failed
    │  4. res.redirect(302, /merchant/deposits?payu_status=...)
    │  NEVER returns INTERNAL_ERROR JSON to browser
    ▼
POST /api/payment/payu-s2s  (payuWebhook.ts)
    │  1. res.json({ success: true })  ← immediate 200 ACK to PayU
    │  2. async creditWalletForPayu (same atomic guard)
    │  CORS bypass also applies
```

---

## 5. Required Test Matrix (Run Before Any Payment-Path Merge)

### 5.1 Automated Tests

```bash
# TypeScript — must be clean
cd artifacts/api-server && pnpm exec tsc --noEmit
cd artifacts/rpay && pnpm exec tsc --noEmit

# PayU return/S2S callback regression (11 tests)
cd artifacts/api-server && node --import tsx/esm --test src/routes/payuWebhook.test.ts

# Callback signing pipeline (10 tests)
cd artifacts/api-server && SESSION_SECRET="..." \
  node --import tsx/esm --test src/routes/callbacks.signing.test.ts

# EKQR webhook reachability (3 tests)
cd artifacts/api-server && node --import tsx/esm --test src/routes/paymentWebhook.test.ts

# Gateway panel coverage (7 tests)
cd artifacts/rpay && node --import tsx/esm --test src/lib/gateway-panel-coverage.test.ts

# System config coverage (3 tests)
cd lib/db && node --import tsx/esm --test src/schema/systemConfig.coverage.test.ts


# Schema guard coverage (static analysis — all Drizzle tables guarded)
pnpm --filter @workspace/scripts run schema-guard-coverage

# Schema guard fresh-install smoke test (46 checks — real DB, ephemeral transaction)
# Part A: acquires a pg.PoolClient, BEGINs a transaction, DROPs 12 representative
#         guarded tables so they are genuinely absent, calls runSchemaGuardWith()
#         (the exact schemaGuard SQL via the client executor) to recreate them,
#         asserts all 28 guarded tables exist in information_schema.tables within
#         the transaction, then ROLLBACKs — no permanent data loss.
# Part B: starts the Express app, logs in as admin + merchant via POST /api/auth/login,
#         hits 17 representative routes with real Bearer tokens, asserts HTTP 200
#         (handler ran its DB query all the way through, not just auth middleware).
# Wired into CI as a required check in .github/workflows/schema-guard-ci.yml
# (Job: schema-guard-fresh-install) against a fresh PostgreSQL service container.
cd artifacts/api-server && node --import tsx/esm --test src/lib/schemaGuard.freshInstall.realdb.test.ts

# Priority conflict guard
pnpm --filter @workspace/scripts run verify-priority-conflict-tests
```

### 5.2 Baseline Test Results (SHA 6e85afbe)

| Suite | Tests | Result |
|---|---|---|
| PayU callback regression | 11 | ✅ 11/11 PASS |
| Callback signing pipeline | 10 | ✅ 10/10 PASS |
| EKQR webhook reachability | 3 | ✅ 3/3 PASS |
| Gateway panel coverage | 7 | ✅ 7/7 PASS |
| System config coverage | 3 | ✅ 3/3 PASS |
| Schema guard coverage | 115 tables, 0 gaps | ✅ PASS |
| Schema guard fresh-install smoke | 50 checks: 1 pre-guard absence proof + 28 table-creation (isolated tx) + 18 route 200s + 3 payload checks (Part C: platform-profit/summary fields, zero-values on empty DB, payin-charges/ singleton defaults) | ✅ 50/50 PASS |
| Priority conflict guards | real-DB | ✅ PASS |
| TypeScript (api-server) | — | ✅ CLEAN |
| TypeScript (rpay) | — | ✅ CLEAN |

---

## 6. Known Gaps (Not Blockers)

| Item | Gap | Risk |
|---|---|---|
| `payout_test@demo.com` callback secret | NULL (payout-only merchant, no API key) | LOW — warning not triggered |
| 16 pre-guard DB tables | ✅ All 16 now have CREATE TABLE IF NOT EXISTS guards in schemaGuard.ts | RESOLVED |
| `checkPlanFeatureAccess` not called on routes | API/webhook plan gate defined but not route-enforced | LOW — frontend enforces; backend gate defined |
| IAM dev DB | IAM tables absent in Replit dev DB | INFO — VPS prod has full IAM (16/16 verify-iam-migration PASS) |
| `admins.map is not a function` in CI test | Credit-failure admin alert hits unstubbed DB in test environment | INFO — only in test harness; production alert function is correct |

---

## 7. Merchant Permission Defaults

All 13 `merchant_*` permission keys default to `true` for the merchant role
(defined in `permissions.ts:452-496`).  No route currently calls
`requirePermission` with a `merchant_*` key — access is role-based
(`requireAuth` + `user.role === "merchant"` check).

Merchant permission catalog:
`merchant_dashboard`, `merchant_transactions`, `merchant_payouts`,
`merchant_api_keys`, `merchant_webhook`, `merchant_virtual_accounts`,
`merchant_qr_codes`, `merchant_ledger`, `merchant_reports`, `merchant_kyc`,
`merchant_onboarding`, `merchant_support`, `merchant_payment_links`.

---

## 8. Rollback Procedure

```bash
# If a regression is detected on VPS, roll back to the prior stable SHA:
git revert HEAD   # OR
git checkout 6210196b -- .
git push origin main
# GitHub Actions will auto-deploy to VPS
```

Rollback SHAs in order of preference:
1. `6210196b` — CORS fix + safe body (PayU return stable, no secret encryption)
2. `8d1230e5` — try/catch fix (partial PayU fix, no CORS fix)

---

*This document is maintained by the RasoKart engineering team.  
Update Section 5.2 after every stable deployment.*

# Verifies every guarded table has a reachable route that survives a fresh DB startup.

# In CI this runs against a truly empty DB; locally it is idempotent.
cd artifacts/api-server && node --import tsx/esm --test src/lib/schemaGuard.freshInstall.realdb.test.ts


# Schema guard fresh-install smoke test (18 routes — real DB, non-500 after guard)
