/** Strict reconciliation matcher. Only use after provider signature/authentication
 * has been independently verified; this never accepts webhook content as proof.
 * Does not modify existing live webhook handlers.
 */
export type PayoutIdentity = {
  merchantId: number | null;
  transferId: string | null;
  providerTransferId: string | null;
};
export function matchPayoutIdentity(expected: PayoutIdentity, incoming: PayoutIdentity): boolean {
  if (!Number.isSafeInteger(expected.merchantId) || (expected.merchantId ?? 0) <= 0 ||
      incoming.merchantId !== expected.merchantId) return false;
  const e = expected.transferId?.trim();
  const i = incoming.transferId?.trim();
  if (!e || !i || e !== i) return false;
  // A provider ID supplied on either side must match on both sides.
  if (expected.providerTransferId || incoming.providerTransferId) {
    if (!expected.providerTransferId || !incoming.providerTransferId ||
        expected.providerTransferId !== incoming.providerTransferId) return false;
  }
  return true;
}
