/**
 * Stuck payout cleanup scheduler.
 *
 * Finds withdrawals stuck in an in-flight transfer state (INITIATED/PENDING)
 * that have not moved for longer than the stuck threshold. This happens when
 * a transfer_id was claimed locally but the provider never actually created
 * the transfer (e.g. beneficiary registration failed mid-flight, or a
 * network error happened after the local INITIATED claim but before the
 * provider call completed/was recorded).
 *
 * For each stuck withdrawal:
 *  - If a providerReferenceId exists, confirm with the provider that the
 *    transfer genuinely doesn't exist (404 / beneficiary_not_found-style
 *    response) before touching it — a transient provider outage should not
 *    cause us to prematurely fail a transfer that is still processing.
 *  - If no providerReferenceId was ever recorded, the transfer was never
 *    created at the provider at all — safe to mark FAILED directly.
 *  - Marks the withdrawal FAILED with a safe failure reason and releases the
 *    merchant's locked wallet hold back to available balance.
 */

import cron from "node-cron";
import {
  db,
  withdrawalsTable,
  merchantsTable,
  systemConfigTable,
  SYSTEM_CONFIG_KEYS,
} from "@workspace/db";
import { eq, and, inArray, lt } from "drizzle-orm";
import { logger } from "../lib/logger";
import { decryptSecret } from "./cryptoUtils";
import {
  cashfreePayoutGetTransferStatus,
  isBeneficiaryNotFound,
  type CashfreePayoutEnv,
} from "./cashfreePayout";
import { mutateWallet } from "../routes/wallets";

const STUCK_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
const STUCK_TRANSFER_STATUSES = ["INITIATED", "PENDING"] as const;
const STUCK_FAILURE_REASON = "Transfer was not created / provider transfer not found";

export interface StuckPayoutCleanupResult {
  checked: number;
  cleaned: number;
}

async function getPayoutConfig() {
  const keys = [
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_ID,
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_SECRET,
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENV,
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENABLED,
  ];
  const rows = await db.select().from(systemConfigTable).where(inArray(systemConfigTable.key, keys));
  const cfg = new Map(rows.map(r => [r.key, r.value]));
  const rawSecret = cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_SECRET) ?? "";
  const decrypted = decryptSecret(rawSecret);
  return {
    clientId: (cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_ID) ?? "").trim(),
    clientSecret: decrypted.ok ? decrypted.value.trim() : "",
    env: (cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENV) ?? "test") as CashfreePayoutEnv,
    enabled: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENABLED) === "true",
  };
}

async function releaseStuckPayout(w: typeof withdrawalsTable.$inferSelect) {
  const amt = Number(w.amount);
  const now = new Date();

  // Always resolve the merchant via the withdrawal's own merchantId column —
  // never the withdrawal/payout id itself — and confirm the merchant row
  // actually exists before mutating its wallet. A stale/orphaned merchantId
  // reference would otherwise violate the merchant_wallets FK and throw,
  // leaving the withdrawal stuck forever since the FAILED update below would
  // never run.
  const [merchant] = await db
    .select({ id: merchantsTable.id })
    .from(merchantsTable)
    .where(eq(merchantsTable.id, w.merchantId))
    .limit(1);

  if (!merchant) {
    logger.warn(
      { withdrawalId: w.id, merchantId: w.merchantId },
      "payout_locked_release_skipped_missing_merchant"
    );
  } else {
    // Release the wallet hold first — if this fails, the withdrawal is left
    // untouched (still INITIATED/PENDING) so the next scheduled run retries
    // it, rather than leaving the withdrawal marked FAILED with its locked
    // funds never released back to the merchant.
    await mutateWallet(
      w.merchantId,
      { holdDelta: -amt, availableDelta: amt, totalReversalsDelta: amt },
      {
        txnType: "payout_failed_release",
        bucket: "hold",
        amount: amt,
        referenceType: "withdrawal",
        referenceId: w.id,
        description: `Payout #${w.id} stuck cleanup — ₹${amt.toFixed(2)} released back`,
        createdBy: null,
      }
    );

    logger.warn(
      { withdrawalId: w.id, merchantId: w.merchantId, amount: amt },
      "payout_locked_amount_released"
    );
  }

  await db
    .update(withdrawalsTable)
    .set({
      transferStatus: "FAILED",
      failureReason: STUCK_FAILURE_REASON,
      completedAt: now,
    })
    .where(eq(withdrawalsTable.id, w.id));
}

/**
 * Core scan: find withdrawals stuck in INITIATED/PENDING past the threshold
 * whose provider transfer either never existed or is confirmed missing at
 * the provider, mark them FAILED, and release the merchant's locked hold.
 */
export async function runStuckPayoutCleanup(): Promise<StuckPayoutCleanupResult> {
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);

  const stuck = await db
    .select()
    .from(withdrawalsTable)
    .where(
      and(
        eq(withdrawalsTable.status, "approved"),
        inArray(withdrawalsTable.transferStatus, [...STUCK_TRANSFER_STATUSES]),
        lt(withdrawalsTable.updatedAt, cutoff)
      )
    );

  if (stuck.length === 0) {
    return { checked: 0, cleaned: 0 };
  }

  const cfg = await getPayoutConfig();
  let cleaned = 0;

  for (const w of stuck) {
    try {
      if (!w.providerReferenceId) {
        // A transfer_id was claimed locally but never actually dispatched to
        // the provider (e.g. crashed/errored before the create call
        // recorded a reference) — there is nothing at the provider to check.
        await releaseStuckPayout(w);
        cleaned++;
        continue;
      }

      if (!cfg.enabled || !cfg.clientId || !cfg.clientSecret) {
        // Cannot verify with the provider right now — skip rather than
        // guessing, to avoid prematurely failing a transfer that may still
        // be genuinely processing.
        continue;
      }

      const status = await cashfreePayoutGetTransferStatus(
        cfg.clientId,
        cfg.clientSecret,
        cfg.env,
        w.providerReferenceId
      );

      if (isBeneficiaryNotFound(status.parsed, status.httpStatus)) {
        await releaseStuckPayout(w);
        cleaned++;
      }
      // Otherwise the provider has a record of it (still processing, or a
      // terminal state we haven't synced yet) — leave it for refresh-status.
    } catch (err) {
      logger.warn({ err, withdrawalId: w.id }, "payout_stuck_cleanup_check_failed");
    }
  }

  logger.info({ checked: stuck.length, cleaned }, "Stuck payout cleanup scan complete");
  return { checked: stuck.length, cleaned };
}

/** Register the periodic cron job. Called once at server startup. */
export function initPayoutStuckCleanupScheduler(): void {
  // Run every 10 minutes
  cron.schedule("*/10 * * * *", async () => {
    try {
      await runStuckPayoutCleanup();
    } catch (err) {
      logger.error({ err }, "Stuck payout cleanup scheduler failed");
    }
  });

  logger.info("Stuck payout cleanup scheduler initialized (every 10 minutes)");
}
