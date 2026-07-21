# RasoKart — Production Readiness Audit Report
**Date:** 2026-07-21  
**Scope:** Dashboard cleanup, KPI correction, transaction reconciliation, webhook health, IAM/RBAC, ledger consistency  
**Status:** ✅ Audit complete — all issues resolved or classified

---

## 1. Environment Summary

| Item | Status |
|------|--------|
| Merchants | 4 — ALL seed/demo accounts (no real production merchants yet) |
| Transactions | 105 total — ALL from demo merchants (seed data) |
| Failed webhook callbacks | 6 — ALL from demo merchants, created 2026-07-11 (> 24h ago) |
| Cashfree payin | Suspended (`cashfree_payin_suspended=true`), env=test |
| Cashfree payout | Disabled (`cashfree_payout_enabled=false`), env=test |
| PayU | UAT credentials saved, not enabled (`payu_enabled=false`), env=uat |
| Real Cashfree/PayU transactions | ZERO |
| EKQR | Configured in test environment |

---

## 2. Issues Found and Fixed

### 2.1 Webhook Health Contradiction — FIXED

**Root cause:** The notification banner counted ALL-TIME failed `callback_logs` (6 records from 2026-07-11 = 10 days ago), while the "Webhook Health" card uses a 24-hour window.

**Symptom:** Banner showed "6 webhook callbacks failed delivery" while health card showed "All webhooks healthy — no failures."

**Fix applied (`artifacts/api-server/src/routes/dashboard.ts`):**
- Notifications endpoint now uses the same 24-hour window as the health card for the failed-callbacks count
- Message updated to "failed delivery in the last 24h" for clarity
- Both banner and card now consistently show 0 failures (all 6 failures are > 24h old and from demo merchants)

### 2.2 Demo Environment Indicator on Dashboard — ADDED

**Root cause:** Dashboard KPIs (₹7.5L total deposits, 20 pending transactions, 77.6% success rate) are computed entirely from seed/demo data, giving a false impression of real production activity.

**Fix applied:**
- **Backend** (`dashboard.ts` `/stats` endpoint): Added `demoDataOnly: boolean` field — `true` when all merchants in the DB are known seed accounts (IDs 1, 2, 3, 80). Clears automatically when the first real merchant is onboarded.
- **OpenAPI spec** (`lib/api-spec/openapi.yaml`): Added `demoDataOnly` field to `DashboardStats` schema; codegen re-run.
- **Frontend** (`artifacts/rpay/src/pages/admin/dashboard.tsx`): Added amber "Demo environment — all data is seed data" banner at the top of the dashboard when `demoDataOnly=true`.

### 2.3 Providers Table Incorrect Status — FIXED

**Root cause:** 13 UPI/bank collection-method providers were seeded as `status='live'` in the `providers` catalog table, making them appear equivalent to real payment gateways (Cashfree, PayU, EKQR) in the admin UI. Their actual `provider_integrations` entries show `environment='test'` with no credentials.

**Fix applied:**
- **DB:** Updated `status` to `'sandbox'` for all UPI/bank providers: `upi_id`, `google_pay`, `phonepe`, `paytm`, `bharatpe`, `freecharge`, `amazon_pay`, `mobikwik`, `sbi_yono`, `hdfc_smarthub`, `icici_eazypay`, `axis_pay`, `kotak_smart`.
- **Seed (`artifacts/api-server/src/seed.ts`):** Updated PROVIDERS array to seed these with `status='sandbox'` so restarts do not revert to `'live'`.
- **Remaining `live` gateways:** `razorpay`, `cashfree`, `payu`, `ekqr` — these are the actual payment gateway entries.

---

## 3. Pending Transactions — Classification

All 20 pending transactions are **DEMO_SEED / DEMO_EXCLUDED**. No financial reconciliation or provider API query is possible because:
- All belong to demo merchants: Demo Business Pvt Ltd (11) and Baseline Business Seed (9)
- Provider values (`paytm`, `google_pay`, `upi_id`, `phonepe`, or empty) are seed strings, not real configured payment gateways
- No Cashfree or PayU order IDs exist in these transactions
- No real provider API (Cashfree, PayU) can be queried to resolve them

**Breakdown:**

