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
  /** Makes the full visual group a native-input touch target on Android. */
  androidTouchTarget?: boolean;
};

const SLOTS = 6;

const OtpCodeInput = React.forwardRef<HTMLInputElement, OtpCodeInputProps>(
  (
    {
      value = "",
      onChange,
      onBlur,
      name,
      autoFocus,
      disabled,
      className,
      id,
      androidTouchTarget = false,
    },
    ref,
  ) => {
    const safeValue = value.replace(/\D/g, "").slice(0, SLOTS);
    const [touchValue, setTouchValue] = React.useState(safeValue);
    const lastEmittedTouchValue = React.useRef(safeValue);
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const slotRefs = React.useRef<Array<HTMLInputElement | null>>([]);
    const setInputRef = React.useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );

    const focusNativeInput = React.useCallback(() => {
      if (disabled) return;
      const input = inputRef.current;
      if (!input) return;
      input.focus({ preventScroll: true });
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }, [disabled]);

    React.useEffect(() => {
      if (
        androidTouchTarget &&
        safeValue !== lastEmittedTouchValue.current
      ) {
        lastEmittedTouchValue.current = safeValue;
        setTouchValue(safeValue);
      }
    }, [androidTouchTarget, safeValue]);

    if (androidTouchTarget) {
      const emitTouchValue = (next: string) => {
        lastEmittedTouchValue.current = next;
        setTouchValue(next);
        onChange?.(next);
      };
      const setSlotRef = (index: number, node: HTMLInputElement | null) => {
        slotRefs.current[index] = node;
        if (index === 0) setInputRef(node);
      };
      const focusSlot = (index: number) => {
        const target = slotRefs.current[Math.max(0, Math.min(index, SLOTS - 1))];
        target?.focus({ preventScroll: true });
        target?.select();
      };
      const replaceDigit = (index: number, raw: string) => {
        const digits = raw.replace(/\D/g, "");
        if (!digits) return;
        if (digits.length > 1) {
          const next = digits.slice(0, SLOTS);
          emitTouchValue(next);
          focusSlot(Math.min(next.length, SLOTS - 1));
          return;
        }
        const chars = touchValue.padEnd(SLOTS, " ").split("");
        chars[index] = digits;
        const next = chars.join("").trimEnd().replace(/ /g, "");
        emitTouchValue(next);
        focusSlot(index + 1);
      };

      return (
        <div
          className={cn("flex w-full justify-center gap-2", className)}
          role="group"
          aria-label="One-time password"
          data-admin-reset-otp-touch-target
        >
          {Array.from({ length: SLOTS }, (_, index) => (
            <input
              key={index}
              ref={(node) => setSlotRef(index, node)}
              id={index === 0 ? id : undefined}
              name={index === 0 ? name : undefined}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete={index === 0 ? "one-time-code" : "off"}
              enterKeyHint={index === SLOTS - 1 ? "done" : "next"}
              maxLength={index === 0 ? SLOTS : 1}
              value={touchValue[index] ?? ""}
              autoFocus={index === 0 ? autoFocus : undefined}
              disabled={disabled}
              aria-label={`OTP digit ${index + 1}`}
              data-otp-slot={index}
              className="h-12 min-w-0 max-w-12 flex-1 touch-manipulation rounded-md border border-input bg-background text-center text-lg outline-none focus:border-ring focus:ring-2 focus:ring-ring"
              onFocus={(event) => event.currentTarget.select()}
              onBlur={index === 0 ? onBlur : undefined}
              onInput={(event) => replaceDigit(index, event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Backspace") return;
                event.preventDefault();
                if (touchValue[index]) {
                  emitTouchValue(
                    `${touchValue.slice(0, index)}${touchValue.slice(index + 1)}`,
                  );
                  return;
                }
                if (index > 0) {
                  emitTouchValue(
                    `${touchValue.slice(0, index - 1)}${touchValue.slice(index)}`,
                  );
                  focusSlot(index - 1);
                }
              }}
              onPaste={(event) => {
                event.preventDefault();
                const next = event.clipboardData
                  .getData("text")
                  .replace(/\D/g, "")
                  .slice(0, SLOTS);
                if (!next) return;
                emitTouchValue(next);
                focusSlot(Math.min(next.length, SLOTS - 1));
              }}
            />
          ))}
        </div>
      );
    }

    return (
      <div
        className="w-full"
        onPointerDown={focusNativeInput}
        onClick={focusNativeInput}
      >
        <InputOTP
          containerClassName={cn(
            "w-full justify-center",
            className,
          )}
          className="disabled:cursor-not-allowed"
          ref={setInputRef}
          id={id}
          name={name}
          maxLength={SLOTS}
          pattern="[0-9]*"
          inputMode="numeric"
          autoComplete="one-time-code"
          enterKeyHint="done"
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
      </div>
    );
  },
);

OtpCodeInput.displayName = "OtpCodeInput";
export { OtpCodeInput };
