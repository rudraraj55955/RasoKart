---
name: Paytm Business portal migration (Aug 2026)
description: Login moved to dashboard.paytm.com with cross-origin OAuth iframe; old URLs return HTTP 200 with 404 content; password-only login
---

## Root causes of PORTAL_UNREACHABLE (confirmed via live Playwright probe, Aug 2026)

1. **URL migration**: `business.paytm.com/user/login` and `business.paytm.com/login` return HTTP 200 but render "Uh-oh! Page Not Found" content — the adapter iterated all URL candidates and failed all of them.

2. **New login URL**: `https://dashboard.paytm.com/login/?referrer=Business` (or `dashboard.paytm.com/login/`). The main frame has **zero inputs**. The actual login form is inside a cross-origin `accounts.paytm.com` OAuth SDK iframe.

3. **Login method changed**: Portal now shows `input[name="mobile"]` + `input[name="password"]` + "Sign in Securely" button. No OTP link visible in default form state. The portal migrated to password-based login.

## Adapter changes made (commit 67d6640b)

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

Run on the production DB to reset failed sessions so merchants see the fresh connect flow:

```sql
UPDATE portal_sessions
SET status = 'DISCONNECTED',
    fail_reason = 'PORTAL_URL_CHANGED',
    fail_detail = 'Paytm Business portal migrated to dashboard.paytm.com (Aug 2026). Please reconnect.',
    updated_at = now()
WHERE provider_slug = 'paytm_merchant'
  AND status IN ('FAILED', 'ERRORED', 'AWAITING_OTP');
```

## Deploy path

Commit `67d6640b` is on local `main` but not yet pushed to GitHub. Steps:
1. Push to GitHub (`git push origin main`) → triggers `deploy-vps.yml` GitHub Actions workflow automatically
2. After deploy: run the stale session SQL above on VPS production DB
3. Smoke test: real merchant flow → Connect → enter mobile → AWAITING_OTP/password prompt

**Why:** `isDashboardUrl()` now accepts both hostnames; ownership verification uses `getPortalDashboardBase()`; no OTP path confirmed live — password mode is the current primary flow.
