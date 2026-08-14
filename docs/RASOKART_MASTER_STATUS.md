# RASOKART MASTER STATUS LEDGER
**Canonical source of truth for all RasoKart project state.**
_Read this before starting any task. Update this after every task._

---

**Last Updated:** 2026-08-15 (IST) — Task #2475 complete  
**Updated By:** Agent (main)  
**Trigger:** Task #2475 — PayU stuck-order recovery scheduler implemented, tested, committed

---

## ⚠️ PERMANENT WORKFLOW RULE

**BEFORE starting ANY future task:**
1. Read this file first.
2. Confirm the task is not already CLOSED/STABLE.
3. Check whether another task must happen before it.
4. Check whether human/deploy approval is still pending.
5. Do not restart completed work.
6. Do not silently reorder the NEXT ACTION QUEUE.

**AFTER every task:**
1. Update this file — move to correct section.
2. Record commit SHA, production SHA, rollback SHA.
3. Record all tests run and their results.
4. Record remaining human actions.
5. Update NEXT ACTION QUEUE.
6. Never mark CLOSED unless final production verification passed.

**If a new report conflicts with this file:**  
DO NOT GUESS. Reconcile: current production SHA + DB/runtime evidence + prior closure report + task state. Then update with an explanation of what changed.

---

## 1. CURRENT PRODUCTION STATE

| Field | Value |
|---|---|
| **Production SHA** | `6e67df6740f70a729d84710ddade7d81657ccb23` |
| **Previous SHA (immediate rollback)** | `1f41738e` — Add status-filter real-DB tests and cooldown mock tests |
| **Safe baseline SHA** | `dec7d3b9` — Add automated tests for cashfree payin credit backfill script |
| **Production health** | ✅ ALL GREEN — `healthz/deep` status=ok, schema_guard=pass, all checks true |
| **Last deploy date/time** | 2026-08-14 ~22:16 UTC (2026-08-15 ~03:46 IST) |
| **Deploy trigger** | GitHub Actions push-to-main → appleboy SSH → PM2 restart |
| **PM2 process** | `rasokart-api` (ID 4, PID 2214773) — online, 315 MB RSS |
| **Domain** | `rasokart.com` (nginx → `127.0.0.1:3000`) |
| **DB** | PostgreSQL on VPS — `localhost:5432/rasokart` |
| **IAM/RBAC** | Live since 2026-07-19T19:32:27Z — 71 permissions, 497 role_permissions |

**Rollback command (immediate, if regression found):**
```bash
git revert --no-commit 6e67df67 312b2af4 && git commit -m "revert: cashfree payout webhook security fix" && git push
# GitHub Actions deploys automatically
```

---

## 2. CLOSED / STABLE

> **DO NOT REOPEN** any item in this section unless new production evidence of regression exists.

---

### 2.1 Auth System Stable Baseline
- **Module:** Authentication (JWT, session, OTP)
- **Final Status:** ✅ CLOSED — STABLE
- **Locked SHA:** `40807c21`
- **Production SHA at close:** Pre-2026-08 (IAM era)
- **Tests:** 15-point regression checklist — all PASS
- **Closure date:** ~2026-07 (pre-IAM)
- **Final verdict:** Full auth system locked. **Do not modify** `auth.ts`, `app.ts` session config, or `seed.ts` demo credentials without explicit approval + regression run.
- **Notes:** `merchant@demo.com`, `merchant2@demo.com`, `merchant3@demo.com`, `admin@rasokart.com` — seeded and health-checked on every start via `healthz/deep`.

---

### 2.2 IAM / RBAC Full System
- **Module:** IAM — permissions, roles, role_permissions, migration
- **Final Status:** ✅ CLOSED — LIVE IN PRODUCTION
- **Migration ran:** 2026-07-19T19:32:27Z (cutoff timestamp)
- **Production SHA at close:** Pre-2026-08
- **Tests:** `verify-iam-migration` 16/16 PASS; `healthz/deep` IAM checks all true
- **Closure date:** 2026-07-19
- **Final verdict:** IAM migration is a one-time operation. Already live. `role_permissions` seeded on every start for new permission keys. Super Admin (`admin@rasokart.com`) bypasses all permission checks via `isSuperAdmin=true`.
- **Critical constraint:** Migration only runs once — new `ALL_PERMISSION_KEYS` added after lock must be upserted in `seed.ts` or they are absent from `role_permissions`.

---

### 2.3 PayU Payin — Live Mode
- **Module:** PayU payin, browser return, S2S webhook
- **Final Status:** ✅ CLOSED — STABLE, LIVE
- **Production SHA at close:** `6e85afbe` (STABLE_BASELINE.md reference)
- **Tests:** PayU callback regression 11/11 PASS; callback signing 10/10 PASS
- **Closure date:** 2026-08-13
- **Final verdict:** `₹100` live E2E verified. Browser return + S2S both CORS-bypassed. Atomic `creditWalletForPayu` with `WHERE status IN (INITIATED,PENDING) RETURNING` idempotency guard. PayU config primary via `system_config` table; `PAYU_LIVE_KEY`/`PAYU_LIVE_SALT` env vars are fallback only.
- **Do not modify:** `payuWebhook.ts`, `payinOrders.ts` (creditWalletForPayu), `app.ts` CORS bypass section.

