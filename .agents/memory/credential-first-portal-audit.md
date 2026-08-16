---
name: Credential-first portal login audit
description: Results of auditing Indian payment gateway portals for server-side credential-first login (email/mobile+password+OTP, no API keys). Covers Razorpay, Cashfree, PayU, Paytm, PhonePe.
---

## Finding (August 2026)

No Indian payment gateway portal exposes a publicly accessible REST login API that accepts email/mobile + password + OTP server-side without browser automation.

| Provider | Probed paths | Result | Notes |
|---|---|---|---|
| Razorpay | `/v1/users/login`, `/v1/auth/login`, `auth.razorpay.com/v1/tokens` | HTTP 404 | No public server-side login endpoint at any probed path, even with browser-style headers |
| Cashfree | `merchant.cashfree.com/merchant/sign-in` | HTTP 403 | WAF blocks non-browser (server-side) requests |
| PayU | `dashboard.payu.in/api/v1/auth/login` | HTTP 000 | Connection refused — no server on that path |
| Paytm | `dashboard.paytm.com/api/v1/merchant/login` | HTTP 403 | WAF blocking |
| PhonePe Business | `/api/auth/login`, `/api/v1/auth/otp/send` | HTTP 405 / 404 | Method not allowed or path not found |

## Conclusion

Credential-first portal connectors (mobile/email + password + OTP) require **browser automation (Playwright/Puppeteer)** because all probed portals are browser-only web applications protected by WAFs.

**Why:** Provider portals use React SPAs with CSRF tokens, session cookies, and WAF rules that reject non-browser user-agents and direct server-side POST requests. No documented public REST login API exists for any of them.

**How to apply:** When implementing the first real credential-first portal adapter:
- Must add Playwright as a dependency of api-server (or a separate browser-worker service)
- Chromium IS installed at `/home/runner/workspace/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`
- Playwright package is NOT currently installed in api-server — must add before implementing
- Architecture: use Playwright only for the login/OTP step; extract cookies; use plain fetch() for subsequent transaction API calls (avoid keeping browser alive per session)
- The encrypted session blob stores extracted cookies, not credentials

## What NOT to do
- Do NOT probe Cashfree/Razorpay/PayU REST APIs as "credential-first" — clientId/clientSecret and API Key/Secret are api_key_connector paths, not portal_session_connector paths
- Do NOT label an API-key adapter as satisfying the portal-session requirement
