---
name: Pine Labs ONE portal-OTP and resend pattern
description: Key invariants for credential-free submitStep branches — where to insert them, how failures must preserve sessions, and why Back-to-Password is wrong.
---

# Pine Labs ONE portal-OTP and resend — durable invariants

## Insertion point
Credential-free branches (`portal_otp`, `resend_otp`) must run BEFORE the `encryptedOtp` credential check in `submitStep`. They open their own isolated context; the caller's context does not exist at that point.

**Why:** The frontend sends no credential for these actions. Hitting the credential guard first returns a misleading `MISSING_CREDENTIAL`.

## Session-preservation contract (critical)
`portal_otp` failures (OTP link absent, click failed, no OTP page after click) must return `status: "AWAITING_PASSWORD"` with the **original** `params.encryptedSessionToken` unchanged, not `FAILED`. The `FAILED` status writes a dead session to the DB — the merchant cannot continue with their password after a dead session.

`resend_otp` failures (button not found, click failed) must similarly return `status: "AWAITING_OTP"` with the original token, not `FAILED`. The existing OTP is still valid.

**Why:** The route persists every `FAILED` result as terminal — the session is gone and the merchant must re-initiate from scratch. A failure to find an OTP link or resend button is not a fatal error; the underlying session (password or OTP) is still alive and usable.

## "Back to Password" is impossible after a portal_otp switch
After `portal_otp` succeeds the server session is `AWAITING_OTP` with OTP-session cookies in the portal browser context. There is no adapter call that can swap those cookies back to a password session. "Back to Password" as a UI-only step-change silently leads the merchant to a failing password submission. Remove it; use "Start Over" (re-initiate from identifier) instead.

**Why:** The portal's `otp_session` cookie replaces `user_session` when the OTP link is clicked. The only path back to password state is a new browser session from the identifier step.

## Honest resend messaging
Only say "A new OTP has been sent" after a confirmed resend-button click (no exception). Return `failReason: "RESEND_NOT_AVAILABLE"` or `"RESEND_CLICK_FAILED"` with the OTP session preserved when the button is absent or click throws.

## OTP-first password-step detection
Pine Labs ONE is OTP-first for many real accounts: after the identifier is submitted at `/authV2/verify-user` the portal dispatches an OTP (stays on or redirects to an OTP page) and never shows a password field. The password branch must probe for OTP indicators at every navigation checkpoint (before/after each `goto`) and return `AWAITING_OTP` with fresh storageState. Without this, the adapter falls through to PASSWORD_FIELD_NOT_FOUND.

**Why:** Live merchant screenshot (Aug 2026) showed `path=/authV2/verify-user, inputs=1` — the `altPwdUrl` goto bounced back to the identifier page because the portal never generates a password page for this account type.

## HTTP response field names
The route serializes adapter results as `errorCode` (not `failReason`) and `message` (not `failDetail`). Frontend handlers must check `body.errorCode` and `body.message`, not the adapter's internal field names.

## SubmitStepResult.helpUrl
Add `helpUrl?: string` to `SubmitStepResult` in types.ts (it was already on `InitiateResult`).
