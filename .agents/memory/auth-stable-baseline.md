---
name: Auth Stable Baseline
description: Protected authentication system rules — what must not be touched and what regression checks must pass before any production deploy touching auth.
---

# RasoKart Auth Stable Baseline

## What is protected

The following modules are COMPLETE, VERIFIED, and must not be refactored, redesigned, or unnecessarily modified:

- Merchant login (password)
- Merchant signup / registration
- OTP login flow
- Forgot-password / reset-code flow
- 6-box OTP UI (`artifacts/rpay/src/components/ui/otp-code-input.tsx`)
- OTP paste / autofill (Android WebOTP, iOS Safari one-time-code)
- Mobile focus / keyboard navigation (ArrowLeft/Right, Backspace)
- OTP generation, validation, and expiry
- Rate limiting on OTP verify and send
- JWT / session security
- RBAC enforcement
- Merchant isolation

**Why:** Fully verified end-to-end (34/34 automated tests + live production smoke test).  
**Deployed SHA at time of lock:** `40807c21d7f91344246048173bbd89ee71506ef4`

## Rules

1. Treat the auth system as a production baseline. Do not modify while working on payment, billing, wallet, payout, reporting, or UI features.
2. Do NOT change OTP generation/validation, JWT/session, RBAC, login, signup, forgot-password, rate limiting, or merchant isolation unless explicitly instructed.
3. Any change touching auth files must run the regression checklist before deployment (see below).
4. If another feature causes an auth regression, fix/revert that feature — never weaken auth.
5. Never expose OTPs, passwords, JWTs, API secrets, or session tokens in frontend responses or production logs.

## Regression checklist (run before any auth-touching deploy)

```
[1]  /api/healthz → {"status":"ok"}
[2]  Password login → 200 + JWT
[3]  Auth/me correct identity → role=merchant/admin
[4]  Wrong password → 401
[5]  OTP request (login) → 200 safe message
[6]  Wrong OTP → 400 safe error
[7]  Signup OTP request → 200
[8]  Forgot password → 200 safe message
[9]  No auth → 401 on protected endpoints
[10] Merchant JWT → admin endpoints → 403 (RBAC)
[11] Cross-merchant access → 403 (isolation)
[12] Malformed/tampered JWT → 401
[13] /api/dev/otp → 404 in production (dev guard)
[14] Logout → 200
[15] Rate limiting 429 fires at threshold
```

## Key auth file paths

- `artifacts/api-server/src/routes/auth.ts` — all auth routes
- `artifacts/rpay/src/components/ui/otp-code-input.tsx` — 6-box UI
- `artifacts/rpay/src/pages/merchant/login.tsx` — login page (Password/OTP/Forgot tabs)
- `artifacts/api-server/src/lib/devOtpStore.ts` — dev-only OTP capture (no-op in prod)
- `artifacts/api-server/src/routes/devHelper.ts` — dev-only routes (not mounted in prod)

## Correct auth endpoint paths (reference)

- `POST /api/auth/login` — password login (merchant + admin)
- `POST /api/auth/merchant/otp/request` — send OTP (LOGIN / SIGNUP_VERIFY)
- `POST /api/auth/merchant/otp/verify` — verify OTP
- `POST /api/auth/merchant/password/forgot` — send reset OTP (field: `identifier`)
- `POST /api/auth/merchant/password/reset` — reset with OTP (fields: `identifier`, `otp`, `newPassword`)
- `POST /api/auth/logout` — logout
- `GET  /api/auth/me` — current user identity
