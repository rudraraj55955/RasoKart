---
name: Paytm digit-box vs OTP disambiguation
description: OTP_INPUT_DIGITS selectors (input[maxlength="1"]) also match Paytm's 10-box phone-number entry — count must be checked first.
---

## The rule
In `navigateToLoginPage()`, count `input[maxlength="1"]` boxes BEFORE testing OTP_INPUT_DIGITS selectors:
- **≥ 10 boxes** → `"mobile_form_digits"` (phone number, 10 Indian digits)
- **4–8 boxes** → `"otp_form"`

If you test OTP selectors first you get false `"otp_form"` for a phone-entry page, then `initiateSession()` calls `tryLocator(MOBILE_INPUT)` which finds nothing → `LOGIN_UI_CHANGED` error.

**Why:** The real Paytm Business portal uses 10 individual `input[type="text"][maxlength="1"]` boxes for phone entry in some UI versions. These are selector-identical to 6-box OTP inputs; only the count disambiguates.

**How to apply:**
- `countDigitBoxes(page)` helper in `paytm.ts` counts all `maxlength="1"` inputs.
- `navigateToLoginPage()` checks this count before any OTP selector tests.
- `fillMobileInPage(page, mobile)` handles both single-field and digit-box layouts.
- Mock server flag `mobileAsDigitBoxes: true` serves the 10-box variant for e2e tests.
- Test: "digit-box entry is not misclassified as OTP form" explicitly guards this.
