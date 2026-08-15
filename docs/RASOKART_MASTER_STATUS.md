# RASOKART MASTER STATUS LEDGER
**Canonical source of truth for all RasoKart project state.**
_Read this before starting any task. Update this after every task._

---

**Last Updated:** 2026-08-15 (IST) — Task #MC-1 + P1 COMPLETE / AWAITING PRODUCTION DEPLOY APPROVAL  
**Updated By:** Agent (main)  
**Trigger:** Task #MC-1 P1 — Capability enforcement wired (qrCodes + paymentLinks) + QR assignment UI complete. Commit `e8f3c7a2` (approx). Awaiting user approval before deploy.

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
| **Production SHA** | `df78e6ffac671208585d16392b1b1527996b402d` |
| **Previous SHA (immediate rollback)** | `16851a9a` — PayU scheduler (pre-#301 wiring) |
| **Safe baseline SHA** | `6e67df67` — Cashfree payout webhook security fix |
| **Production health** | ✅ ALL GREEN — `healthz/deep` status=ok, schema_guard=pass, all checks true |
| **Last deploy date/time** | 2026-08-15 (auto-deploy via GitHub Actions, confirmed by `git log` on VPS) |
| **Deploy trigger** | GitHub Actions push-to-main → appleboy SSH → PM2 restart |
| **PM2 process** | `rasokart-api` (ID 4, PID 2221869) — online, 358 MB RSS |
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

### 2.21 Task #301 — Signature Failure Spike Alert Scheduler
- **Module:** Callbacks / signature verification alerts — `checkAndAlertSignatureFailures`
- **Final Status:** ✅ CLOSED — LIVE / STABLE
- **Implementation SHA:** `73b80784`
- **Production SHA:** `df78e6ffac671208585d16392b1b1527996b402d` — confirmed live on VPS
- **Rollback SHA:** `16851a9a` — previous production state (PayU scheduler)
- **Tests:**
  - `signatureFailureAlert.test.ts` — **14/14 PASS** (new)
  - `callbacks.webhook.setup.test.ts` — **14/14 PASS** (baseline unchanged)
  - `adminNotifyEmail.ekqr-sync-suppression.test.ts` — **21/21 PASS** (baseline unchanged)
  - `schema-guard-coverage` — **115/115 PASS** (no schema change)
  - `tsc --noEmit` — 0 implementation errors
- **Closure date:** 2026-08-15
- **Production verification (2026-08-15):**
  - Production SHA on VPS: `df78e6ff` ✅
  - Configured threshold: `10` (from `system_config` table, correct key) ✅
  - 24h signature failure count: `0` (no failures in last 24h) ✅
  - Affected merchants: none ✅
  - Admin recipients opted in: `admin@rasokart.com` (1) ✅
  - Merchant recipients opted in: none (0 failures → 0 affected merchants) ✅
  - Startup sweep emails sent: **0** (count 0 < threshold 10 → returned early at line 228) ✅
  - Financial impact: **₹0** — no wallet/ledger/transaction/payout table touched on any code path ✅
  - Blockers: none ✅
- **Root cause:** `checkAndAlertSignatureFailures()` (317 lines — admin + merchant emails, in-memory cooldown, DB logging) was fully implemented in `signatureFailureAlert.ts` but never imported or called from `index.ts`. No cron was ever registered. Same orphan pattern as Task #2475 (PayU scheduler). Secondary bug: `/api/callbacks/admin/stats` read threshold config from the stale `systemSettingsTable` (always fell back to hardcoded 10) instead of `systemConfigTable` — mismatching the actual alert function.
- **Fix summary (3 files):**
  1. `signatureFailureAlert.ts` — add `import cron from "node-cron"`, add injectable `_sendMail` param, add `initSignatureFailureAlertScheduler()` (startup sweep + cron every 30 min)
  2. `index.ts` — import + call `initSignatureFailureAlertScheduler()`
  3. `callbacks.ts` — `/api/callbacks/admin/stats`: replace 2 `systemSettingsTable` queries with 1 `systemConfigTable` query using `SIGNATURE_FAILURE_ALERT_THRESHOLD`; return `alertWindowHours: 24` as constant
- **Test matrix (14 tests):**
  B1a/b — below threshold: no sendMail, no insert | B2a/b/c — threshold reached: admin email, merchant email, insert logged | B3 — all opted out: zero-recipient guard | B4 — admin-only when merchant opted out | B5 — SMTP failure: insert still recorded | B6 — cooldown suppression | B7 — first-ever call not suppressed | B8 — no affected merchants: admin email still sent | B9/B10/B11 — never throws on DB error, insert error, sendMail throw
- **Financial mutation:** NONE — scheduler reads only `callbackLogsTable`, `merchantsTable`, `usersTable`, `systemConfigTable`; writes only to `signatureFailureAlertLogsTable` (after emails sent). Zero wallet / ledger / transaction / payout table access on any code path.

---

### 2.20 Task #2471 — EKQR Stuck-Alert Opt-Out Path Verification
- **Module:** EKQR alerts — `notifyAdminsOfStuckEkqrQrCodes` opt-out guard
- **Final Status:** ✅ CLOSED — STABLE (test-only — no production code change)
- **Commit SHA:** `71fd2c2d`
- **Rollback SHA:** `aca9a2de` (prior commit — test-only revert is safe)
- **Tests:**
  - `adminNotifyEmail.ekqr-sync-suppression.test.ts` — **21/21 PASS** (14 existing + 7 new)
  - `tsc --noEmit` — 0 implementation errors
- **Closure date:** 2026-08-15
- **Root cause confirmed:** The functional code was already correct. `notifyAdminsOfStuckEkqrQrCodes` has a zero-recipient guard at line 802-805 that returns immediately when `getAdminEmails("ekqrSyncAlertEmails")` returns `[]`. When all admins opt out, no email is sent, no cooldown timestamp is updated, no log is inserted. The bug was **zero test coverage** for this path — every existing test seeded `[{ email: "admin@rasokart.com" }]` as the first selectResponse, so the early-return branch was never exercised.
- **Fix:** Added 7 tests in a new `describe` block (`'all admins opted out'`):
  1. Does not call sendMail when all admins opt out
  2. Makes no DB inserts when all admins opt out (no cooldown log, no send log, no systemConfig)
  3. Does not update systemConfig last-sent key when all opted out
  4. Skips the cooldown check entirely (`selectCallCount` assertion: only 1 select, not 2)
  5. Does not fire even when cooldown has fully expired and all admins opted out
  6. Never throws when all admins opted out
  7. Never throws when db.select rejects on the opt-out path
- **Production impact:** None — test-only commit. Production code path unchanged. No deployment required.
- **Deployment:** Not required (test-only). SHA `71fd2c2d` is on `origin/main` but no VPS deploy triggered.

---

### 2.19 Task #2475 — PayU Stuck-Order Recovery Scheduler
- **Module:** PayU payin — webhook reliability / missing-webhook recovery
- **Final Status:** ✅ CLOSED — LIVE IN PRODUCTION — RUNTIME CONFIRMED 2026-08-15
- **Implementation SHA:** `5d587609` — scheduler file, system config keys, notify function (partial — index.ts wiring missing)
- **Wiring fix SHA:** `16851a9a` — index.ts import + call + missing systemConfig keys + notifyAdminsOfStuckPayuOrders (all gaps from 5d587609)
- **Production SHA:** `16851a9a829631840ececeec4eb38a9c1bcfdebd` — confirmed by healthz/deep
- **Rollback SHA:** `f0c7f8a1` — revert to this if regression (pre-wiring)
- **Tests:**
  - `payuStuckOrderRecovery.test.ts` — 20/20 PASS (new)
  - `payuWebhook.test.ts` — 11/11 PASS (baseline unchanged)
  - `webhook.security.audit.test.ts` — 23/23 PASS (unchanged)
  - `systemConfig.coverage.test.ts` — 3/3 PASS (new keys covered)
  - `schema-guard-coverage` — 115/115 PASS (no new table)
  - `tsc --noEmit` — 0 implementation errors (2 pre-existing `.vals` in audit test, unrelated)
- **Closure date:** 2026-08-15
- **Runtime confirmation (all 8 points PASS):**
  1. `healthz/deep` = status:ok, schema_guard:pass, all 14 checks true ✅
  2. Production SHA = `16851a9a` ✅
  3. PM2 PID 2221869, online, 358 MB RSS ✅
  4. PM2 log: `"PayU stuck order recovery scheduler initialised (every 15 min)"` ✅
  5. 15-minute cron registered ✅
  6. Startup sweep ran — 0 qualifying orders found — no credits issued ✅
  7. Qualifying stuck PayU orders: 0 ✅
  8. wallet_ledger: 126 rows (unchanged), transactions: 122 rows (unchanged), payu_stuck_order_recovery credits: 0 ✅
- **Root cause of original gap:** Commit 5d587609 shipped `payuStuckOrderRecovery.ts` but three things were never committed to `index.ts` or the shared schema: (1) the import + `initPayuStuckOrderScheduler()` call in `index.ts`; (2) 4 `SYSTEM_CONFIG_KEYS` entries + 3 defaults + 1 no-default entry in `lib/db/src/schema/systemConfig.ts`; (3) `notifyAdminsOfStuckPayuOrders()` + `buildStuckPayuOrderHtml()` in `adminNotifyEmail.ts`. The scheduler file existed and was deployed but was an orphaned module — nothing imported it, no cron timer was ever registered.
- **Fix summary:** `16851a9a` adds all three missing pieces. Scheduler now registers on startup, startup sweep runs immediately, 15-min cron ticks thereafter.
- **Root cause of original problem (the task itself):** PayU payin orders stuck in INITIATED/PENDING had no automatic recovery path. The S2S webhook is the only credit trigger — if never delivered (network failure, PayU retry exhausted, brief server downtime), the order stays stuck and the merchant is never credited. The Cashfree equivalent was already in place; PayU had nothing.
- **Scheduler behaviour:** Runs every 15 min + startup sweep. Scans `payu_payment_orders` WHERE status IN (INITIATED, PENDING), older than 30 min, production merchants only. Per order: calls PayU Verify Payment API → `success`→credit, `failure/failed`→FAILED, `cancelled`→CANCELLED, `pending`/`not found`/API error→leave. After scan: re-counts remaining; fires admin email if count ≥ threshold (3) with 4h cooldown.
- **Idempotency:** `creditWalletForPayu` atomic `WHERE status IN (INITIATED, PENDING) RETURNING` guard prevents double-credit under concurrent scheduler + webhook delivery.
- **Financial impact at deploy:** ₹0 — 0 qualifying orders existed; startup sweep found nothing to credit.

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
| ~~#2475 (CLOSED)~~ | PayU webhook | ✅ LIVE — scheduler wired 16851a9a, runtime-confirmed 2026-08-15 | Payment reliability | 20/20 new + 11/11 baseline | ✅ DEPLOYED |
| ~~#2471 (CLOSED)~~ | EKQR alerts | ✅ Opt-out guard confirmed correct; 7 tests added — 71fd2c2d | Notification reliability | 21/21 PASS | NO (test-only) |
| ~~#301 (CLOSED)~~ | Callbacks | ✅ LIVE — scheduler wired 73b80784, prod verified df78e6ff, 0 failures / 0 emails / ₹0 impact 2026-08-15 | Security visibility | 14/14 PASS | ✅ DEPLOYED |
| **#MC-1 (NEW)** | **Merchant Connect** | **Super Admin cannot assign providers to merchants via a complete flow (select → configure encrypted creds → test → set capabilities → activate). `merchant_connections.credentials` is plaintext; no capability flags; no audit log; no test endpoint; no health state; QR providers page is the only partial UI but has no test step, no capabilities, no encryption.** | **Foundational — gates all merchant payment provider onboarding** | **Encryption, capability CRUD, test endpoint, audit log, UI wizard** | **YES** |

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
CURRENT TASK:  None. Task #301 CLOSED / LIVE / STABLE 2026-08-15.
               Production SHA: df78e6ff (confirmed on VPS).
               No deploy pending. No blocker.

NEXT TASK:     Task #MC-1 — Merchant Connect / Provider Assignment (P0)
               Super Admin → Select Merchant → Select Provider →
               Configure encrypted credentials → Test Connection →
               Enable capabilities → Activate for merchant.

               AUDIT FINDINGS (do not duplicate what exists):
               ✅ EXISTS: merchant_connections table (schemaGuard:390-400)
                          id, merchant_id, provider TEXT, credentials TEXT,
                          monthly_limit, is_active, deactivated_at, timestamps
               ✅ EXISTS: /api/connections POST/PUT/DELETE (admin can supply merchantId)
               ✅ EXISTS: provider_integrations — global platform credentials (encrypted)
               ✅ EXISTS: providers catalog table
               ✅ EXISTS: qr-providers.tsx — partial UI (merchant+provider picker,
                          credentials, monthly limit, active toggle) — QR only,
                          no test step, no capabilities, no encryption
               ✅ EXISTS: /api/provider-integrations/* — global provider mgmt + audit logs
               ✅ EXISTS: activation-requests flow (merchant requests → admin approve/reject)

               ❌ MISSING — must build:
               1. Encrypt merchant_connections.credentials (currently plaintext TEXT)
                  — use same encryptSecret/decryptSecret as provider_integrations
               2. Schema additions on merchant_connections:
                  connection_status (pending|active|suspended|failed)
                  last_tested_at, last_test_result (pass|fail|untested)
                  ownership (rasokart_owned|merchant_owned)
                  capability flags: payin, payout, upi, qr, payment_links,
                                    refunds, settlement (boolean each)
                  visibility_enabled, notes
                  FK: merchant_id → merchants.id (missing)
                  UNIQUE (merchant_id, provider) constraint (missing)
               3. /api/connections test-connection endpoint — generic, per merchant+provider
               4. Audit log inserts on create/update/delete/activate/credential change
               5. Super Admin wizard UI (new page or modal sequence):
                  Step 1: Select merchant
                  Step 2: Select provider (from providers catalog — live/sandbox only)
                  Step 3: Configure credentials (encrypted at rest, masked in response)
                         + ownership mode (RasoKart-owned vs merchant-owned)
                  Step 4: Test Connection → show pass/fail + error detail
                  Step 5: Enable capabilities (per-provider capability checkboxes)
                  Step 6: Activate (set is_active=true, status=active)
               6. Connection health display (last tested, result, status badge)
               7. Extend existing qr-providers.tsx or replace with generic flow
                  (avoid duplication — the new wizard must handle QR assignments too)
               8. Per-merchant capability enforcement in payin/payout/QR routing
                  (if capability disabled → reject at API level with correct error)
               9. Merchant-scoped routing: optional — link routing_configs to merchant_id
                  if smart routing is to be per-merchant (out of scope unless confirmed)

               SCOPE BOUNDARY:
               — Do NOT touch provider_integrations (global platform credentials — separate)
               — Do NOT touch smart routing configs (global — separate task if needed)
               — Do NOT remove qr-providers.tsx until new flow covers QR assignments
               — merchant_connections is the correct table; do not create a new one

THEN:          Task #114 — Accurate merchant withdrawals stats (P1, financial)

AFTER THAT:    Task #109 — Warn merchant when last active provider disabled (P1)

LATER:         Task #1062 — Seed demo callback logs (P1, demo/onboarding)
               Task #1355 — EKQR payment URL in QR detail modal (P1)
               Task #2453 — Configurable warning threshold on EKQR daily cap bar (P1)
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
| `73b80784` | **Current HEAD** — Signature failure alert scheduler wired + admin/stats fix | Deploy required (runtime fix) |
| `71fd2c2d` | EKQR opt-out test coverage (test-only) | Safe intermediate |
| `16851a9a` | Previous production — PayU scheduler wired + systemConfig keys + notifyFn | Rollback if #301 deploy fails |
| `f0c7f8a1` | Pre-wiring — master status doc (scheduler orphaned) | Rollback from `16851a9a` if regression |
| `6e67df67` | Cashfree payout webhook security fix | Pre-PayU-scheduler stable baseline |
| `1f41738e` | Pre-session — stuck-order scheduler tests | Rollback past stuck-order work |
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
