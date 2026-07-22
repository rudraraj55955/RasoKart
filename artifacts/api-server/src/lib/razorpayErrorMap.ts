/**
 * Razorpay error-code to user-friendly message mapping.
 *
 * Raw Razorpay errors are NEVER forwarded to merchants or customers.
 * Only the mapped `userMessage` is returned in API responses.
 * The `internalCode` retains the original code for logging/debugging.
 *
 * Source: https://razorpay.com/docs/api/errors/
 */

export interface MappedRazorpayError {
  userMessage: string;
  internalCode: string;
  category: "payment_failure" | "network" | "validation" | "auth" | "server" | "unknown";
}

const ERROR_MAP: Record<string, MappedRazorpayError> = {
  BAD_REQUEST_ERROR: {
    userMessage: "Your payment request could not be processed. Please check your details and try again.",
    internalCode: "BAD_REQUEST_ERROR",
    category: "validation",
  },
  GATEWAY_ERROR: {
    userMessage: "The payment could not be processed by the bank. Please try a different payment method.",
    internalCode: "GATEWAY_ERROR",
    category: "payment_failure",
  },
  NETWORK_ERROR: {
    userMessage: "A network error occurred. Please check your connection and try again.",
    internalCode: "NETWORK_ERROR",
    category: "network",
  },
  SERVER_ERROR: {
    userMessage: "A temporary server error occurred. Please try again after a few minutes.",
    internalCode: "SERVER_ERROR",
    category: "server",
  },
  PAYMENT_FAILED: {
    userMessage: "Your payment was declined. Please use a different payment method or contact your bank.",
    internalCode: "PAYMENT_FAILED",
    category: "payment_failure",
  },
  PAYMENT_PENDING: {
    userMessage: "Your payment is being processed. Please do not retry — you will be notified once it is confirmed.",
    internalCode: "PAYMENT_PENDING",
    category: "payment_failure",
  },
  SIGNATURE_VERIFICATION_FAILED: {
    userMessage: "Payment verification failed. Please contact support if the amount was deducted.",
    internalCode: "SIGNATURE_VERIFICATION_FAILED",
    category: "auth",
  },
  INSUFFICIENT_FUNDS: {
    userMessage: "Insufficient funds in your account. Please use a different payment method.",
    internalCode: "INSUFFICIENT_FUNDS",
    category: "payment_failure",
  },
  CARD_DECLINED: {
    userMessage: "Your card was declined. Please try a different card or contact your bank.",
    internalCode: "CARD_DECLINED",
    category: "payment_failure",
  },
  EXPIRED_CARD: {
    userMessage: "Your card has expired. Please use a valid card.",
    internalCode: "EXPIRED_CARD",
    category: "payment_failure",
  },
  INCORRECT_PIN: {
    userMessage: "Incorrect PIN entered. Please try again.",
    internalCode: "INCORRECT_PIN",
    category: "payment_failure",
  },
  BLOCKED_CARD: {
    userMessage: "Your card has been blocked. Please contact your bank.",
    internalCode: "BLOCKED_CARD",
    category: "payment_failure",
  },
  LIMIT_EXCEEDED: {
    userMessage: "Transaction limit exceeded. Please try a smaller amount or use a different payment method.",
    internalCode: "LIMIT_EXCEEDED",
    category: "payment_failure",
  },
  INVALID_UPI_ID: {
    userMessage: "The UPI ID entered is invalid or does not exist. Please check and try again.",
    internalCode: "INVALID_UPI_ID",
    category: "validation",
  },
  UPI_TRANSACTION_DECLINED: {
    userMessage: "Your UPI payment was declined. Please check your UPI app and try again.",
    internalCode: "UPI_TRANSACTION_DECLINED",
    category: "payment_failure",
  },
  TIMEOUT: {
    userMessage: "The payment timed out. Please try again.",
    internalCode: "TIMEOUT",
    category: "network",
  },
  ORDER_ALREADY_PAID: {
    userMessage: "This order has already been paid.",
    internalCode: "ORDER_ALREADY_PAID",
    category: "validation",
  },
};

const FALLBACK: MappedRazorpayError = {
  userMessage: "Your payment could not be completed. Please try again or contact support.",
  internalCode: "UNKNOWN",
  category: "unknown",
};

/**
 * Maps a raw Razorpay error code/description to a safe user-facing message.
 *
 * @param code    - Razorpay error code (e.g. "BAD_REQUEST_ERROR")
 * @param description - Raw error description from Razorpay (used to improve mapping)
 * @returns MappedRazorpayError with userMessage, internalCode, and category
 */
export function mapRazorpayError(
  code: string | null | undefined,
  description?: string | null,
): MappedRazorpayError {
  if (!code) return FALLBACK;

  const normalised = code.toUpperCase().trim();

  if (ERROR_MAP[normalised]) return ERROR_MAP[normalised];

  // Heuristic sub-string matching for codes not in the primary map
  if (normalised.includes("CARD")) return ERROR_MAP["CARD_DECLINED"]!;
  if (normalised.includes("UPI")) return ERROR_MAP["UPI_TRANSACTION_DECLINED"]!;
  if (normalised.includes("NETWORK") || normalised.includes("TIMEOUT")) return ERROR_MAP["NETWORK_ERROR"]!;
  if (normalised.includes("LIMIT")) return ERROR_MAP["LIMIT_EXCEEDED"]!;
  if (normalised.includes("FUND") || normalised.includes("BALANCE")) return ERROR_MAP["INSUFFICIENT_FUNDS"]!;
  if (normalised.includes("SIGNATURE")) return ERROR_MAP["SIGNATURE_VERIFICATION_FAILED"]!;
  if (normalised.includes("GATEWAY")) return ERROR_MAP["GATEWAY_ERROR"]!;
  if (normalised.includes("SERVER")) return ERROR_MAP["SERVER_ERROR"]!;

  // Description-based fallback (look for known keywords in the description)
  if (description) {
    const d = description.toLowerCase();
    if (d.includes("insufficient") || d.includes("balance")) return ERROR_MAP["INSUFFICIENT_FUNDS"]!;
    if (d.includes("declined") || d.includes("rejected")) return ERROR_MAP["CARD_DECLINED"]!;
    if (d.includes("expired")) return ERROR_MAP["EXPIRED_CARD"]!;
    if (d.includes("network") || d.includes("timeout")) return ERROR_MAP["NETWORK_ERROR"]!;
    if (d.includes("upi")) return ERROR_MAP["UPI_TRANSACTION_DECLINED"]!;
  }

  return { ...FALLBACK, internalCode: normalised };
}
