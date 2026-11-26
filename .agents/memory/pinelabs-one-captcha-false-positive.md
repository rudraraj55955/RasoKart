---
name: Pine Labs ONE CAPTCHA false-positive fix
description: hasCaptcha() fired on hidden pre-loaded CAPTCHA DOM nodes, blocking the real OTP flow entirely
---

## Rule
`hasCaptcha()` must require ALL THREE: `count() > 0` AND `isVisible()` AND bounding box `≥ 10×10 px`. Any CAPTCHA check without all three gates will false-fire on React SPAs.

**Why:** Pine Labs ONE (and most React SPAs) pre-load reCAPTCHA/hCaptcha scripts eagerly and inject hidden zero-size container divs (`display:none`, `width:0`, `height:0`) into the DOM even when no challenge is active. The original check used only `count() > 0` — no visibility or size guard — so it always returned `true`, blocking the OTP flow before it could detect the real `/authV2/sign-in/verify-otp` navigation.

**How to apply:** Any portal adapter that uses DOM-based CAPTCHA detection must use this three-gate pattern. Never use `count() > 0` alone as a CAPTCHA presence signal.

## Symptom pattern
- Merchant enters identifier → adapter returns `CAPTCHA_REQUIRED`  
- No CAPTCHA is visible in the merchant UI
- Live portal shows no challenge  
- The real page has navigated to OTP or password step

## Related
- OTP DOM fallback must run BEFORE captcha check in initiateSession  
- Log URL path (not credentials) after identifier submit to discover new OTP URL slugs  
- Regression test: `hiddenCaptcha: true` mock server option + E2E test verifying `AWAITING_PASSWORD` not `CAPTCHA_REQUIRED`
