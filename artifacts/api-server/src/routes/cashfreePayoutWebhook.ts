import { Router } from "express";
import { db, cashfreePayoutsTable, cashfreePayoutWebhookLogsTable, systemConfigTable, SYSTEM_CONFIG_KEYS, withdrawalsTable } from "@workspace/db";
import { and, eq, or } from "drizzle-orm";
import { logger } from "../lib/logger";
import { verifyCashfreeWebhookSignature } from "../helpers/cashfree";
import { normalizeCashfreePayoutStatus } from "../helpers/cashfreePayout";
import { mutateWallet } from "./wallets";

const router = Router();

/**
 * OPTIONS /api/cashfree-payout/webhook
 * OPTIONS /api/webhooks/payouts/cashfree
 *
 * Pre-flight response so Cashfree "Test & Add Webhook" passes CORS checks.
 */
router.options("/", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-webhook-signature, x-webhook-timestamp");
  res.status(200).end();
});

/**
 * POST /api/cashfree-payout/webhook
 * POST /api/webhooks/payouts/cashfree
 *
 * Public endpoint — called by Cashfree Payout V2 when a transfer status changes.
 *
 * Signature verification (when secret is configured):
 *   HMAC-SHA256(timestamp + rawBody, webhookSecret) → base64
 *   Headers: x-webhook-signature, x-webhook-timestamp
 *
 * If webhook secret is NOT configured:
 *   Accept webhook + return 200 but skip ALL state mutations (fail-closed).
 *   Log with safeError noting the unconfigured secret.
 * If webhook secret IS configured and signature is INVALID:
 *   Return 401 and insert a log entry — do not process payload.
 * If webhook secret IS configured and signature is VALID:
 *   Process payload (update payout status, save UTR/failure reason) and return 200.
 *
 * Cashfree Payout V2 webhook event types:
 *   TRANSFER_SUCCESS, TRANSFER_FAILED, TRANSFER_REVERSED,
 *   WEBHOOK_TEST, TEST  (ping — always return 200)
 */
