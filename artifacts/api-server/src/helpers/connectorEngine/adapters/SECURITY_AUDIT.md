# Paytm Business Adapter — Security Audit

**Date**: 2026-08-17  
**Scope**: `artifacts/api-server/src/helpers/connectorEngine/adapters/paytm.ts`  
**Route**: `artifacts/api-server/src/routes/merchantPortalSessions.ts`

---

## 1. OTP Non-Persistence

**Claim**: The OTP is never stored in the database, never logged, and never included in any response.

**Evidence**:

| Step | Code path | OTP fate |
|------|-----------|----------|
| Client POST `/submit-step` | `merchantPortalSessions.ts` | Receives `encryptedOtp` (AES-256-GCM) |
| Route handler | `merchantPortalSessions.ts` | Passes `encryptedOtp` directly to `adapter.submitStep()`. The raw bytes never escape the encrypted envelope at this layer. |
| `submitStep()` entry | `paytm.ts:otpDecrypt` | `decryptSecret(params.encryptedOtp)` — decrypts to local `const otp`. |
| OTP usage | `paytm.ts:fillOtp()` | Typed into browser input via Playwright `fill()`. Never concatenated into a string that touches a logger. |
| Post-fill | `paytm.ts` | `otp` variable goes out of scope immediately after `fillOtp()` returns. |
| Logger calls | All logger.info/warn/error calls | Only `maskedMobile` is logged (e.g. `**XXXXXX890`). No OTP appears as a log key or value. |
| DB writes | `merchant_portal_sessions` | Only `status`, `stepFailureCount`, `encryptedSessionToken`, `maskedMobile`, timestamps. No OTP column. |
| Response body | `SubmitStepResult` | Only `status`, `encryptedSessionToken`, `nextStep`, `failReason`, `failDetail`. No OTP field. |

**Automated assertion**: `portal-sessions.security.test.ts → "OTP never persisted or logged"` suite.

---

## 2. CONNECTED Gate (5 Checks, All Required)

**Claim**: `CONNECTED` is returned only after all five checks pass. No check can be bypassed.

| Check | Location | What is verified |
|-------|----------|-----------------|
| (a) URL not a login page | `isLoginUrl()` | Pathname not `/user/login` or `/login` |
| (b) URL matches dashboard | `isDashboardUrl()` | URL starts with portal root AND path is `/home`, `/dashboard`, `/overview`, or root `/` |
| (c) Dashboard landmark visible | `waitForAny(SEL.DASHBOARD_LANDMARK)` | At least one `Total Transactions` / `Settlement Amount` / nav element is in the DOM |
| (d) Login form NOT visible | Loop over `SEL.LOGIN_FORM` | Mobile input and OTP input are absent from the page |
| **(e) Ownership verified** | `verifyOwnershipFromPortal()` | Profile page shows masked mobile whose last 3 digits match those provided at `initiateSession` |

Check (e) was added in Phase 2 (2026-08-17). Before this addition, a rogue authenticated dashboard without ownership evidence could reach `CONNECTED`.

**Test coverage**: `paytm.e2e.test.ts → "Ownership verification"` suite — 4 tests proving:
- Wrong account (mismatched last 3 digits) → `OWNERSHIP_MISMATCH`
- No ownership data on profile → `OWNERSHIP_UNVERIFIABLE`
- Correct account → `CONNECTED`
- Dashboard-only fixture (no profile data) → not `CONNECTED`

---

## 3. Route-Level Security Gates (4 Gates)

Gate enforcement is in `merchantPortalSessions.ts` and unit-tested in `portal-sessions.security.test.ts`.

| Gate | Condition | HTTP status on violation |
|------|-----------|--------------------------|
| **Status guard** | Session must be in `AWAITING_OTP \| AWAITING_PASSWORD \| AWAITING_MPIN` | 400 WRONG_STATUS |
| **Max attempts** | `stepFailureCount >= 3` blocks all further OTP submission | 429 MAX_ATTEMPTS_EXCEEDED |
| **OTP expiry** | `updatedAt + 10 min < now` rejects the step | 410 OTP_SESSION_EXPIRED |
| **In-flight lock** | `Set<string>` keyed by `${merchantId}:${providerSlug}` prevents parallel submits | 409 SUBMIT_IN_PROGRESS |

