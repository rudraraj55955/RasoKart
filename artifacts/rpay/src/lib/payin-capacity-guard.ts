/**
 * Client-side daily capacity guard for the Cashfree/UPI deposit flow.
 *
 * Extracted as a pure function so it can be unit-tested independently of the
 * React component that calls it.  The server remains the authoritative enforcer;
 * this check is best-effort UX (avoids a guaranteed 400 after form submission).
 */

export type PayinCapacityCheckResult =
  | { blocked: true; message: string }
  | { blocked: false };

/**
 * Determine whether `depositAmt` exceeds the merchant's remaining daily
 * deposit capacity.
 *
 * @param depositAmt  - The amount the merchant wants to deposit (rupees).
 * @param status      - The GET /payin/status response payload (or any subset).
 *                      When `dailyLimit` or `dailyLimitUsed` is absent/null the
 *                      guard is skipped (fail-open) so a missing field never
 *                      blocks a valid submission.
 */
export function checkDailyCapacity(
  depositAmt: number,
  status:
    | { dailyLimit?: number | null; dailyLimitUsed?: number | null }
    | null
    | undefined,
): PayinCapacityCheckResult {
  // Guard is skipped when either field is absent — the server will enforce.
  if (status?.dailyLimit == null || status?.dailyLimitUsed == null) {
    return { blocked: false };
  }

  const remaining = status.dailyLimit - status.dailyLimitUsed;

  if (depositAmt > remaining) {
    return {
      blocked: true,
      message: `Amount exceeds your remaining daily deposit capacity of ₹${remaining.toLocaleString("en-IN")}`,
    };
  }

  return { blocked: false };
}