router.post("/", async (req, res) => {
  const endpoint = req.originalUrl.split("?")[0] ?? "/api/cashfree-payout/webhook";

  const rawBody =
    ((req as any).rawBody as Buffer | undefined)?.toString("utf8") ??
    JSON.stringify(req.body);

  const signature = req.headers["x-webhook-signature"] as string | undefined;
  const timestamp = req.headers["x-webhook-timestamp"] as string | undefined;

  let signatureVerified: boolean | null = null;
  let processingResult = "received";
  let safeError: string | null = null;
  let eventType: string | null = null;
  let transferId: string | null = null;
  let cfTransferId: string | null = null;
  let statusRaw: string | null = null;
  let utr: string | null = null;
  let payoutId: number | null = null;

  try {
    // ── Signature verification ────────────────────────────────────────────
    // Fetch both the dedicated webhook secret and the client secret.
    // Cashfree may sign payout webhooks with the Client Secret in some environments,
    // so we try the webhook secret first and fall back to the client secret.
    const secretRows = await db
      .select({ key: systemConfigTable.key, value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(
        or(
          eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_WEBHOOK_SECRET),
          eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_SECRET),
        )
      );
    const secretMap = new Map(secretRows.map(r => [r.key, r.value ?? ""]));
    const webhookSecret = secretMap.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_WEBHOOK_SECRET) ?? "";
    const clientSecretFallback = secretMap.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_SECRET) ?? "";

    if (!webhookSecret && !clientSecretFallback) {
      // Fail-closed: log the event but perform NO state mutations without a verified origin.
      // Return 200 so Cashfree does not retry — configure the secret to enable full processing.
      logger.warn({ endpoint }, "Cashfree payout webhook received but no webhook secret or client secret is configured — skipping all state mutations");
      const body = req.body as Record<string, unknown>;
      eventType = ((body["type"] ?? body["event"]) as string | undefined) ?? null;
      const data = body["data"] as Record<string, unknown> | undefined;
      const transfer = (data?.["transfer"] ?? data) as Record<string, unknown> | undefined;
      transferId = (transfer?.["transfer_id"] as string | undefined) ?? null;
      cfTransferId = String(transfer?.["cf_transfer_id"] ?? "").trim() || null;
      statusRaw = (transfer?.["transfer_status"] as string | undefined) ?? null;
      utr = (transfer?.["transfer_utr"] as string | undefined) ?? null;
      processingResult = "received";
      res.status(200).json({ ok: true, received: true });
      await insertLog({ endpoint, eventType, status: statusRaw, signatureVerified: null, payoutId: null, transferId, cfTransferId, utr, safeError: "Webhook received without signature verification because webhook secret is not configured", processingResult, rawPayload: rawBody });
      return;
    }

    // Try webhook secret first; fall back to client secret if first attempt fails.
    const validWithWebhookSecret = webhookSecret
      ? verifyCashfreeWebhookSignature(rawBody, timestamp ?? "", signature ?? "", webhookSecret)
      : false;
    const validWithClientSecret = !validWithWebhookSecret && clientSecretFallback
      ? verifyCashfreeWebhookSignature(rawBody, timestamp ?? "", signature ?? "", clientSecretFallback)
      : false;
    const valid = validWithWebhookSecret || validWithClientSecret;

    signatureVerified = valid;
    if (!valid) {
      logger.warn({ endpoint, timestamp, hasSignature: !!signature, triedFallback: !!clientSecretFallback }, "webhook_signature_mismatch");
      await insertLog({ endpoint, eventType: null, status: null, signatureVerified: false, payoutId: null, transferId: null, cfTransferId: null, utr: null, safeError: "webhook_signature_mismatch", processingResult: "rejected", rawPayload: rawBody });
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }

    // Acknowledge immediately — Cashfree expects 200 quickly
    res.status(200).json({ ok: true, received: true });

    // ── Parse Cashfree Payout V2 webhook payload ──────────────────────────
    const body = req.body as Record<string, unknown>;

    // Support both `type` and `event` field names across API versions
    eventType = ((body["type"] ?? body["event"]) as string | undefined) ?? null;

    const data = body["data"] as Record<string, unknown> | undefined;
    const transfer = (data?.["transfer"] ?? data) as Record<string, unknown> | undefined;

    transferId = (transfer?.["transfer_id"] as string | undefined) ?? null;
    cfTransferId = String(transfer?.["cf_transfer_id"] ?? "").trim() || null;
    statusRaw = (transfer?.["transfer_status"] as string | undefined) ?? null;
    utr = (transfer?.["transfer_utr"] ?? transfer?.["bank_reference"] as string | undefined) as string | null ?? null;
    const failureReason = (transfer?.["transfer_message"] ?? transfer?.["failure_reason"] as string | undefined) as string | null ?? null;

    logger.info({ endpoint, eventType, transferId, cfTransferId, status: statusRaw }, "Cashfree payout webhook received");

    // ── TEST / ping events — just acknowledge ─────────────────────────────
    const evtUpper = (eventType ?? "").toUpperCase();
    if (!eventType || evtUpper === "TEST" || evtUpper === "WEBHOOK_TEST" || (!transferId && !cfTransferId)) {
      processingResult = "ignored";
      await insertLog({ endpoint, eventType, status: statusRaw, signatureVerified, payoutId: null, transferId, cfTransferId, utr, safeError: null, processingResult, rawPayload: rawBody });
      return;
    }

    const normalizedStatus = normalizeCashfreePayoutStatus(statusRaw);

    // ── Look up both tables in parallel ───────────────────────────────────
    // cashfreePayoutsTable — legacy/internal payout records
    // withdrawalsTable — merchant withdrawal payouts (the primary path)
    const cfConditions = [];
    if (transferId) cfConditions.push(eq(cashfreePayoutsTable.transferId, transferId));
    if (cfTransferId) cfConditions.push(eq(cashfreePayoutsTable.cashfreeTransferId, cfTransferId));

    const wdConditions = [];
    if (transferId) wdConditions.push(eq(withdrawalsTable.providerReferenceId, transferId));
    if (cfTransferId) wdConditions.push(eq(withdrawalsTable.providerReferenceId, cfTransferId));

    const [[payout], [withdrawal]] = await Promise.all([
      cfConditions.length > 0
        ? db.select().from(cashfreePayoutsTable).where(or(...cfConditions)).limit(1)
        : Promise.resolve([] as typeof cashfreePayoutsTable.$inferSelect[]),
      wdConditions.length > 0
        ? db.select().from(withdrawalsTable).where(or(...wdConditions)).limit(1)
        : Promise.resolve([] as typeof withdrawalsTable.$inferSelect[]),
    ]);

    if (!payout && !withdrawal) {
      logger.warn({ endpoint, transferId, cfTransferId }, "Cashfree payout webhook: matching record not found in DB");
      processingResult = "unmatched";
      safeError = "Payout record not found";
      await insertLog({ endpoint, eventType, status: statusRaw, signatureVerified, payoutId: null, transferId, cfTransferId, utr, safeError, processingResult, rawPayload: rawBody });
      return;
    }

    // ── Update cashfreePayoutsTable (legacy path) ─────────────────────────
    if (payout) {
      payoutId = payout.id;
      if (normalizedStatus !== payout.status || (normalizedStatus === "SUCCESS" && utr && !payout.utr)) {
        const baseSet = {
          status: normalizedStatus,
          cashfreeTransferId: cfTransferId ?? payout.cashfreeTransferId ?? null,
        };
        let finalSet: typeof baseSet & { utr?: string | null; errorMessage?: string | null };
        if (normalizedStatus === "SUCCESS") {
          finalSet = { ...baseSet, utr: utr ?? undefined, errorMessage: null };
        } else if (normalizedStatus === "FAILED") {
          finalSet = { ...baseSet, errorMessage: failureReason ? failureReason.substring(0, 500) : "Transfer failed" };
        } else {
          finalSet = baseSet;
        }
        await db.update(cashfreePayoutsTable).set(finalSet).where(eq(cashfreePayoutsTable.id, payout.id));
        logger.info({ endpoint, payoutId: payout.id, transferId, oldStatus: payout.status, newStatus: normalizedStatus, utr }, "Cashfree payout status updated via webhook");
      }
    }

    // ── Update withdrawalsTable + wallet mutations ────────────────────────
    // This is the primary path for merchant withdrawal payouts.
    if (withdrawal && withdrawal.status === "approved" && withdrawal.transferStatus !== "SUCCESS") {
      const wAmt = Number(withdrawal.amount);
      const prevTransferStatus = withdrawal.transferStatus;

      const newWdTransferStatus =
        normalizedStatus === "SUCCESS" ? "SUCCESS" :
        normalizedStatus === "FAILED" ? "FAILED" :
        withdrawal.transferStatus;
      const newWdUtr = normalizedStatus === "SUCCESS" ? (utr ?? withdrawal.utr) : withdrawal.utr;
      const newWdFailureReason =
        normalizedStatus === "SUCCESS" ? null :
        normalizedStatus === "FAILED" ? (failureReason?.substring(0, 500) ?? withdrawal.failureReason ?? "payout_provider_failed") :
        withdrawal.failureReason;
      const isWdTerminal = normalizedStatus === "SUCCESS" || normalizedStatus === "FAILED";

      // Conditional update — guard against concurrent webhook deliveries
      const [updatedWd] = await db
        .update(withdrawalsTable)
        .set({
          transferStatus: newWdTransferStatus,
          utr: newWdUtr,
          failureReason: newWdFailureReason,
          completedAt: isWdTerminal ? new Date() : withdrawal.completedAt,
        })
        .where(
          and(
            eq(withdrawalsTable.id, withdrawal.id),
            eq(withdrawalsTable.transferStatus, withdrawal.transferStatus),
          )
        )
        .returning();

      if (updatedWd) {
        logger.info({ endpoint, withdrawalId: withdrawal.id, transferId, cfTransferId, prevTransferStatus, newTransferStatus: newWdTransferStatus, utr }, "payout_withdrawal_status_updated_via_webhook");

        // Wallet mutations — only when status actually changed
        if (normalizedStatus === "SUCCESS") {
          if (["FAILED", "REVERSED"].includes(prevTransferStatus)) {
            // Correction: funds were already released back to available when FAILED was recorded
            await mutateWallet(
              withdrawal.merchantId,
              { availableDelta: -wAmt, totalPayoutDelta: wAmt, totalReversalsDelta: -wAmt },
              { txnType: "payout_success_correction", bucket: "available", amount: -wAmt, referenceType: "withdrawal", referenceId: withdrawal.id, description: `Payout #${withdrawal.id} — provider SUCCESS via webhook (was locally ${prevTransferStatus}) — ₹${wAmt} corrected`, createdBy: null }
            );
          } else {
            // Normal: funds still in hold
            await mutateWallet(
              withdrawal.merchantId,
              { holdDelta: -wAmt, totalPayoutDelta: wAmt },
              { txnType: "payout_success", bucket: "hold", amount: -wAmt, referenceType: "withdrawal", referenceId: withdrawal.id, description: `Payout #${withdrawal.id} confirmed successful via webhook — ₹${wAmt} settled`, createdBy: null }
            );
          }
        } else if (normalizedStatus === "FAILED" && !["FAILED", "REVERSED"].includes(prevTransferStatus)) {
          await mutateWallet(
            withdrawal.merchantId,
            { holdDelta: -wAmt, availableDelta: wAmt, totalReversalsDelta: wAmt },
            { txnType: "payout_failed_release", bucket: "hold", amount: wAmt, referenceType: "withdrawal", referenceId: withdrawal.id, description: `Payout #${withdrawal.id} confirmed failed via webhook — ₹${wAmt} released back`, createdBy: null }
          );
        }
      }
    }

    processingResult = "processed";
    await insertLog({ endpoint, eventType, status: normalizedStatus, signatureVerified, payoutId: payoutId, transferId, cfTransferId, utr, safeError: null, processingResult, rawPayload: rawBody });

  } catch (err) {
    logger.error({ err, endpoint, transferId, eventType }, "Cashfree payout webhook processing error");
    processingResult = "error";
    safeError = "Internal processing error";
    try {
      await insertLog({ endpoint, eventType, status: statusRaw, signatureVerified, payoutId, transferId, cfTransferId, utr, safeError, processingResult: "error", rawPayload: rawBody });
    } catch (logErr) {
      logger.warn({ logErr }, "Cashfree payout webhook: failed to insert log after error");
    }
  }
});

async function insertLog(params: {
  endpoint: string;
  eventType: string | null;
  status: string | null;
  signatureVerified: boolean | null;
  payoutId: number | null;
  transferId: string | null;
  cfTransferId: string | null;
  utr: string | null;
  safeError: string | null;
  processingResult: string;
  rawPayload: string;
}) {
  try {
    await db.insert(cashfreePayoutWebhookLogsTable).values({
      endpoint: params.endpoint,
      eventType: params.eventType ?? undefined,
      status: params.status ?? undefined,
      signatureVerified: params.signatureVerified ?? undefined,
      payoutId: params.payoutId ?? undefined,
      transferId: params.transferId ?? undefined,
      cfTransferId: params.cfTransferId ?? undefined,
      utr: params.utr ?? undefined,
      safeError: params.safeError ?? undefined,
      processingResult: params.processingResult,
      rawPayload: params.rawPayload,
    });
  } catch (err) {
    logger.warn({ err }, "Cashfree payout webhook: failed to insert log");
  }
}

export default router;
