import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * OtpCodeInput — a controlled input for collecting 6-digit OTP codes.
 *
 * Key attributes for mobile / Android / Samsung compatibility:
 *   type="text"              — avoids broken numeric-type behaviour on some Android keyboards
 *   inputMode="numeric"      — shows the numeric pad without type="number" side-effects
 *   autoComplete="one-time-code" — lets Android/iOS offer SMS and email OTP autofill
 *   pattern="[0-9]*"         — native validation hint
 *   maxLength={6}            — caps input
 *
 * The onChange handler strips every non-digit character and limits to 6 chars before
 * forwarding to the caller.  React Hook Form v7's field.onChange accepts a raw string,
 * so calling field.onChange(filteredDigits) is fully supported and preferred.
 */

export type OtpCodeInputProps = Omit<
  React.ComponentProps<"input">,
  "type" | "inputMode" | "maxLength" | "pattern" | "autoComplete" | "onChange"
> & {
  onChange?: React.ChangeEventHandler<HTMLInputElement> | ((value: string) => void);
};

const OtpCodeInput = React.forwardRef<HTMLInputElement, OtpCodeInputProps>(
  ({ className, onChange, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!onChange) return;
      const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
      (onChange as (v: string) => void)(digits);
    };

    return (
      <input
        {...props}
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        pattern="[0-9]*"
        onChange={handleChange}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm tracking-widest text-center font-mono",
          className
        )}
      />
    );
  }
);
OtpCodeInput.displayName = "OtpCodeInput";

export { OtpCodeInput };
