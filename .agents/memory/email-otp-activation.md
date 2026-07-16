---
name: Email OTP activation status
description: Current state of MSG91 email OTP system — what's deployed vs what still needs VPS manual steps
---

# Email OTP Activation Status

**Why:** OTP code is fully deployed (10-min expiry, MSG91 provider) but email delivery requires a VPS secret and DB flag that cannot be set via CI/CD.

## What is deployed (in production code)
- OTP expiry: 10 minutes (was 5) — enforced in runtime, MSG91 API hint, SMTP template
- MSG91 provider: `sendMsg91EmailOtp.ts` reads `MSG91_AUTH_KEY` env var
- SMTP fallback: still available if MSG91 key absent (won't send but won't crash)
- db-migrate Section 16: updates `otp_expiry_seconds` 300→600 on existing rows

## What still needs manual VPS steps
1. **Add to /var/www/rasokart/.env**: `MSG91_AUTH_KEY=<key>`
2. **Restart PM2**: `pm2 restart rasokart-api --update-env`
3. **Test inbox delivery** before enabling login flag
4. **Enable in DB** (only after inbox confirmed):
   ```sql
   INSERT INTO otp_sms_settings (id, otp_login_enabled, otp_expiry_seconds)
     VALUES (1, true, 600)
     ON CONFLICT (id) DO UPDATE SET otp_login_enabled = true, otp_expiry_seconds = 600;
   ```

## How to apply
- MSG91_AUTH_KEY: only from user — never log/commit
- `otpLoginEnabled` DB flag must be `false` until actual inbox delivery is confirmed
- OTP routes work without the flag (forgot password, signup verify) — only login gate checks it