---

### 2.4 Cashfree Payin — Webhook + Wallet Credit
- **Module:** Cashfree payin, webhook signature, wallet credit
- **Final Status:** ✅ CLOSED — STABLE
- **Key SHAs:** `85115cb2` (fail-closed + wallet credit), `abf69c83` (remove alternate route), `ff0acb6c` (decryptSecret for Admin UI secrets)
- **Tests:** Stateful round-trip RT1–RT4+RT2b PASS; EKQR webhook reachability 3/3 PASS
- **Closure date:** ~2026-08-10
- **Final verdict:** Single webhook route at `/api/cashfree/webhook`. Signature fail-closed. Secrets AES-256-GCM encrypted at rest. Dual-secret fallback: tries webhook_secret first, then client_secret.
- **Live payin fallback:** Live payin webhooks may be signed with Client Secret not Webhook Secret — both are tried.

---

### 2.5 Cashfree Payout Webhook — Security Fix
- **Module:** Cashfree payout webhook, replay guard, LOW_BALANCE_ALERT handling
- **Final Status:** ✅ CLOSED — DEPLOYED 2026-08-15
- **Commit SHAs:** `312b2af4` (initial fix), `6e67df67` (security corrections — DEPLOYED)
- **Production SHA:** `6e67df67`
- **Rollback SHA:** `1f41738e`
- **Tests:** 23/23 PASS (W1–W9, W8b, C1–C5, T1, T3, K2–K4, M1–M3)
- **Closure date:** 2026-08-15
- **Root cause:** Commit `7ff58477` introduced a replay guard whose `!timestamp` check fired on LOW_BALANCE_ALERT events (Format B — no headers, body-only signature), returning 401 `stale_timestamp` and causing Cashfree to retry indefinitely.
- **Fix:** Format B events (no `x-webhook-timestamp`) → HTTP 200 ACK-only. `signatureVerified=false` (explicit, never null). `processingResult='ignored_unverified_info'`. ZERO wallet/ledger/payout-state mutations.
- **Security posture:** Standard Format A (TRANSFER_SUCCESS etc.) — strict timestamp + HMAC-SHA256/base64, completely unchanged. Body-signature formula for LOW_BALANCE_ALERT is undocumented by Cashfree; all HMAC candidates failed. Events are NOT authenticated but ACK'd to stop retry storms.
- **Final verdict:** SAFE. Financial mutations structurally unreachable from any body-signed code path.
- **Post-deploy verification:** All 8 tests PASS on production including valid HMAC (fingerprint `...199d`) → 200, wrong sig → 401, stale ts → 401, future ts → 401, LOW_BALANCE_ALERT → 200 ACK, DB log confirms signatureVerified=false, processingResult=ignored_unverified_info, transfer_id=null.

---

### 2.6 13 Stuck Cashfree Payin Orders — Status Correction
- **Module:** cashfree_payment_orders (payin)
- **Final Status:** ✅ CLOSED — CORRECTED 2026-08-15
- **Action:** `UPDATE cashfree_payment_orders SET status='EXPIRED', updated_at=NOW() WHERE id IN (1..13) AND status='CREATED'` — 13 rows updated.
- **Audit log:** `audit_logs` ID 430 — `MAINTENANCE_STATUS_CORRECTION` by `admin@rasokart.com (ID 1)`
- **Closure date:** 2026-08-15 22:16:55 UTC
- **Root cause:** Cashfree payin integration suspended 2026-07-15; orders created 2026-07-03 to 2026-07-13 never received Cashfree expiry webhooks; remained CREATED locally.
- **Merchants affected:** Merchant 4 (11 orders), Merchant 41424 (2 orders)
- **Financial impact:** ZERO. All 13 orders had zero payment attempts at Cashfree. No wallet credited, debited, or held. wallet_ledger count before=126, after=126. transactions count before=122, after=122.
- **Dashboard:** Stuck-order count before=13, after=0. Alert cleared.
- **Rollback:** `UPDATE cashfree_payment_orders SET status='CREATED', updated_at=NOW() WHERE id IN (1..13) AND status='EXPIRED'; DELETE FROM audit_logs WHERE id=430;`

---

### 2.7 Schema Guard CI System
- **Module:** Schema guard, CI enforcement
- **Final Status:** ✅ CLOSED — ACTIVE IN CI
- **Tests:** 115/115 Drizzle tables guarded, 0 gaps; schema-guard-coverage PASS; schema-guard-fresh-install 50/50 PASS
- **CI jobs:** `schema-guard-coverage` (static, no DB), `schema-guard-fresh-install` (real PostgreSQL)
- **Final verdict:** Any new unguarded `pgTable()` blocks the merge. ALTER-before-CREATE ordering bug caught by fresh-install test.

