---
name: Auto-KYC restricted to Secure ID PAN + DigiLocker Aadhaar
description: RasoKart merchant auto-KYC intentionally uses only 2 Cashfree APIs; final approval requires 4 signals, not just PAN+Aadhaar.
---

Merchant auto-KYC in RasoKart is scoped to exactly two Cashfree APIs by explicit product decision:
- Secure ID PAN (`/verification/v1/secure-id/pan`)
- Secure ID DigiLocker Aadhaar (session create → token exchange → user profile fetch)

**Why:** Aadhaar Masking, PAN 360, and PAN Lite are explicitly excluded — do not reintroduce them even as a "simpler" fallback without re-confirming with the user, since this was a deliberate product/compliance choice.

**How to apply:** Final auto-approval requires ALL of: panVerified, aadhaarVerified (via DigiLocker only), nameMatchScore >= configured threshold, mobileVerified, emailVerified. Mobile/email verification reuses `merchantAuthOtpsTable` with new purpose values (`KYC_MOBILE`/`KYC_EMAIL`) rather than the login/reset OTP purposes. Approval evaluation is centralized in a single `evaluateFinalApproval()` in `routes/merchantKyc.ts` called after every individual step completes (order-independent), not hardcoded into one specific route handler.
