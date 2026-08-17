---
name: Paytm Business portal migration (Aug 2026)
description: Login moved to dashboard.paytm.com with cross-origin OAuth iframe; old URLs return HTTP 200 with 404 content; password-only login; frontend state machine must handle AWAITING_PASSWORD
---

## Root causes of PORTAL_UNREACHABLE (confirmed via live Playwright probe, Aug 2026)

1. **URL migration**: `business.paytm.com/user/login` and `business.paytm.com/login` return HTTP 200 but render "Uh-oh! Page Not Found" content — the adapter iterated all URL candidates and failed all of them.

2. **New login URL**: `https://dashboard.paytm.com/login/?referrer=Business` (or `dashboard.paytm.com/login/`). The main frame has **zero inputs**. The actual login form is inside a cross-origin `accounts.paytm.com` OAuth SDK iframe.

3. **Login method changed**: Portal now shows `input[name="mobile"]` + `input[name="password"]` + "Sign in Securely" button. No OTP link visible in default form state. The portal migrated to password-based login.

## Adapter changes made (commits 67d6640b, ad112970)

- `PORTAL_DASHBOARD_BASE` constant (`dashboard.paytm.com`)
- `getPortalDashboardBase()` — all post-auth navigation uses this, not `getPortalRoot()`
- `getLoginUrlCandidates()` — dashboard.paytm.com URLs first, old URLs as fallbacks (skipped via `isActual404Page()`)
- `isDashboardUrl()` — accepts both `dashboard.paytm.com` and `business.paytm.com`
- New helpers: `isActual404Page()`, `waitForAccountsFrame()` (polls for accounts.paytm.com iframe, up to 12 s), `tryFrameLocator()`
- New `LoginPageState`: added `"mobile_form_iframe"` for cross-origin iframe case
- `navigateToLoginPage()`: checks `isActual404Page` first, then waits for accounts.paytm.com iframe before checking main-page selectors
- `fillMobileInPage()` + `fillOtp()`: check accounts.paytm.com iframe first
- `initiateSession()`: handles `mobile_form_iframe` — tries OTP link first, falls back to password mode (`loginMode: "password"`, `storedMobile` stored encrypted in session token)
- `submitStep()`: `isPasswordMode` flag; password mode fills mobile + password in accounts iframe; `getPortalRoot()` replaced with `getPortalDashboardBase()` everywhere
- Returns `AWAITING_PASSWORD` status (not `AWAITING_OTP`) for password mode

## Frontend changes made (commit 4df46d7b)

**Critical**: The frontend `PaytmPortalCard` was the root cause of PORTAL_UNREACHABLE showing on the card and button stuck as "Sending OTP…". The adapter was correct; the frontend had no password state machine.

Changes in `artifacts/rpay/src/pages/merchant/connect.tsx`:
- `PaytmUiStep`: added `"password"` step
- `deriveStep()`: maps `AWAITING_PASSWORD` → `"password"` (was falling through to `"mobile"` = error)
- `handleInitiate()`: handles `AWAITING_PASSWORD` → transitions to password step (previously fell into else/error branch)
- Added `handleSubmitPassword()`: sends `{ otp: pw }` (same field API accepts), wipes state immediately, handles CONNECTED / AWAITING_OTP / error outcomes
- `handleReconnect()`: handles `AWAITING_PASSWORD` → `"password"` step
- Mobile input: `type="text"`, no digit-strip, accepts mobile OR email (validates `^\d{10}$` OR email regex)
- Button text: "Connecting…" during initiation (not "Sending OTP…")
- Added `AbortSignal.timeout(90_000)` to `initiatePortalSession` (button stuck fix)
- Added password step JSX: sky banner, `type="password"` field, security note, Connect/Start Over buttons
- Updated `PROVIDER_DESC`, security note, description copy, link to `dashboard.paytm.com`
- `"password"` badge renders when `uiStep === "password"`
- `"Sending OTP"` string: 0 occurrences in bundle ✅

## Key selectors in accounts.paytm.com iframe

- Mobile: `input[name="mobile"]` or `input[placeholder*="mobile" i]`
- Password: `input[name="password"]` or `input[type="password"]`
- Submit: `button:has-text("Sign in Securely")` (disabled until both fields filled)
- OTP link: None found in default state (check `SEL.OTP_LOGIN_LINK` array)

## Cross-origin iframe access pattern

```typescript
// Use Playwright CDP — no same-origin restriction
const accFrame = await waitForAccountsFrame(page, 10_000);
if (accFrame) {
  const loc = await tryFrameLocator(accFrame, SEL.MOBILE_INPUT);
  ...
}
```
The iframe does NOT appear immediately — must poll for up to 10-12 seconds.

## Stale portal session cleanup (VPS SQL)

```sql
UPDATE portal_sessions
SET status = 'DISCONNECTED',
    fail_reason = NULL,
    fail_detail = NULL,
    encrypted_session = NULL,
    updated_at = now()
WHERE provider_slug = 'paytm_merchant'
  AND status IN ('FAILED', 'ERRORED', 'AWAITING_OTP', 'AWAITING_PASSWORD', 'PORTAL_UNREACHABLE');
```

## Deploy path (complete)

1. Adapter fix: commit `ad112970` — on VPS and origin/main
2. Frontend fix: commit `4df46d7b` — on VPS and origin/main; frontend rebuilt on VPS ✅
3. VPS healthz commit: `4df46d7ba0676ca0a40274ef8aefd8c4ed168b6d` ✅
4. Stale session reset: UPDATE 0 (no stale sessions existed) ✅

**Why frontend fix was needed:** Adapter correctly returns `AWAITING_PASSWORD` but the card's `deriveStep()` had no case for it — fell to `"mobile"` state and the else branch in `handleInitiate()` displayed an error instead of the password field. The button text "Sending OTP…" was hardcoded for OTP mode even though the adapter never sent an OTP.