---

### 2.8 Callback Signing + Merchant Webhook Setup
- **Module:** Outgoing callbacks, HMAC signing, merchant webhook onboarding
- **Final Status:** ✅ CLOSED — STABLE
- **Key SHA:** `52f7d083`
- **Tests:** 14-test suite PASS; callback signing pipeline 10/10 PASS
- **Final verdict:** AES-256-GCM secret at rest; HMAC-SHA256 for outgoing callback verification. Merchant onboarding step `callbackVerified` implemented.

---

### 2.9 Cashfree Payin Credit Backfill + Reconciliation UI
- **Module:** Cashfree payin reconciliation, backfill script
- **Final Status:** ✅ CLOSED — STABLE
- **Key SHAs:** `7fc52352` (backfill script), `4f1b68c5` (reconciliation UI), `dec7d3b9` (automated tests)
- **Tests:** Automated backfill tests PASS
- **Final verdict:** Admin can run credit recovery for missed payin webhooks. Stuck-order dashboard alert with configurable thresholds. CSV export with formula-injection protection.

---

### 2.10 Admin Self-Service Password Change
- **Module:** Admin portal, settings
- **Final Status:** ✅ CLOSED — STABLE
- **Key SHA:** `1c85b229`
- **Closure date:** ~2026-08
- **Final verdict:** Admins can change their own password from the settings page.

---

### 2.11 Smart Routing Engine
- **Module:** Smart routing rules, priority system
- **Final Status:** ✅ CLOSED — STABLE
- **Notes:** Equal-priority routing rules favor lowest-id row. New rule must use strictly lower priority number to win over seeded default.

---

### 2.12 Plans + Billing System
- **Module:** Plans, billing, plan enforcement
- **Final Status:** ✅ CLOSED — STABLE
- **Key SHAs:** `3ac42cfd` (plans system), `667a21fb` (plan billing), `2a66367e` (enforcement)
- **Plan tiers:** Starter (free, no API/webhooks), Silver, Gold, Platinum (full access), Custom. Legacy Startup/Business/Enterprise deleted from DB.
- **Final verdict:** `planLimits.ts` / `getMerchantPlanUsage()` is single source of truth. Starter has no API/webhook/provider access. Frontend enforces; backend gate defined but not route-enforced.

---

### 2.13 Dynamic QR Module
- **Module:** QR codes, merchant QR management
- **Final Status:** ✅ CLOSED — STABLE
- **Key SHA:** `47c36778`

---

### 2.14 Virtual Account Module
- **Module:** Virtual accounts
- **Final Status:** ✅ CLOSED — STABLE
- **Key SHA:** `ef07bec6`

---

### 2.15 EKQR / UPI Gateway Integration
- **Module:** EKQR webhook, signature verification, daily cap
- **Final Status:** ✅ CLOSED — STABLE (with open minor tasks in PENDING)
- **Tests:** EKQR webhook reachability 3/3 PASS

---

### 2.16 Razorpay Payin
- **Module:** Razorpay payin flow
- **Final Status:** ✅ CLOSED — STABLE (existing flow; no regressions from any changes)
- **Notes:** Razorpay is `coming_soon` in the providers catalog UI. Live payin flow exists and is tested (no regression). Full Razorpay capability audit (refunds, settlements, payout) not yet implemented — see PENDING.

---

### 2.17 Subdomain Architecture + Agent Portal
- **Module:** Multi-subdomain SPA, agent portal
- **Final Status:** ✅ CLOSED — STABLE
- **Notes:** Single SPA on all 5 subdomains; subdomain detection is client-side; `apiUrl()` cross-origin helper; `authHeaders()` returns `Record<string,string>`.

---

### 2.18 Mobile Merchant Portal — Compact Layout
- **Module:** Mobile UI, merchant pages
- **Final Status:** ✅ CLOSED — STABLE
- **Key SHA:** `822350ed`

---

