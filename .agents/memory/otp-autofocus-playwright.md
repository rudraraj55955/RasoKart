---
name: OtpCodeInput autoFocus blocks Playwright fill
description: OtpCodeInput with autoFocus + custom RHF onChange(string) rejects both fill() and pressSequentially() in headless Chrome; hybrid test pattern as workaround.
---

## The rule

When an `OtpCodeInput` has `autoFocus` AND its `onChange` calls `field.onChange(string)` (not the native event), Playwright's `fill()` and `pressSequentially()` both fail to update the RHF state in headless Chromium. The DOM value stays `""` even after all key events fire, because React 19's controlled-input reconciliation resets the value back to `field.value = ""` faster than the events can commit.

**Why:** React 19 tracks controlled input values more aggressively. When `autoFocus` focuses the element on mount and a `startCooldown` interval is triggering re-renders (every 1 s), React's reconciliation sets the DOM value back to `field.value` (which is `""`) continuously. The custom `onChange(string)` path in `handleChange` doesn't trigger RHF state update fast enough between each key event and the next reconciliation tick.

Standard `<Input {...field} />` (passing the native event to `field.onChange`) is NOT affected — only the custom string-based onChange path.

**How to apply:**

For any E2E test that needs to exercise a form containing this component:

1. Use the **UI** to verify the stage transition (that the OTP input appears after requesting a code).
2. Call the **reset/verify API directly** (via `apiPost`) with a seeded OTP — same approach as the resend-invalidation test.
3. Use the **UI** to verify the downstream effect (e.g. sign in with the new password, confirm dashboard redirect).

The hybrid pattern is in `scripts/e2e/otp-auth.spec.ts` test 5 ("forgot password: UI tab transition verified; API reset works; sign in with new password → dashboard").

**Note on selectors:** `getByLabel("Password")` hits a strict-mode violation on the login page because Radix tab panels are also labelled by the tab name. Use `locator('input[name="password"]')` and `locator('input[name="email"]')` instead.
