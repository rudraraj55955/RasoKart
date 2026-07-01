import { Router } from "express";
import { db, cashfreePayoutsTable, cashfreePayoutWebhookLogsTable, systemConfigTable, SYSTEM_CONFIG_KEYS } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { logger } from "../lib/logger";
import { verifyCashfreeWebhookSignature } from "../helpers/cashfree";
import { normalizeCashfreePayoutStatus } from "../helpers/cashfreePayout";

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
    const [secretRow] = await db
      .select({ value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_WEBHOOK_SECRET))
      .limit(1);

    const webhookSecret = secretRow?.value ?? "";

    if (!webhookSecret) {
      // Fail-closed: log the event but perform NO state mutations without a verified origin.
      // Return 200 so Cashfree does not retry — configure the secret to enable full processing.
      logger.warn({ endpoint }, "Cashfree payout webhook received but CASHFREE_PAYOUT_WEBHOOK_SECRET is not configured — skipping all state mutations");
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

    const valid = verifyCashfreeWebhookSignature(rawBody, timestamp ?? "", signature ?? "", webhookSecret);
    signatureVerified = valid;
    if (!valid) {
      logger.warn({ endpoint, timestamp, hasSignature: !!signature }, "Cashfree payout webhook rejected: invalid signature");
      await insertLog({ endpoint, eventType: null, status: null, signatureVerified: false, payoutId: null, transferId: null, cfTransferId: null, utr: null, safeError: "Invalid webhook signature", processingResult: "rejected", rawPayload: rawBody });
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

    // ── Find the matching payout in our DB ────────────────────────────────
    const conditions = [];
    if (transferId) conditions.push(eq(cashfreePayoutsTable.transferId, transferId));
    if (cfTransferId) conditions.push(eq(cashfreePayoutsTable.cashfreeTransferId, cfTransferId));

    const [payout] = conditions.length > 0
      ? await db.select().from(cashfreePayoutsTable).where(or(...conditions)).limit(1)
      : [];

    if (!payout) {
      logger.warn({ endpoint, transferId, cfTransferId }, "Cashfree payout webhook: matching payout not found in DB");
      processingResult = "unmatched";
      safeError = "Payout record not found";
      await insertLog({ endpoint, eventType, status: statusRaw, signatureVerified, payoutId: null, transferId, cfTransferId, utr, safeError, processingResult, rawPayload: rawBody });
      return;
    }

    payoutId = payout.id;
    const normalizedStatus = normalizeCashfreePayoutStatus(statusRaw);

    // ── Update payout status, UTR (on success), failure reason (on failed) ──
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

      await db.update(cashfreePayoutsTable)
        .set(finalSet)
        .where(eq(cashfreePayoutsTable.id, payout.id));

      logger.info({ endpoint, payoutId: payout.id, transferId, oldStatus: payout.status, newStatus: normalizedStatus, utr }, "Cashfree payout status updated via webhook");
    }

    processingResult = "processed";
    await insertLog({ endpoint, eventType, status: normalizedStatus, signatureVerified, payoutId: payout.id, transferId, cfTransferId, utr, safeError: null, processingResult, rawPayload: rawBody });

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
