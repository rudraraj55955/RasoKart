---
name: React controlled-input Playwright injection — signup OTP
description: React's controlled-input reconciliation defeats ALL DOM-level value injection in headless Chrome, not just OtpCodeInput. Dev-only window hook calling RHF setValue is the only reliable solution.
---

## The rule

React's controlled-input reconciliation resets `el.value` back to the controlled value before or synchronously after any DOM-level injection in headless Chromium. This affects **any** `value={field.value}` input, not only the former OtpCodeInput 6-box design:

- `fill()` — value stays `""`
- `keyboard.type()` / `pressSequentially()` — value stays `""`
- Native `HTMLInputElement.prototype` setter + `input` event dispatch — value stays `""`
- `ClipboardEvent("paste", ...)` dispatch — value stays `""`

The `e.target.value` inside React's synthetic `onChange` / `onPaste` handler is always `""` in headless Chrome because React has already reconciled the DOM value back before the handler reads it.

**Why:** React 19's controlled-input tracking sets `el.value = field.value` (here `""`) on every reconciliation cycle. With `autoFocus` + a running `setInterval` (the 60-second resend countdown), reconciliation ticks continuously, defeating all DOM-level writes.

**Confirmed NOT affected:** Standard `<Input {...field} />` with native event forwarding, tested on text inputs elsewhere in the suite that use `field.onChange(e)` — those use the event's native value path before React reconciles.

## The fix

Expose a dev-only `window.__e2e_signup_setOtp` hook in the component that calls `otpForm.setValue("otp", value, { shouldValidate: true, shouldDirty: true })` directly. This goes through RHF's internal state, which `otpForm.watch("otp")` subscribes to, so the button's disabled condition re-evaluates correctly.

Gate it on `import.meta.env.DEV` — Vite's dead-code elimination removes it entirely from `vite build` output.

**How to apply:**

```tsx
// In the component (register.tsx)
useEffect(() => {
  if (!import.meta.env.DEV) return;
  if (stage !== "otp") return;
  (window as any).__e2e_signup_setOtp = (value: string) =>
    otpForm.setValue("otp", value, { shouldValidate: true, shouldDirty: true });
  return () => { delete (window as any).__e2e_signup_setOtp; };
}, [stage, otpForm]);

// In the Playwright test
async function setOtpValue(page: Page, digits: string): Promise<void> {
  await page.waitForFunction(
    () => typeof (window as any).__e2e_signup_setOtp === "function",
    { timeout: 5_000 },
  );
  await page.evaluate((otp: string) => (window as any).__e2e_signup_setOtp(otp), digits);
}
```

## Current signup OTP input design

The OTP stage at `/merchant/apply` uses a single native `<input autocomplete="one-time-code" inputmode="numeric" maxlength="6">` (not the former 6-box `OtpCodeInput`). The change was made for mobile browser compatibility (iOS Safari dismisses keyboard on programmatic focus between 6 separate inputs). The dev hook approach is necessary regardless of whether it is 1 box or 6.

## Selectors

Use `input[autocomplete="one-time-code"]` — more stable than `input[name="otp"]` if the field name ever changes.
