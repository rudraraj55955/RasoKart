import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Extracts a user-friendly error message from an API error response.
 * HTTP 429 (rate limit) errors are surfaced with a clear, actionable message.
 * All other errors fall back to the server-provided message or the supplied default.
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (e["status"] === 429) {
      return "You've made too many requests. Please wait a moment and try again.";
    }
    const data = e["data"];
    if (data && typeof data === "object") {
      const msg = (data as Record<string, unknown>)["error"];
      if (typeof msg === "string" && msg.trim()) return msg.trim();
    }
    const msg = e["message"];
    if (typeof msg === "string" && msg.trim()) return msg.trim();
  }
  return fallback;
}
