import { Router } from "express";
import { db, qrCodesTable, transactionsTable, qrPaymentEventsTable, merchantsTable, systemConfigTable, SYSTEM_CONFIG_KEYS, ekqrWebhookLogsTable, callbackLogsTable, callbackLogAttemptsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import { ekqrClientTxnId } from "../helpers/ekqr";

const router = Router();

/**
 * POST /api/payment/webhook
 *
 * Public endpoint — called by EKQR when a payment is confirmed.
 * Verifies the client_txn_id maps to a known QR code, marks it as used,
 * creates a pending deposit transaction, and fires the merchant callback.
 *
 * EKQR webhook payload (documented at https://ekqr.in):
 *   { client_txn_id, amount, status, upi_txn_id, txn_id,
 *     p_info, customer_name, customer_email, customer_mobile }
 *
 * status values: SUCCESS | FAILED | PENDING
 */
router.post("/", async (req, res) => {
  const raw = JSON.stringify(req.body);
  const body = req.body as Record<string, string>;

  const { client_txn_id, amount, status, upi_txn_id, txn_id } = body;

  req.log.info({ client_txn_id, status }, "EKQR payment webhook received");

  // Always acknowledge immediately so EKQR doesn't retry
  res.json({ success: true });

  let processingResult: "credited" | "duplicate" | "ignored" | "error" = "ignored";
  let qrCodeId: number | null = null;
  let merchantId: number | null = null;
  let errorMessage: string | null = null;

  try {
    // Guard: EKQR must be enabled
    const [ekqrEnabledRow] = await db
      .select({ value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.EKQR_ENABLED))
      .limit(1);

    if (ekqrEnabledRow?.value !== "true") {
      logger.warn({ client_txn_id }, "EKQR webhook received but EKQR is disabled — ignoring");
      processingResult = "ignored";
      await insertWebhookLog({ clientTxnId: client_txn_id ?? "", qrCodeId: null, merchantId: null, status: status ?? null, amount: amount ?? null, rawPayload: raw, processingResult, errorMessage: "EKQR disabled" });
      return;
    }

    // Only credit on success
    if (!status || status.toUpperCase() !== "SUCCESS") {
      logger.info({ client_txn_id, status }, "EKQR webhook: non-success status — ignoring");
      processingResult = "ignored";
      await insertWebhookLog({ clientTxnId: client_txn_id ?? "", qrCodeId: null, merchantId: null, status: status ?? null, amount: amount ?? null, rawPayload: raw, processingResult, errorMessage: "Non-success status" });
      return;
    }

    if (!client_txn_id) {
      logger.warn({ body }, "EKQR webhook: missing client_txn_id");
      processingResult = "ignored";
      await insertWebhookLog({ clientTxnId: "", qrCodeId: null, merchantId: null, status: status ?? null, amount: amount ?? null, rawPayload: raw, processingResult, errorMessage: "Missing client_txn_id" });
      return;
    }

    // Locate the QR code by ekqrOrderId (stored as our client_txn_id)
    const [qr] = await db
      .select()
      .from(qrCodesTable)
      .where(eq(qrCodesTable.ekqrOrderId, client_txn_id))
      .limit(1);

    if (!qr) {
      // Fallback: try parsing qr code ID from client_txn_id pattern "EKQR-{id}"
      const match = /^EKQR-(\d+)$/.exec(client_txn_id);
      if (match) {
        const qrId = parseInt(match[1]);
        const [byId] = await db
          .select()
          .from(qrCodesTable)
          .where(and(eq(qrCodesTable.id, qrId), eq(qrCodesTable.status, "active")))
          .limit(1);
        if (!byId) {
          logger.warn({ client_txn_id }, "EKQR webhook: QR code not found or already used");
          processingResult = "ignored";
          await insertWebhookLog({ clientTxnId: client_txn_id, qrCodeId: qrId, merchantId: null, status: status ?? null, amount: amount ?? null, rawPayload: raw, processingResult, errorMessage: "QR code not found or already used" });
          return;
        }
        const result = await processEkqrPayment(byId, amount, upi_txn_id, txn_id, raw, body);
        qrCodeId = byId.id;
        merchantId = byId.merchantId;
        processingResult = result.processingResult;
        errorMessage = result.errorMessage;
      } else {
        logger.warn({ client_txn_id }, "EKQR webhook: could not resolve QR code");
        processingResult = "ignored";
        await insertWebhookLog({ clientTxnId: client_txn_id, qrCodeId: null, merchantId: null, status: status ?? null, amount: amount ?? null, rawPayload: raw, processingResult, errorMessage: "Could not resolve QR code" });
        return;
      }
    } else {
      qrCodeId = qr.id;
      merchantId = qr.merchantId;
      const result = await processEkqrPayment(qr, amount, upi_txn_id, txn_id, raw, body);
      processingResult = result.processingResult;
      errorMessage = result.errorMessage;
    }

    await insertWebhookLog({ clientTxnId: client_txn_id, qrCodeId, merchantId, status: status ?? null, amount: amount ?? null, rawPayload: raw, processingResult, errorMessage });

  } catch (err) {
    logger.error({ err, client_txn_id }, "EKQR webhook processing error");
    processingResult = "error";
    errorMessage = err instanceof Error ? err.message : String(err);
    try {
      await insertWebhookLog({ clientTxnId: client_txn_id ?? "", qrCodeId, merchantId, status: status ?? null, amount: amount ?? null, rawPayload: raw, processingResult: "error", errorMessage });
    } catch (logErr) {
      logger.warn({ logErr }, "EKQR webhook: failed to insert webhook log after error");
    }
  }
});

async function insertWebhookLog(params: {
  clientTxnId: string;
  qrCodeId: number | null;
  merchantId: number | null;
  status: string | null;
  amount: string | null;
  rawPayload: string;
  processingResult: "credited" | "duplicate" | "ignored" | "error";
  errorMessage: string | null;
}) {
  try {
    await db.insert(ekqrWebhookLogsTable).values({
      clientTxnId: params.clientTxnId,
      qrCodeId: params.qrCodeId ?? undefined,
      merchantId: params.merchantId ?? undefined,
      status: params.status ?? undefined,
      amount: params.amount ?? undefined,
      rawPayload: params.rawPayload,
      processingResult: params.processingResult,
      errorMessage: params.errorMessage ?? undefined,
    });
  } catch (err) {
    logger.warn({ err }, "EKQR webhook: failed to insert webhook log");
  }
}

async function processEkqrPayment(
  qr: typeof qrCodesTable.$inferSelect,
  amount: string | undefined,
  upiTxnId: string | undefined,
  ekqrTxnId: string | undefined,
  rawPayload: string,
  body: Record<string, string>,
): Promise<{ processingResult: "credited" | "duplicate" | "ignored" | "error"; errorMessage: string | null }> {
  if (qr.status !== "active") {
    logger.info({ qrId: qr.id, status: qr.status }, "EKQR webhook: QR code already processed");
    return { processingResult: "ignored", errorMessage: `QR already in state: ${qr.status}` };
  }

  const paidAmount = amount ?? qr.amount ?? "0";

  // Mark QR as used
  await db
    .update(qrCodesTable)
    .set({ status: "used" })
    .where(eq(qrCodesTable.id, qr.id));

  // Generate a unique UTR: prefer upiTxnId, else use ekqrTxnId, else generate one
  const utr = upiTxnId || ekqrTxnId || `EKQR-${qr.id}-${Date.now()}`;

  // Insert a deposit transaction (auto-credit the merchant)
  const [tx] = await db.insert(transactionsTable).values({
    merchantId: qr.merchantId,
    qrCodeId: qr.id,
    provider: "ekqr",
    type: "deposit",
    status: "success",
    amount: paidAmount,
    currency: "INR",
    utr,
    referenceId: ekqrTxnId ?? null,
    description: `EKQR payment — ${body["p_info"] ?? qr.label ?? "QR Payment"}`,
    metadata: rawPayload,
  }).returning().catch((err: unknown) => {
    const isDuplicate = err instanceof Error && err.message.includes("unique");
    logger.warn({ err, utr }, "EKQR webhook: failed to insert transaction (possible duplicate UTR)");
    if (isDuplicate) return [{ __duplicate: true }] as any;
    return [] as (typeof transactionsTable.$inferSelect)[];
  });

  if ((tx as any)?.__duplicate) {
    return { processingResult: "duplicate", errorMessage: `Duplicate UTR: ${utr}` };
  }

  // Record a QR payment event
  db.insert(qrPaymentEventsTable).values({
    qrCodeId: qr.id,
    merchantId: qr.merchantId,
    transactionId: tx?.id ?? null,
    amount: paidAmount,
    orderId: qr.orderId ?? null,
    merchantReference: qr.merchantReference ?? null,
  }).catch((err: unknown) => {
    logger.warn({ err, qrId: qr.id }, "EKQR webhook: failed to insert qr_payment_event");
  });

  logger.info({ qrId: qr.id, merchantId: qr.merchantId, amount: paidAmount, utr }, "EKQR payment credited");

  // Fire merchant's callbackUrl if configured
  if (qr.callbackUrl) {
    const callbackPayload = JSON.stringify({
      event: "payment.received",
      provider: "ekqr",
      qrCodeId: qr.id,
      merchantId: qr.merchantId,
      orderId: qr.orderId ?? null,
      merchantReference: qr.merchantReference ?? null,
      amount: paidAmount,
      utr,
      ekqrTxnId: ekqrTxnId ?? null,
      upiTxnId: upiTxnId ?? null,
      status: "success",
    });

    let httpStatus: number | null = null;
    let responseBody: string | null = null;

    try {
      const callbackRes = await fetch(qr.callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: callbackPayload,
      });
      httpStatus = callbackRes.status;
      responseBody = await callbackRes.text().catch(() => null);
    } catch (err: unknown) {
      logger.warn({ err, callbackUrl: qr.callbackUrl, qrId: qr.id }, "EKQR webhook: merchant callbackUrl fire failed");
      responseBody = err instanceof Error ? err.message : String(err);
    }

    const callbackStatus = httpStatus != null && httpStatus >= 200 && httpStatus < 300 ? "success" : "failed";

    // Log outgoing callback to callback_logs
    try {
      const [cbLog] = await db.insert(callbackLogsTable).values({
        merchantId: qr.merchantId,
        qrCodeId: qr.id,
        transactionId: tx?.id ?? null,
        url: qr.callbackUrl,
        status: callbackStatus,
        httpStatus,
        requestBody: callbackPayload,
        responseBody,
        attempts: 1,
        lastAttemptAt: new Date(),
        eventType: "payment.received",
      }).returning();

      if (cbLog) {
        await db.insert(callbackLogAttemptsTable).values({
          callbackLogId: cbLog.id,
          attemptNumber: 1,
          httpStatus,
          responseBody,
        });
      }
    } catch (logErr: unknown) {
      logger.warn({ logErr, qrId: qr.id }, "EKQR webhook: failed to insert callback log");
    }
  }

  return { processingResult: "credited", errorMessage: null };
}

export { processEkqrPayment };

export default router;
