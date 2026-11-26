/**
 * Conservative provider outcome policy for a future payout integration.
 * Never re-issue a payout solely because HTTP timed out or provider status is unknown.
 * This module performs no provider calls, ledger writes, or retries.
 */
export type ProviderObservation =
  | "confirmed_success"
  | "confirmed_failure"
  | "pending"
  | "unknown"
  | "network_timeout"
  | "invalid_response";

export type ReconciliationDecision = {
  commandStatus: "completed" | "failed" | "requires_reconciliation";
  retryPayout: false;
  requiresProviderLookup: boolean;
};

export function decidePayoutReconciliation(observation: ProviderObservation): ReconciliationDecision {
  if (observation === "confirmed_success") {
    return { commandStatus: "completed", retryPayout: false, requiresProviderLookup: false };
  }
  if (observation === "confirmed_failure") {
    return { commandStatus: "failed", retryPayout: false, requiresProviderLookup: false };
  }
  return { commandStatus: "requires_reconciliation", retryPayout: false, requiresProviderLookup: true };
}