All four gates are checked in order before the adapter is called. The adapter never sees an expired, max-out, or parallel request.

---

## 4. Credential Storage

| Credential | Storage |
|-----------|---------|
| Merchant mobile number | Decrypted locally at `initiateSession`, filled into browser, goes out of scope. Only `maskedMobile` (`**XXXXXX890`) is persisted. |
| OTP | Never stored. See §1. |
| Browser session (cookies + localStorage) | AES-256-GCM encrypted via `encryptSessionPayload()` → stored as `encryptedSessionToken` in `merchant_portal_sessions.encryptedSessionToken`. |
| Paytm passwords | Not applicable — adapter is OTP-only (`mobile_otp` login method). |

---

## 5. Transaction Dry-Run Invariants

Every transaction row inserted by `fetchTransactions` via the sync route has:
- `dry_run = true` — never auto-applied to merchant's wallet
- `auto_credited = false` — never auto-credited to merchant balance
- `UNIQUE (merchantId, providerSlug, externalId)` — duplicate syncs are idempotent (`ON CONFLICT DO NOTHING`)

**Test coverage**: `paytm.e2e.test.ts → "fetchTransactions dry-run invariants"` suite.

---

## 6. No Credential Mutation

The adapter only reads data from the Paytm Business portal. It does not:
- Initiate payments or refunds
- Change beneficiaries
- Modify profile settings
- Transfer funds

This is documented in the adapter's JSDoc header and enforced by the read-only selectors used (`TX_ROW`, `MID`, `DASHBOARD_LANDMARK`). No form submission occurs after login except the OTP verification form.

---

## 7. CAPTCHA and Browser Evasion

- CAPTCHA detection returns `AWAITING_USER_ACTION` — no bypass is attempted.
- No anti-detection patches (no spoofed `navigator.webdriver`, no stealth plugin).
- No headless-mode detection evasion.
- Screenshots, video recording, and network tracing are disabled in the browser pool.

---

## 8. Cross-Merchant Isolation

- Sessions are stored with a `UNIQUE (merchantId, providerSlug)` constraint.
- All route handlers filter by `req.merchant.id` (enforced by `requireMerchant` middleware).
- In-flight locks are keyed by `${merchantId}:${providerSlug}` — a merchant's lock cannot block another merchant.
- Tokens are encrypted with the server's AES key — a merchant cannot forge another merchant's token.

---

## 9. Automated Test Coverage Summary

| Test file | Runner | Tests | What it covers |
|-----------|--------|-------|----------------|
| `paytm.failclosed.test.ts` | node:test | 21 | Adapter structure + pre-flight CONNECTED never returned for invalid inputs |
| `portal-sessions.security.test.ts` | node:test | 28 | Route-level gates (status, max attempts, expiry, parallel lock, OTP non-persistence) |
| `paytm.e2e.test.ts` | node:test | 30 | Full E2E: real Chromium + mock server, happy path, invalid OTP, ownership mismatch, CAPTCHA, account blocked, session validation, reconnect, logout, transactions dry-run |

**No real Paytm network calls** are made by any test. The E2E tests use `PAYTM_PORTAL_ROOT_OVERRIDE` to redirect the adapter to a local mock HTTP server.

---

## 10. Known Limitations

1. **Paytm portal structure changes**: The adapter uses CSS selectors and text-based heuristics that could break if Paytm redesigns their portal. Mitigation: `probeBrowserReady()` health check; adapter returns `AWAITING_USER_ACTION` on unexpected page structures rather than silently failing.

2. **Ownership verification heuristics**: The ownership check uses the last 3 digits of the masked mobile as a suffix match. A phone number ending in the same 3 digits but belonging to a different account would pass (very low probability, 1 in 1000 chance). Mitigation: in production, the full masked mobile is displayed to the merchant for visual confirmation.

3. **Real Paytm login (Phase 4)**: A human action is required to verify the live flow works with real credentials. The mock server tests cover all code paths but cannot substitute for an acceptance test on the real portal.