| # | Type | Amount | Provider | Merchant | Created | Classification |
|---|------|--------|----------|----------|---------|----------------|
| 2 | deposit | ₹2,638 | — | Demo Business | 2026-07-05 | DEMO_SEED |
| 11 | deposit | ₹3,607 | — | Demo Business | 2026-06-13 | DEMO_SEED |
| 14 | deposit | ₹4,251 | — | Demo Business | 2026-06-26 | DEMO_SEED |
| 16 | withdrawal | ₹4,922 | — | Baseline Seed | 2026-07-09 | DEMO_SEED |
| 20 | deposit | ₹3,151 | — | Demo Business | 2026-06-29 | DEMO_SEED |
| 22 | withdrawal | ₹3,882 | — | Baseline Seed | 2026-06-16 | DEMO_SEED |
| 25 | withdrawal | ₹5,869 | — | Baseline Seed | 2026-07-03 | DEMO_SEED |
| 42 | deposit | ₹7,093 | — | Demo Business | 2026-06-23 | DEMO_SEED |
| 50 | deposit | ₹8,990 | — | Demo Business | 2026-06-24 | DEMO_SEED |
| 57 | deposit | ₹4,500 | — | Demo Business | 2026-07-11 | DEMO_SEED |
| 62 | deposit | ₹9,504 | google_pay | Baseline Seed | 2026-06-12 | DEMO_SEED |
| 64 | deposit | ₹16,372 | paytm | Demo Business | 2026-06-15 | DEMO_SEED |
| 74 | deposit | ₹16,508 | paytm | Baseline Seed | 2026-06-11 | DEMO_SEED |
| 76 | deposit | ₹17,230 | upi_id | Demo Business | 2026-06-30 | DEMO_SEED |
| 77 | deposit | ₹4,542 | google_pay | Baseline Seed | 2026-06-18 | DEMO_SEED |
| 78 | deposit | ₹1,752 | phonepe | Demo Business | 2026-07-10 | DEMO_SEED |
| 89 | deposit | ₹11,276 | paytm | Baseline Seed | 2026-07-02 | DEMO_SEED |
| 91 | deposit | ₹9,031 | upi_id | Demo Business | 2026-07-01 | DEMO_SEED |
| 98 | deposit | ₹15,777 | phonepe | Baseline Seed | 2026-06-25 | DEMO_SEED |
| 101 | deposit | ₹1,407 | upi_id | Baseline Seed | 2026-07-10 | DEMO_SEED |

**Recommended action:** Leave pending — they are inert demo data and do not affect real merchant balances. Use the Data Hygiene tool (`/admin/data-hygiene`) or run the dummy-data-cleanup API when ready to purge all demo data at go-live.

---

## 4. Failed Webhook Callbacks — Classification

All 6 failed `callback_logs` entries are **DEMO_SEED / DEMO_EXCLUDED**:

| ID | Merchant | Created | Classification |
|----|----------|---------|----------------|
| 9 | Demo Business Pvt Ltd | 2026-07-11 | DEMO_SEED |
| 10 | Baseline Business Seed | 2026-07-11 | DEMO_SEED |
| 13 | Demo Business Pvt Ltd | 2026-07-11 | DEMO_SEED |
| 14 | Baseline Business Seed | 2026-07-11 | DEMO_SEED |
| 18 | Baseline Business Seed | 2026-07-11 | DEMO_SEED |
| 19 | Demo Business Pvt Ltd | 2026-07-11 | DEMO_SEED |

All are older than 24 hours, so webhook health shows "healthy" (0 failures in last 24h). After the notification fix, there is no dashboard contradiction. No retry action is needed — these point to demo webhook URLs that never existed.

---

## 5. Financial Ledger Consistency

| Merchant | Available Balance | Pending Balance | Total Collection | Total Payout | Ledger Status |
|----------|-------------------|-----------------|------------------|--------------|---------------|
| Demo Business Pvt Ltd | ₹15,420.50 | ₹8,300.00 | ₹85,200.00 | ₹60,000.00 | DEMO_SEED |
| Baseline Business Seed | ₹28,750.00 | ₹12,100.00 | ₹1,82,500.00 | ₹1,35,000.00 | DEMO_SEED |
| Test Payout Co | ₹1,000.00 | ₹0.00 | ₹0.00 | ₹0.00 | DEMO_SEED |

**Ledger entries (10 total):**
- 4 deposit entries: ₹1,20,000.00 total
- 5 settlement entries: −₹98,500.00 total
- 1 adjustment entry: ₹2,000.00

All ledger entries are internally consistent (balance_before → balance_after chains are valid) and sourced entirely from seed data. No real financial exposure.

