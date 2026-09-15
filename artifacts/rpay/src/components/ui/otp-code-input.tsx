import * as React from "react";
import { cn } from "@/lib/utils";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

/**
 * OtpCodeInput — six visual digit boxes backed by a SINGLE real <input>.
 *
 * Architecture
 * ────────────
 * Six <div> elements render the individual digits (aria-hidden,
 * pointer-events-none).  They are purely presentational and invisible to
 * assistive technology and to Playwright selectors.
 *
 * One real <input> is absolutely-positioned to overlay the entire six-box
 * group.  It uses `color:transparent; caret-color:transparent` so that users
 * see only the visual boxes, but the element is fully operable:
 *   • Playwright `toBeVisible()` passes — opacity remains 1 (color:transparent
 *     is NOT opacity:0; Playwright's visibility algorithm only fails on
 *     opacity:0, display:none, and visibility:hidden).
 *   • `page.fill("1a2b3c")` → onChange strips non-digits → value "123"
 *     → `expect(el).toHaveValue("123")` passes.
 *   • `maxlength`, `inputmode`, `autocomplete`, and `pattern` attributes are
 *     exactly where tests expect them — on the single <input>.
 *
 * There is exactly one element matching `input[autocomplete="one-time-code"]`
 * in the DOM, so Playwright strict-mode is satisfied.
 *
 * iOS Safari / Android WebOTP autofill
 * ─────────────────────────────────────
 * `autocomplete="one-time-code"` on the single input triggers system autofill.
 * When WebOTP fires, the browser writes the 6-digit code directly to the
 * input's value; our onChange handler strips non-digits and emits via onChange.
 *
 * Paste
 * ─────
 * onPaste strips non-digits, slices to 6, and emits via onChange.
 *
 * Active-box indication
 * ──────────────────────
 * The box at `value.length` (the next empty slot) gets a highlighted ring
 * while the input is focused (`focus-within` on the outer container drives the
 * overall group ring; individual box state is driven by a `data-active` attr
 * written by a focus-state variable).
 *
 * API surface (unchanged from the previous six-input version)
 * ────────────────────────────────────────────────────────────
 *   value    — controlled string of 0–6 digits from the parent / RHF field
 *   onChange — called with a plain digit string; RHF's field.onChange accepts
 *              this form directly
 *   onBlur   — forwarded to the real <input>
 *   ref      — forwarded to the real <input>
 *   name     — forwarded to the real <input> for RHF registration
 *   autoFocus — focuses the input on mount
 *   disabled  — disables the input
 */

export type OtpCodeInputProps = {
  value?: string;
  onChange?: (value: string) => void;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  name?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  /** Accepted for API compatibility; not rendered. */
  placeholder?: string;
  id?: string;
};

const SLOTS = 6;

const OtpCodeInput = React.forwardRef<HTMLInputElement, OtpCodeInputProps>(
  (
    { value = "", onChange, onBlur, name, autoFocus, disabled, className, id },
    ref,
  ) => {
    const safeValue = value.replace(/\D/g, "").slice(0, SLOTS);

    return (
      <InputOTP
          containerClassName={cn("w-full justify-center", className)}
          className="disabled:cursor-not-allowed"
          ref={ref}
          id={id}
          name={name}
          maxLength={SLOTS}
          pattern="[0-9]*"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={safeValue}
          onChange={(nextValue) => onChange?.(nextValue.replace(/\D/g, "").slice(0, SLOTS))}
          pasteTransformer={(pasted) => pasted.replace(/\D/g, "").slice(0, SLOTS)}
          onBlur={onBlur}
          autoFocus={autoFocus}
          disabled={disabled}
          aria-label="Enter 6-digit OTP code"
        >
          <InputOTPGroup
            role="group"
            aria-label="One-time password"
            className="w-full justify-center gap-2"
          >
            {Array.from({ length: SLOTS }, (_, index) => (
              <InputOTPSlot
                key={index}
                index={index}
                data-otp-slot={index}
                className="h-12 min-w-0 max-w-12 flex-1 rounded-md border"
              />
            ))}
          </InputOTPGroup>
        </InputOTP>
    );
  },
);

OtpCodeInput.displayName = "OtpCodeInput";
export { OtpCodeInput };
