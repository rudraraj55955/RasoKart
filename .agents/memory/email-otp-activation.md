---
name: Email OTP activation status
description: Current state of MSG91 email OTP system — fully operational as of 2026-07-25
---

# Email OTP Activation Status

## Current production state (2026-07-25)
- `otpLoginEnabled: true` — ENABLED (set by admin@rasokart.com on 2026-07-21)
- `testVerifiedAt: 2026-07-17T01:08:36.884Z` — test verified previously
- All MSG91 env vars loaded in running PM2 process (confirmed via /proc/pid/environ)
- MSG91 API returns HTTP 200 `status:success` — working end-to-end

## Env vars in /var/www/rasokart/.env and PM2
- `MSG91_AUTH_KEY` (len=25, prefix 548484…) — valid for MSG91 email API
- `MSG91_EMAIL_TEMPLATE_ID=global_otp` — accepted
- `MSG91_FROM_EMAIL=no-reply@notify.rasokart.com` — accepted
- `MSG91_FROM_NAME=RasoKart`
- `MSG91_EMAIL_DOMAIN=notify.rasokart.com`

## Root cause of historical 401 reports
MSG91_AUTH_KEY was absent from PM2 process env at the time. The server returned
`errorReason: "MSG91_AUTH_KEY not configured"` — not an actual HTTP 401 from MSG91.
After the key was added to .env and PM2 was restarted with --update-env, fully resolved.
No IP whitelist required (167.233.77.68 reaches MSG91 API successfully).

## How to apply going forward
- MSG91 email OTP is fully live — no further VPS steps needed
- `otpLoginEnabled` is `true` — login gate active for merchants
- To disable: PUT /api/admin/otp-email-settings with `{ otpLoginEnabled: false }` (super admin only)
- OTP expiry: 600 seconds (10 minutes)
