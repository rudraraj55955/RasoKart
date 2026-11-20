/** Check identity and terminal transition before status updates.
 * Signature verification MUST be performed independently before calling this.
 */
export function evaluatePayoutWebhookEvent(
  stored: { transferId: string; providerTransferId: string | null; status: string },
  event: { transferId: string | null; providerTransferId: string | null; status: string },
): "accept" | "duplicate" | "conflict" | "stale" {
  if (!event.transferId || event.transferId !== stored.transferId ||
      (event.providerTransferId !== null && stored.providerTransferId !== null &&
       event.providerTransferId !== stored.providerTransferId)) return "conflict";
  if (stored.status === event.status) return "duplicate";
  // Provider SUCCESS can correct a locally failed payout, just as it does for
  // the matching withdrawal and wallet handler. Never downgrade SUCCESS, and
  // never reopen a failed payout for a non-success event.
  if (stored.status === "SUCCESS" ||
      (stored.status === "FAILED" && event.status !== "SUCCESS")) return "stale";
  return "accept";
}
