import * as React from "react";
import { cn } from "@/lib/utils";

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
    const [focused, setFocused] = React.useState(false);

    // Derive per-slot display values from the controlled string.
    const digits = Array.from({ length: SLOTS }, (_, i) => value[i] ?? "");

    // Which box should show the "active" (next-to-fill) ring.
    const activeBox = focused && !disabled
      ? Math.min(value.length, SLOTS - 1)
      : -1;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const stripped = e.target.value.replace(/\D/g, "").slice(0, SLOTS);
      onChange?.(stripped);
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pasted = e.clipboardData
        .getData("text")
        .replace(/\D/g, "")
        .slice(0, SLOTS);
      if (pasted) onChange?.(pasted);
    };

    const handleFocus = () => setFocused(true);
    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setFocused(false);
      onBlur?.(e);
    };

    return (
      <div
        role="group"
        aria-label="One-time password"
        className={cn(
          "relative flex gap-2 w-full justify-center h-12",
          className,
        )}
      >
        {/* ── 6 visual-only digit boxes ─────────────────────────────────────── */}
        {Array.from({ length: SLOTS }, (_, i) => (
          <div
            key={i}
            aria-hidden="true"
            data-active={i === activeBox ? "true" : undefined}
            className={cn(
              "flex-1 min-w-0 max-w-12 h-12",
              "rounded-md border border-input bg-transparent",
              "flex items-center justify-center",
              "text-base font-mono shadow-sm",
              "transition-colors select-none pointer-events-none",
              // Active-box ring mirrors a real focus ring
              i === activeBox && "ring-1 ring-ring border-ring",
              // Dim empty slots slightly
              !digits[i] && "text-muted-foreground",
              // Disabled appearance
              disabled && "opacity-50",
            )}
          >
            {digits[i]}
          </div>
        ))}

        {/* ── Single real <input> overlaid transparently across all 6 boxes ── */}
        {/*                                                                      */}
        {/* `color:transparent` hides the typed text visually — the boxes above  */}
        {/* display individual digits.  `caret-color:transparent` hides the      */}
        {/* cursor (the active-box ring serves as the focus indicator instead).  */}
        {/*                                                                      */}
        {/* Playwright visibility: `color:transparent` ≠ `opacity:0`.  The      */}
        {/* element has non-zero dimensions, opacity=1, display=block — so       */}
        {/* toBeVisible() passes, fill() works, and toHaveValue() works.         */}
        <input
          ref={ref}
          id={id}
          name={name}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={SLOTS}
          value={value}
          autoFocus={autoFocus}
          disabled={disabled}
          onChange={handleChange}
          onPaste={handlePaste}
          onFocus={handleFocus}
          onBlur={handleBlur}
          aria-label="Enter 6-digit OTP code"
          className={cn(
            // Overlay: span the entire container box
            "absolute inset-0 w-full h-full",
            // Transparent text + caret so the visual boxes are the display
            "[color:transparent] [caret-color:transparent]",
            // No visible background/border on this layer
            "bg-transparent border-none outline-none ring-0 focus:ring-0 focus:outline-none",
            // Spread characters evenly — letter-spacing is decorative only since text is transparent
            "font-mono tracking-[1.5rem]",
            // Input should be interactive (not pointer-events-none)
            "cursor-text",
            disabled && "cursor-not-allowed",
          )}
        />
      </div>
    );
  },
);

OtpCodeInput.displayName = "OtpCodeInput";
export { OtpCodeInput };
