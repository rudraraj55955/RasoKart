---
name: Pine Labs ONE live authV2 OTP page DOM (verified 2026-08-18)
description: Live-portal-verified DOM of /authV2/sign-in/verify-otp — OTP input, Verify button, and the div-based resend control with cooldown text pitfall.
---

## Verified live (no credentials, dummy mobile)

Flow: `/login/user` → `/authV2/language` interstitial → `/authV2/verify-user` (`#username` input, "Sign in securely" button) → **always** `/authV2/sign-in/verify-otp` for mobile identifiers. No password page and no "Login with OTP" link ever appears for mobile logins — the password-page OTP-link path is only reachable for user-ID-based logins (unverified live; needs a real user-ID account).

OTP page DOM (live, 2026-08-18):
- OTP input: single `<input id="otp-input" type="number" inputmode="numeric">` (no digit boxes).
- Submit: `<button>Verify</button>`.
- Resend: `<div role="button" id="...-resend-timer-resend-link">Resend OTP</div>` — NOT a button/a/span. During the ~30s cooldown the area shows "Resend OTP in NN secs" as separate spans with no clickable control.

## The rule

Portal controls with countdown/disabled states need exact-text matching (`:text-is`) or structure-anchored selectors; loose `:has-text("Resend")` selectors can false-positive on the cooldown countdown text and click a dead element, producing a dishonest "new OTP sent" message.

**Why:** Verified live 2026-08-18 — the resend control was invisible to button/anchor selectors, and countdown text contains the same words as the active control.

**How to apply:** When adding portal selectors for text-adjacent controls, probe both the cooldown phase and the active phase live before trusting a `:has-text` selector.
