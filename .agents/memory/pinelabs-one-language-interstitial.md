---
name: Pine Labs ONE language interstitial (Aug 2026)
description: Fresh Playwright contexts are redirected to /authV2/language before the identifier form; handleLanguageInterstitial() fixes it; OTP URL pattern /authv2/verify is too broad.
---

## What happened

Pine Labs ONE portal changed its login flow (observed Aug 2026):
- Fresh (cookie-less) browser sessions → redirect to `/authV2/language?redirectTo=/login/user`
- Shows language picker (10 radio buttons, "Continue" button)
- After clicking English + Continue → `/authV2/verify-user` (identifier form)
- Identifier input: `placeholder="Enter mobile number/ email ID/ user ID"`, no name/type
- Submit button: `<button type="button">Sign in securely</button>` (NOT `type="submit"`)

**Result before fix**: `navigateToLogin()` landed on the language page, found only radio buttons, returned `null` → PORTAL_UNREACHABLE.

## Fixes applied

1. **`handleLanguageInterstitial(page)`** — detects `/authV2/language` URL, clicks `text=English`, clicks Continue, waits 2500ms, logs `pinelabs_one_language_interstitial_dismissed`.
2. **Called in `navigateToLogin()`** — after initial SPA wait, before any form selector checks.
3. **Alt-URL fallback** changed from `/authV2/sign-in/user-details` → `/authV2/verify-user`.
4. **`SEL.NEXT_BTN`** extended: `'button:has-text("Sign in securely"):visible'` and `'button:has-text("Sign in"):visible'`.
5. **Removed `/authv2/verify` from `OTP_URL_PATTERNS`** — too broad: matched `/authV2/verify-user` (identifier form), causing `navigateToLogin()` to return `"otp_form"` instead of `"identifier_form"`. Replaced with `/authv2/verify-otp`, `/authv2/verify-mobile`, `/authv2/verify-email`.

## Mock server

`languageInterstitial: true` config option added:
- GET `/authV2/language` → `languagePageHtml()` (10 radio buttons + Continue)
- POST `/authV2/language` → 302 to `/authV2/verify-user`
- GET/POST `/authV2/verify-user` → identifier form with placeholder matching `SEL.IDENTIFIER_INPUT`

E2E regression tests: 2 tests, both pass (language interstitial dismissed → AWAITING_PASSWORD → CONNECTED).

## Key rule

**Why**: OTP URL patterns must be specific enough NOT to match identifier-entry pages. `/authv2/verify` matches `/authV2/verify-user` (login form). Always check new OTP URL patterns against known non-OTP pages.

**How to apply**: Before adding any pattern to `OTP_URL_PATTERNS`, verify it does NOT contain the string `/authv2/verify-user` as a substring.