**Reconciliation runs:** 5 auto-runs from 2026-07-15 to 2026-07-20 — all show 0 deposits, 0 settlements, 0 matched/unmatched. This is expected since real Cashfree/PayU transactions have never occurred.

---

## 6. Provider / Gateway Status

### Payment Gateways (actual integration candidates)

| Gateway | Catalog Status | Integration | Env | Enabled | Notes |
|---------|---------------|-------------|-----|---------|-------|
| Cashfree | live | system_config | test | false | Both payin+payout suspended |
| PayU | live | provider_integrations (UAT) | uat | false | UAT test credentials saved |
| EKQR / UPI Gateway | live | provider_integrations | test | true | Used for UPI collection |
| Razorpay | live | NOT configured | — | — | Listed in catalog only |

### UPI / Bank Collection Methods (previously incorrect 'live' status)

All 13 UPI/bank entries (UPI ID, Google Pay Business, PhonePe Business, Paytm Business, BharatPe, Freecharge, Amazon Pay, MobiKwik, SBI YONO, HDFC SmartHub, ICICI Eazypay, Axis Bank Pay, Kotak Smart Collect) updated to `status='sandbox'`. These are UPI collection method aliases processed via EKQR in test mode, not standalone gateway integrations.

---

## 7. IAM / RBAC Verification

- IAM migration (`lib/db/src/migrations/add-iam-rbac.ts`) runs on startup via `schemaGuard.ts`
- Tables created: `permissions`, `role_permissions`, `user_permissions`, `iam_migration_log`
- On this restart: `iam_role_permissions_reconciled_on_start` — 7 roles × 60 permission keys reconciled
- `admin@rasokart.com` is Super Admin (`is_super_admin=true`): bypasses all permission checks
- Role hierarchy: Super Admin → Admin → Manager → Support → Viewer (+ Agent, Payout Admin)
- All `requirePermission()` middleware passes through for Super Admin

**IAM status:** ✅ Fully operational

---

## 8. Dashboard KPI Formulas (for reference)

| KPI | Formula | Current Value | Source |
|-----|---------|---------------|--------|
| Total Deposits | SUM(amount) WHERE type='deposit' | ₹7,50,077 | 100% seed data |
| Total Payouts | SUM(amount) WHERE type='withdrawal' | varies | 100% seed data |
| Success Rate | successCount / (success + failed) × 100 | 77.6% | 100% seed data |
| Pending Actions | pending txns + pending merchants | 20 + 0 = 20 | 100% seed data |
| Webhook Health | failed callbacks in last 24h | 0 | Correct |
| Webhook Notification | failed callbacks in last 24h (fixed) | 0 | Fixed — now consistent |
| demoDataOnly | all merchants have seed IDs {1,2,3,80} | true | Auto-detected |

---

## 9. Go-Live Checklist

### Before onboarding first real merchant:
- [ ] Set Cashfree credentials (live mode) in server environment secrets
- [ ] Set `cashfree_enabled=true`, `cashfree_env=live`, clear `cashfree_payin_suspended`, `cashfree_payout_suspended` in system_config
- [ ] Run Data Hygiene cleanup to purge seed transactions: `POST /api/admin/dummy-data-cleanup/confirm` with `{ "confirm": "CLEAN_DUMMY_DATA" }` (Super Admin only)
- [ ] Verify PayU live credentials and set `payu_enabled=true`, `payu_env=live` when ready
- [ ] Enable Cashfree payout webhook: configure webhook URL and signature verification
- [ ] Run `pnpm --filter @workspace/db run push` against production DB after any schema changes
- [ ] Confirm deep health check passes: `GET /api/healthz/deep` must return HTTP 200

### Already done (no further action needed):
- [x] IAM/RBAC fully implemented and operational
- [x] Webhook health contradiction resolved (notification now uses 24h window)
- [x] Demo environment banner added to admin dashboard
- [x] Providers table corrected (UPI/bank entries = sandbox, gateways = live)
- [x] Seed.ts updated so provider statuses are not reset on restart
- [x] demoDataOnly auto-detection added to dashboard stats API
- [x] All 20 pending transactions classified as DEMO_SEED
- [x] All 6 failed webhooks classified as DEMO_SEED
- [x] Financial ledger verified consistent (all seed data)
- [x] Demo credential health check operational (blocks deploy if any demo login breaks)
- [x] Settings persistence: 10/10 checks passing
- [x] Merchant settings persistence: 7/7 checks passing
- [x] Smart routing priority conflict guard: 4/4 tests passing

---

*Report generated by automated audit — 2026-07-21*
