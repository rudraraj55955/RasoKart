---
name: Pine Labs ONE authV2 OTP-first flow
description: Portal changed auth flow from password-first to OTP-first; adapter fix required for URL detection and requiresPassword gate.
---

## The Rule

Pine Labs ONE portal (`one.pinelabs.com`) switched from a password-first flow to an OTP-first flow via `/authV2/sign-in/verify-otp`. After a merchant enters their mobile number and clicks Next, the portal navigates to that OTP URL — not a password page. The adapter must detect this URL before trying DOM selectors.

Additionally, `requiresPassword` in `supportedLoginMethods` must be `false` — if set to `true`, the initiate route rejects all frontend calls (the merchant connect UI sends no password at initiate time), producing the "Could not connect" fallback message without ever reaching the adapter.

## Why

Diagnosed 2026-08-18 from a live production API test. The `/api/merchant/portal-sessions/pinelabs_one/initiate` endpoint returned `PORTAL_UI_CHANGED` with `path=/authV2/sign-in/verify-otp` — the adapter's selector-based OTP detection (`digitBoxes >= 4`, `SEL.OTP_INPUT_SINGLE`) did not match the authV2 OTP page's DOM.

The two-layer failure:
1. Route rejected no-password initiate → frontend never saw adapter response
2. Even with a password passed, adapter fell through to `PORTAL_UI_CHANGED` because OTP selectors didn't match

## How to Apply

- `requiresPassword: false` in `supportedLoginMethods` — do not change back to `true`
- `isOtpUrl(url)` helper checks `OTP_URL_PATTERNS` (`/verify-otp`, `/authv2/sign-in/otp`, etc.)
- Call `isOtpUrl(page.url())` immediately after `clickSubmit()` — before any DOM selector scan
- `navigateToLogin()` checks `isOtpUrl(url)` after SPA render wait → returns `"otp_form"`
- `reconnect()` returns `FAILED` (not `AWAITING_PASSWORD`) for expired sessions — re-auth requires a new OTP, not a password
- Mock server `otpFirst: true` option simulates the new production flow for e2e tests

## Auth flow (as of Aug 2026)

```
identifier entry → POST /login/user → 302 /authV2/sign-in/verify-otp
OTP entry → POST /authV2/sign-in/verify-otp → 302 /home (CONNECTED)
```

Password step may still appear for user-ID-based logins — adapter handles both paths.
