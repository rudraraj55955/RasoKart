import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * OtpCodeInput — six individual digit boxes for collecting a 6-digit OTP code.
 *
 * Browser / OS autofill strategy:
 *   • Every slot carries autocomplete="one-time-code" so iOS Safari fills each
 *     box individually (it targets them left-to-right when the same attribute
 *     appears on sibling inputs in a group).
 *   • Android Chrome's WebOTP API fires onChange on the first slot with the
 *     full 6-digit string.  The handleChange path for raw.length > 1 distributes
 *     those digits across all slots automatically.
 *
 * Paste:
 *   • onPaste intercepts clipboard content on any slot, strips non-digits, and
 *     distributes starting from slot 0 regardless of which slot received the paste.
 *
 * Focus movement:
 *   • Typing a digit advances focus to the next slot.
 *   • Backspace on an empty slot moves focus to the previous slot (and clears it).
 *   • ArrowLeft / ArrowRight also navigate between slots.
 *
 * API surface (unchanged from the previous single-input version):
 *   value    — controlled string of 0–6 digits coming from the parent / RHF field
 *   onChange — called with a plain digit string (not a SyntheticEvent); RHF's
 *              field.onChange accepts this form directly
 *   onBlur   — called when focus leaves the entire 6-box group (not between slots)
 *   name     — forwarded to the first slot for RHF field registration
 *   ref      — forwarded to the first slot's DOM <input>
 *   autoFocus — focuses the first slot on mount
 *   placeholder — accepted for prop-compat; not rendered (boxes are self-describing)
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
    ref
  ) => {
    // Derive per-slot values from the controlled string.
    const digits = Array.from({ length: SLOTS }, (_, i) => value[i] ?? "");

    // Refs for imperative focus management.
    const slotRefs = React.useRef<(HTMLInputElement | null)[]>(
      Array(SLOTS).fill(null)
    );

    const focusSlot = (index: number) => {
      slotRefs.current[Math.max(0, Math.min(SLOTS - 1, index))]?.focus();
    };

    /** Collect slot array → join → strip non-digits → notify parent. */
    const emit = (next: string[]) => {
      onChange?.(next.join("").replace(/\D/g, "").slice(0, SLOTS));
    };

    const handleChange = (
      slotIndex: number,
      e: React.ChangeEvent<HTMLInputElement>
    ) => {
      const raw = e.target.value.replace(/\D/g, "");
      if (!raw) return; // deletion is handled in onKeyDown

      if (raw.length > 1) {
        // WebOTP autofill (Android) or paste-into-single-input path.
        // Distribute starting from this slot.
        const next = digits.slice();
        for (let i = 0; i < raw.length && slotIndex + i < SLOTS; i++) {
          next[slotIndex + i] = raw[i];
        }
        emit(next);
        focusSlot(Math.min(slotIndex + raw.length, SLOTS - 1));
      } else {
        // Normal single-digit entry.
        const next = digits.slice();
        next[slotIndex] = raw;
        emit(next);
        if (slotIndex < SLOTS - 1) focusSlot(slotIndex + 1);
      }
    };

    const handleKeyDown = (
      slotIndex: number,
      e: React.KeyboardEvent<HTMLInputElement>
    ) => {
      if (e.key === "Backspace") {
        e.preventDefault();
        if (digits[slotIndex]) {
          // Clear this slot.
          const next = digits.slice();
          next[slotIndex] = "";
          emit(next);
        } else if (slotIndex > 0) {
          // Already empty — clear the previous slot and move back.
          const next = digits.slice();
          next[slotIndex - 1] = "";
          emit(next);
          focusSlot(slotIndex - 1);
        }
      } else if (e.key === "Delete") {
        e.preventDefault();
        const next = digits.slice();
        next[slotIndex] = "";
        emit(next);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (slotIndex > 0) focusSlot(slotIndex - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (slotIndex < SLOTS - 1) focusSlot(slotIndex + 1);
      }
    };

    /** Any slot: paste always distributes from slot 0. */
    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pasted = e.clipboardData
        .getData("text")
        .replace(/\D/g, "")
        .slice(0, SLOTS);
      if (!pasted) return;
      const next = Array.from({ length: SLOTS }, (_, i) => pasted[i] ?? "");
      emit(next);
      focusSlot(Math.min(pasted.length, SLOTS - 1));
    };

    /** Select-all on focus so re-typing overwrites the existing digit cleanly. */
    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      e.target.select();
    };

    /**
     * Call onBlur only when focus leaves the entire group.
     * Between-slot focus moves must NOT trigger RHF "touched" marking.
     */
    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      const relatedTarget = e.relatedTarget as Node | null;
      const stillInGroup = slotRefs.current.some(
        (el) => el !== null && el === relatedTarget
      );
      if (!stillInGroup) {
        onBlur?.(e);
      }
    };

    return (
      <div
        role="group"
        aria-label="One-time password"
        className={cn("flex gap-2 w-full justify-center", className)}
      >
        {Array.from({ length: SLOTS }, (_, i) => (
          <input
            key={i}
            ref={(el) => {
              slotRefs.current[i] = el;
              if (i === 0) {
                if (typeof ref === "function") {
                  ref(el);
                } else if (ref) {
                  (ref as React.MutableRefObject<HTMLInputElement | null>).current =
                    el;
                }
              }
            }}
            id={i === 0 ? id : undefined}
            name={i === 0 ? name : undefined}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            /**
             * maxLength={6} (not 1) intentionally: some browsers/WebOTP
             * implementations write the full code into a single input.
             * handleChange distributes any multi-digit value automatically.
             */
            maxLength={6}
            value={digits[i]}
            onChange={(e) => handleChange(i, e)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            onFocus={handleFocus}
            onBlur={handleBlur}
            autoFocus={autoFocus && i === 0}
            disabled={disabled}
            aria-label={`Digit ${i + 1} of 6`}
            className={cn(
              // Sizing — flex-1 lets the group fill the available form width
              // while max-w-12 (48px) prevents boxes from becoming too wide.
              "flex-1 min-w-0 max-w-12 h-12",
              "rounded-md border border-input bg-transparent",
              "text-center text-base font-mono shadow-sm",
              "transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-50",
              // Show a faint placeholder dash when the slot is empty.
              !digits[i] && "text-muted-foreground"
            )}
          />
        ))}
      </div>
    );
  }
);

OtpCodeInput.displayName = "OtpCodeInput";
export { OtpCodeInput };