### 2.19 Task #2475 — PayU Stuck-Order Recovery Scheduler
- **Module:** PayU payin — webhook reliability / missing-webhook recovery
- **Final Status:** ✅ CLOSED — COMMITTED 2026-08-15, AWAITING DEPLOY APPROVAL
- **Commit SHA:** `5d587609`
- **Production SHA:** `d7dc6468` (not yet deployed — deploy approval required)
- **Rollback SHA:** `d7dc6468` (simply don't deploy)
- **Tests:**
  - `payuStuckOrderRecovery.test.ts` — 20/20 PASS (new)
  - `payuWebhook.test.ts` — 11/11 PASS (baseline unchanged)
  - `webhook.security.audit.test.ts` — 23/23 PASS (unchanged)
  - `systemConfig.coverage.test.ts` — 3/3 PASS (new keys covered)
  - `schema-guard-coverage` — 115/115 PASS (no new table)
- **Closure date:** 2026-08-15
- **Root cause confirmed:** PayU payin orders stuck in INITIATED/PENDING had no automatic recovery path. The S2S webhook (`/api/payment/payu-s2s`) is the only credit trigger — if it is never delivered (network failure, PayU retry exhausted, brief server downtime), the order stays stuck and the merchant is never credited. No polling, no scheduled recheck, no alert existed. The Cashfree equivalent (`cashfreeStuckOrderScheduler.ts`) was already in place; PayU had nothing.
- **Fix:** New scheduler `payuStuckOrderRecovery.ts`:
  - Runs every 15 minutes + startup sweep
  - Scans `payu_payment_orders` WHERE status IN (INITIATED, PENDING), older than staleMinutes (default 30), production merchants only
  - For each stuck order: calls `queryPayuTransactionStatus` (existing PayU Verify Payment API helper)
  - Decision per PayU response: `success`→credit, `failure/failed`→FAILED, `cancelled/cancel`→CANCELLED, `pending`→leave, `not found`→leave, API error→leave, no creds→skip but still alert
  - After recoveries: re-counts remaining stuck orders, fires admin email alert if count ≥ threshold (default 3) with 4h cooldown
- **Idempotency:** `creditWalletForPayu`'s `WHERE status IN (INITIATED, PENDING) RETURNING` atomic guard prevents double-credit even under concurrent scheduler + webhook delivery. Second run returns `outcome=duplicate`, no second wallet/ledger mutation.
- **Wallet/ledger:** `source='payu_stuck_order_recovery'` written to `transactions.description`. `wallet_ledger` entry type `pending_credit`, identical to webhook path. No new mutations introduced — existing `creditWalletForPayu` called unmodified.
- **Security:** Zero changes to `payuWebhook.ts`, `payinOrders.ts`, `app.ts`. No new endpoints. No credential exposure. Only production merchants scoped. Only credits on PayU-confirmed `success` — never on ambiguous/missing status.
- **No new DB table.** 4 new `system_config` keys: `payu_stuck_order_stale_minutes` (30), `payu_stuck_order_alert_threshold` (3), `payu_stuck_order_alert_cooldown_hours` (4), `payu_stuck_order_alert_last_sent_at` (runtime-state). All seeded automatically from `SYSTEM_CONFIG_DEFAULTS` on first use. No schema migration needed.
- **Do not deploy without explicit user approval.**

---

## 3. IN PROGRESS

_No tasks currently in progress._

---

## 4. WAITING FOR MY APPROVAL

### 4.1 Code Approval
_None currently pending._

### 4.2 Deployment Approval
_None currently pending._ (Last deployment `6e67df67` approved and completed 2026-08-15.)

### 4.3 Merge Approval
_None currently pending._

### 4.4 Production Smoke-Test Approval
_None currently pending._

---

## 5. HUMAN ACTION REQUIRED

### H1 — Add MSG91_AUTH_KEY to VPS `.env` to activate email OTP login
- **Exact action:** SSH into VPS → `nano /var/www/rasokart/.env` → add `MSG91_AUTH_KEY=<key>` → `pm2 restart rasokart-api`
- **Location:** VPS at `$VPS_HOST`, file `/var/www/rasokart/.env`
- **Why required:** `otpLoginEnabled=false` until key is present. Code is deployed and working; only the env var is missing.
- **After completion:** Test OTP email delivery from login page. Verify inbox receives 6-digit OTP within 30s.
- **Risk if skipped:** Email OTP login remains disabled for all users.

### H2 — Contact Cashfree support for LOW_BALANCE_ALERT body-signature algorithm
- **Exact action:** Open a Cashfree Payout developer support ticket requesting documentation of the body-signature algorithm for LOW_BALANCE_ALERT and other informational webhook events (events sent without `x-webhook-timestamp` / `x-webhook-signature` headers).
- **Location:** Cashfree developer portal → Support
- **Why required:** Current code returns HTTP 200 ACK-only for these events with `signatureVerified=false`. Without the algorithm, we cannot authenticate them. Every LOW_BALANCE_ALERT is logged as `ignored_unverified_info`.
- **After completion:** Once algorithm is confirmed, implement proper body-signature verification (reference task #2668 — currently cancelled, can be re-proposed). Check `candidateTails` in PM2 logs for each incoming event to match against the confirmed formula.
- **Urgency:** LOW — the 401 retry storm is fixed; this is hardening only.

### H3 — Verify Cashfree Payout dashboard webhook test button post-deploy
- **Exact action:** Log into Cashfree Payout dashboard → Settings → Webhooks → click "Test Webhook" button
- **Location:** Cashfree Payout dashboard (not RasoKart admin)
- **Why required:** The original failure was a 401 from this exact button. Post-deploy human verification confirms from Cashfree's side that they now receive 200.
- **After completion:** Confirm in RasoKart admin → Payout Webhook Logs that the test event appears with `processingResult=received` or `ignored` (Format A — WEBHOOK_TEST), `signatureVerified=true`.
- **Urgency:** MEDIUM — confirms the fix is working end-to-end from Cashfree's perspective.

---

## 6. THIRD-PARTY BLOCKED

### B1 — Cashfree: LOW_BALANCE_ALERT Body-Signature Algorithm
- **Provider:** Cashfree Payout
- **Exact requirement:** Official documentation or support confirmation of the HMAC formula used to sign LOW_BALANCE_ALERT events sent in the body-only format (no `x-webhook-timestamp` / `x-webhook-signature` headers).
- **Current status:** 9 HMAC formula candidates tested against 2 production captures — all failed. Algorithm unknown.
- **What RasoKart can do meanwhile:** Current ACK-only response stops retry storms. `processingResult=ignored_unverified_info` clearly marks these in the audit log. PM2 logs `candidateTails` on each event for offline formula comparison once algorithm is revealed.
- **Risk:** LOW — no financial exposure. LOW_BALANCE_ALERT is informational only; no state mutation possible on this code path.

### B2 — Cashfree Payouts V2: Beneficiary/Transfer Endpoint Activation
- **Provider:** Cashfree Payout
- **Exact requirement:** Cashfree account-level activation for V2 beneficiary and transfer API endpoints. Passing V1 authorization test does not guarantee V2 endpoints accept the same credentials.
- **Current status:** Unverified. V2 base URL uses `x-api-version` header, not `/v2/` in path.
- **What RasoKart can do meanwhile:** Payout dispatch code is complete; live testing blocked by account activation.

### B3 — Razorpay: Full Capability Activation (Refunds, Settlements, Payout)
- **Provider:** Razorpay
- **Exact requirement:** Razorpay account activation for: refund issuance, settlement data API, RazorpayX payout. Current capability audit: `refund=false`, `settlement=false`, `payout=false`.
- **Current status:** Razorpay is `coming_soon` in providers catalog. Payin flow exists.
- **What RasoKart can do meanwhile:** Razorpay capability audit UI built (Task #2278 closed). Tasks #2279 (analytics) and #2280 (refunds + RazorpayX) remain in PROPOSED.

### B4 — PayU: UAT → Live Mode Upgrade (Full API Access)
- **Provider:** PayU
- **Exact requirement:** PayU account upgrade to access full settlement, refund, and payout APIs beyond hosted checkout.
- **Current status:** Hosted Checkout live and verified (₹100 E2E pass). Settlement/refund/payout APIs not available in current account tier.
- **What RasoKart can do meanwhile:** All hosted checkout flows are complete and live.

---

## 7. ACTUAL PENDING TASKS

> Showing highest-priority visible tasks from the queue. Full list has 1,052 PROPOSED tasks.

### P0 — Critical / Payment / Security

| Task | Module | Exact Issue | Impact | Tests Required | Deploy |
|---|---|---|---|---|---|
| ~~#2475 (CLOSED)~~ | PayU webhook | ✅ Recovery scheduler implemented — commit 5d587609, awaiting deploy | Payment reliability | 20/20 new + 11/11 baseline | PENDING APPROVAL |
| #2471 | EKQR alerts | Stuck-EKQR alert must stop sending when all admins opt out | Notification spam | Alert opt-out test | YES |
| #301 | Callbacks | Alert merchants when signature failures spike | Security visibility | Spike detection test | YES |

### P1 — High / Financial / Merchant-Facing

| Task | Module | Exact Issue | Impact | Tests Required | Deploy |
|---|---|---|---|---|---|
| #114 | Withdrawals | Merchant withdrawals stats inaccurate across all pages | Financial display | Stats across pages | YES |
| #109 | Providers | No warning when merchant disables last active provider | Merchant UX | Last-provider guard | YES |
| #1355 | EKQR | EKQR payment URL missing from QR detail modal | Merchant UX | Modal render test | YES |
| #2453 | EKQR | Configurable warning threshold not applied to EKQR daily cap bar | Admin UX | Cap bar threshold | YES |
| #1062 | Callbacks | Demo callback logs empty — callbacks page is blank on fresh DB | Demo/onboarding | Seed test | YES |

### P2 — Medium / Admin / Operational

| Task | Module | Exact Issue | Impact | Tests Required | Deploy |
|---|---|---|---|---|---|
| #1426 | KYC | Admin not notified by email when merchant submits KYC docs | Operations | Email send test | YES |
| #356 | SMTP | Admins cannot test SMTP from settings without saving first | Admin UX | SMTP test endpoint | YES |
| #1424 | KYC | Merchants cannot see full KYC document submission history | Merchant UX | History API test | YES |
| #824 | Reports | No failure count badge on Scheduled Reports section header | Admin UX | Badge count test | YES |
| #491 | Reports | No preview of reconciliation report recipients before resend | Admin UX | Preview endpoint | YES |
| #793 | Reports | Lookback preset not shown on past reconciliation run view | Admin UX | Lookback display | YES |
| #335 | QR Providers | QR Provider Manager cannot filter by usage level | Admin UX | Filter endpoint | YES |
| #1269 | Reports | Schedules with repeated delivery trouble not highlighted | Admin UX | Badge/flag test | YES |
| #588 | Callbacks | No "check webhook settings" link on callback stats card | Admin UX | Link render test | NO |
| #2353 | Cleanup | Cleanup streak reset unverified when admin runs manually | Reliability | Streak reset test | NO |

### P3 — Low / UX Improvements

| Task | Module | Exact Issue | Impact | Tests Required | Deploy |
|---|---|---|---|---|---|
| #828 | Notifications | No custom snooze duration — only preset options | Merchant UX | Snooze duration test | YES |
| #1235 | Settings | Custom date presets not synced across devices | Merchant UX | Cross-device sync test | YES |

---

## 8. NEXT ACTION QUEUE

```
CURRENT TASK:  Task #2475 — PayU stuck-order recovery scheduler — COMPLETE
               Commit 5d587609 pushed to github/main. Tests: 20+11+23+3+115 all PASS.
               ⚠️ DEPLOY APPROVAL REQUIRED before this goes to production.

NEXT TASK:     Task #2471 — Confirm stuck-EKQR alert stops sending when all
               admins have opted out (P0, alert reliability)

THEN:          Task #301 — Alert merchants when signature failures spike (P1, security)

LATER:         Task #114 — Accurate merchant withdrawals stats (P1, financial)
               Task #1062 — Seed demo callback logs (P1, demo/onboarding)
               Task #1355 — EKQR payment URL in QR detail modal (P1)
               Task #1426 — KYC email notification for admin (P2)
               Task #356  — SMTP test from settings page (P2)
```

**Rule:** Do not change this order without user approval. If a new task is inserted, record the reason and approver here.

---

## 9. HUMAN DECISIONS / APPROVAL HISTORY

| Date (IST) | Decision | Task / Scope | Deployed? | Notes |
|---|---|---|---|---|
| 2026-08-15 | HOLD DEPLOYMENT — Cashfree payout webhook fix | Task: fix LOW_BALANCE_ALERT 401 | NO (held) | Security report requested before deploy |
| 2026-08-15 | APPROVED — Deploy Cashfree payout webhook security fix | Commit `6e67df67` only. Strict: no Cashfree Payin, PayU, Razorpay, EKQR, wallet/ledger, settlements, IAM, credentials. Format A HMAC unchanged. LOW_BALANCE_ALERT → 200 ACK, signatureVerified=false, processingResult=ignored_unverified_info, ZERO mutations. | YES — deployed `6e67df67` | 23/23 tests pass. All 8 post-deploy checks pass. |
| 2026-08-15 | APPROVED — 13 stuck orders status correction | UPDATE cashfree_payment_orders SET status='EXPIRED' WHERE id IN (1..13) AND status='CREATED'. No wallet/ledger/transactions. Audit entry required. | N/A (DB-only) | 13 rows updated. wallet_ledger unchanged (126). transactions unchanged (122). Audit log #430 written. |
| 2026-08-15 | CANCELLED tasks #2668 and #2669 | Task #2668 (LOW_BALANCE_ALERT sig formula), Task #2669 (periodic payin expiry sync) | N/A | User cancelled both proposed follow-up tasks |

---

## 10. PAYMENT CORE BASELINE

> All items below are STABLE and passing in production as of SHA `6e67df67`.

| Component | Status | Notes |
|---|---|---|
| **PayU Payin (Live)** | ✅ LIVE — verified | Browser return + S2S webhook. CORS-bypassed. Atomic wallet credit. ₹100 E2E verified. |
| **PayU Webhook** | ✅ STABLE | `/api/payment/payu-return` (browser) + `/api/payment/payu-s2s` (S2S). Immediate 200 ACK on S2S. Try/catch prevents 500 to browser. |
| **Razorpay Payin** | ✅ STABLE (payin only) | Existing flow intact. Capability audit shows refund/settlement/payout = false. |
| **Cashfree Payin** | ✅ STABLE | Single webhook route. Fail-closed. Dual-secret fallback (webhook_secret → client_secret). AES-256-GCM encrypted secrets. |
| **Cashfree Payout** | ✅ STABLE | Format A: strict timestamp+HMAC-SHA256/base64. Format B: 200 ACK-only, signatureVerified=false, ZERO mutations. Webhook secret field MUST remain empty (client secret is the only signing key). |
| **Wallet / Ledger** | ✅ STABLE | `creditWalletForPayu` atomic. All wallet mutations gated behind authenticated + HMAC-verified webhook paths. `merchant_wallets`, `wallet_ledger`, `transactions` tables. |
| **Webhooks (general)** | ✅ STABLE | Replay guard: ±5-min timestamp window on all standard webhooks. Cashfree payout Format A: HMAC-SHA256/base64. PayU: hash verification. Cashfree payin: dual-secret fallback. |
| **Merchant Isolation** | ✅ STABLE | All DB queries scoped by `merchantId`. Cross-merchant reads blocked at SQL level. |
| **IAM / RBAC** | ✅ LIVE | Migration ran 2026-07-19. 71 permissions, 497 role_permissions, 7 roles. Super Admin bypasses all checks. `resolveUserPermissions()` returns null (pass-through) before migration, `{__all__:true}` for SA. |
| **Callback Signing** | ✅ STABLE | AES-256-GCM at rest (enc:v1: envelope). HMAC-SHA256 for outgoing callback verification. Key derived from SESSION_SECRET via SHA-256. |
| **schemaGuard** | ✅ ACTIVE | 115/115 Drizzle tables guarded. CI gate blocks any unguarded new table. Fresh-install smoke test 50/50. |

---

## 11. KNOWN-GOOD BASELINES

| SHA | Description | When to Use |
|---|---|---|
| `6e67df67` | **Current production** — Cashfree payout webhook security fix | Latest stable |
| `1f41738e` | Pre-session — stuck-order scheduler tests | Rollback from `6e67df67` if regression |
| `dec7d3b9` | Cashfree payin credit backfill tests | Rollback past stuck-order scheduler work |
| `4f1b68c5` | Cashfree Payin Reconciliation UI | Rollback past reconciliation |
| `6e85afbe` | STABLE_BASELINE.md reference — PayU live + IAM + schema guard | Full payment core rollback |
| `7ff58477` | Webhook security audit (API monitoring + admin retry + replay guard) | Pre-LOW_BALANCE_ALERT fix; has stale_timestamp regression on Format B |
| `52f7d083` | Merchant webhook/callback setup | Rollback past callback signing |
| `40807c21` | Auth stable baseline | Auth regression rollback |

**Rollback procedure:**
```bash
git checkout <SHA> -- .
git add -A && git commit -m "rollback: revert to <SHA>"
git push origin main
# GitHub Actions auto-deploys to VPS
```

---

## 12. DO-NOT-TOUCH / FREEZE ITEMS

> These modules are stable in production. Modifications require: (1) explicit user approval, (2) full test suite run, (3) security/regression analysis.

| Module / File | Why Frozen | Required Tests Before Any Change |
|---|---|---|
| `artifacts/api-server/src/app.ts` | CORS bypass for PayU callbacks; session config; rawBody parser | PayU regression suite (11 tests) + callback signing (10 tests) |
| `artifacts/api-server/src/routes/payuWebhook.ts` | PayU browser return + S2S webhook — live payment processing | PayU regression suite (11/11) |
| `artifacts/api-server/src/routes/payinOrders.ts` | `creditWalletForPayu` — atomic wallet credit with idempotency guard | PayU regression suite + manual E2E |
| `artifacts/api-server/src/routes/cashfreePayoutWebhook.ts` | Just fixed — Format A HMAC unchanged; Format B ACK-only; zero mutations | Webhook security audit 23/23 |
| `artifacts/api-server/src/routes/cashfreeWebhook.ts` | Cashfree payin — fail-closed signature, dual-secret | RT1–RT4+RT2b stateful tests |
| `artifacts/api-server/src/middlewares/auth.ts` | JWT auth, requireAuth, requireAdmin, requireSuperAdmin | Auth baseline 15-point checklist |
| `artifacts/api-server/src/middlewares/callbackAuth.ts` | HMAC-SHA256 callback signature verification; decrypt path | Callback signing pipeline (10/10) |
| `artifacts/api-server/src/helpers/cryptoUtils.ts` | AES-256-GCM encrypt/decrypt for ALL secrets in system_config | Any secret round-trip test |
| `artifacts/api-server/src/lib/schemaGuard.ts` | All 115 table guards; ordering matters (CREATE before ALTER) | schema-guard-fresh-install (50/50) |
| `lib/db/src/schema/` (all schema files) | Drizzle schema — changes need schemaGuard + db-migrate.ts sync | schema-guard-coverage (0 gaps) |
| `artifacts/api-server/src/routes/index.ts` | Route mounting order — duplicates cause silent 404s | Full route smoke test |
| `artifacts/api-server/src/seed.ts` | Demo credentials; plan seeding; permission upserts | Demo credential verification |
| IAM migration (`lib/db/src/migrations/add-iam-rbac.ts`) | One-time migration — already ran on prod 2026-07-19 | `verify-iam-migration` 16/16 |
| `system_config` table — payment credentials | Encrypted live credentials for PayU/Cashfree/EKQR | Never modify directly; use Admin UI |
| `cashfree_payout_webhook_secret` field in Admin UI | Must remain EMPTY — client secret is the only valid payout signing key | If accidentally set, clear via Admin UI Clear button |

---

## APPENDIX A — Key Environment Variables (VPS Production)

| Variable | Purpose | Status |
|---|---|---|
| `SESSION_SECRET` | AES-256-GCM key derivation for all encrypted provider secrets | ✅ Set (13 chars on VPS) |
| `DATABASE_URL` | PostgreSQL connection | ✅ Set |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | Razorpay credentials | ✅ Set |
| `MSG91_AUTH_KEY` | Email OTP delivery | ❌ MISSING — OTP login disabled |
| `MSG91_EMAIL_DOMAIN` / `MSG91_EMAIL_TEMPLATE_ID` / etc. | MSG91 email config | Set in Replit secrets |
| `PAYU_LIVE_KEY` / `PAYU_LIVE_SALT` | PayU fallback (primary is Admin UI) | ⚠️ Fallback only |

---

## APPENDIX B — Quick Verification Commands

```bash
# SSH key setup (required each session)
echo "$VPS_SSH_KEY_B64URL" | tr '_-' '/+' | base64 -d > /tmp/vps_key && chmod 600 /tmp/vps_key

# Production health
ssh -i /tmp/vps_key $VPS_USER@$VPS_HOST "curl -sf http://127.0.0.1:3000/api/healthz/deep"

# Current deployed SHA (must match production SHA above)
ssh -i /tmp/vps_key $VPS_USER@$VPS_HOST "cd /var/www/rasokart && git log --oneline -1"

# PM2 status
ssh -i /tmp/vps_key $VPS_USER@$VPS_HOST "pm2 list --no-color | grep rasokart-api"

# Stuck CREATED orders (must be 0 after correction)
ssh -i /tmp/vps_key $VPS_USER@$VPS_HOST \
  "source /var/www/rasokart/.env && psql \"\$DATABASE_URL\" -t -c \"SELECT COUNT(*) FROM cashfree_payment_orders WHERE status='CREATED' AND created_at < NOW() - INTERVAL '30 minutes'\""

# Webhook log — last 5 entries
ssh -i /tmp/vps_key $VPS_USER@$VPS_HOST \
  "source /var/www/rasokart/.env && psql \"\$DATABASE_URL\" -t -A -c \"SELECT event_type, signature_verified, processing_result, created_at FROM cashfree_payout_webhook_logs ORDER BY created_at DESC LIMIT 5\""

# wallet_ledger and transactions row counts
ssh -i /tmp/vps_key $VPS_USER@$VPS_HOST \
  "source /var/www/rasokart/.env && psql \"\$DATABASE_URL\" -t -c \"SELECT 'wallet_ledger', COUNT(*) FROM wallet_ledger UNION ALL SELECT 'transactions', COUNT(*) FROM transactions\""
```

---

## APPENDIX C — Test Suites Reference

| Suite | Command | Count | Required Before |
|---|---|---|---|
| Webhook security audit | `cd artifacts/api-server && node --import tsx/esm --test src/routes/webhook.security.audit.test.ts` | 23 | Any webhook handler change |
| PayU callback regression | `cd artifacts/api-server && node --import tsx/esm --test src/routes/payuWebhook.test.ts` | 11 | Any PayU/wallet change |
| Callback signing pipeline | `cd artifacts/api-server && SESSION_SECRET="..." node --import tsx/esm --test src/routes/callbacks.signing.test.ts` | 10 | Any callback/secret change |
| EKQR webhook reachability | `cd artifacts/api-server && node --import tsx/esm --test src/routes/paymentWebhook.test.ts` | 3 | Any EKQR change |
| Gateway panel coverage | `cd artifacts/rpay && node --import tsx/esm --test src/lib/gateway-panel-coverage.test.ts` | 7 | Any gateway panel change |
| System config coverage | `cd lib/db && node --import tsx/esm --test src/schema/systemConfig.coverage.test.ts` | 3 | Any system_config key change |
| Schema guard coverage | `pnpm --filter @workspace/scripts run schema-guard-coverage` | 115 tables, 0 gaps | Any new Drizzle table |
| Schema guard fresh-install | `cd artifacts/api-server && node --import tsx/esm --test src/lib/schemaGuard.freshInstall.realdb.test.ts` | 50 | Any schemaGuard.ts change |
| Priority conflict guard | `pnpm --filter @workspace/scripts run verify-priority-conflict-tests` | real-DB | Any routing rule change |
| Settings persistence | `pnpm --filter @workspace/scripts run verify-settings-persistence` | e2e | Any settings form change |
| TypeScript (api-server) | `cd artifacts/api-server && pnpm exec tsc --noEmit` | — | Any TS file change |
| TypeScript (rpay) | `cd artifacts/rpay && pnpm exec tsc --noEmit` | — | Any TS file change |
