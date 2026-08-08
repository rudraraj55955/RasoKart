/**
 * Shared EKQR QR-code credit logic.
 *
 * Called by both the webhook handler (paymentWebhook.ts) and the
 * auto-sync scheduler (ekqrSyncScheduler.ts). Extracted here to avoid
 * a routes/ → helpers/ import cycle and to keep the credit path DRY.
 *
 * Idempotency: atomic UPDATE qr_codes SET status='used'
 * WHERE id=? AND status='active'. Zero rows → already credited → "duplicate".
 * UTR uniqueness constraint provides a second DB-level backstop.
 */

import { db, qrCodesTable, transactionsTable, qrPaymentEventsTable, callbackLogsTable, callbackLogAttemptsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";

export interface CreditEkqrQrParams {
  /** Full QR code row (already fetched; must be status='active' or we return 'duplicate'). */
  qr: typeof qrCodesTable.$inferSelect;
  /** Paid amount from the webhook/check_order_status response. */
  amount: string | undefined;
  /** UPI bank reference / UTR from webhook or check_order_status (upi_txn_id). */
  upiTxnId: string | undefined;
  /**
   * EKQR internal order ID (the `id` field in the webhook payload).
   * Used as referenceId in the transaction and as UTR fallback.
   * May be null when called from the sync scheduler (check_order_status doesn't return it).
   */
  ekqrId: string | null | undefined;
  /** Raw payload string to store in transaction.metadata. */
  rawPayload: string;
  /** Payment info / description for the transaction (p_info or a fallback). */
  pInfo?: string;
}

export interface CreditEkqrQrResult {
  processingResult: "credited" | "duplicate" | "ignored" | "error";
  errorMessage: string | null;
  txId: number | null;
  utr: string | null;
}

/**
 * Atomically claim an active EKQR QR code and credit the merchant.
 *
 * Amount guard: for fixed-amount QRs the agreed qr.amount is used instead
 * of the callback amount to prevent manipulation. For dynamic QRs the
 * callback amount is accepted.
 *
 * Does NOT call check_order_status — callers are responsible for any
 * pre-flight verification before invoking this function.
 */
export async function creditEkqrQrPayment(params: CreditEkqrQrParams): Promise<CreditEkqrQrResult> {
  const { qr, amount, upiTxnId, ekqrId, rawPayload, pInfo } = params;

  // Fast-path: already processed (non-atomic check; the atomic UPDATE below
  // is the real idempotency guard)
  if (qr.status !== "active") {
    logger.info({ qrId: qr.id, qrStatus: qr.status }, "ekqrCredit: QR already processed — skipping");
    return { processingResult: "duplicate", errorMessage: `QR already in state: ${qr.status}`, txId: null, utr: null };
  }

  // Amount to credit: for fixed-amount QRs always use our agreed amount.
  let creditAmount: string;
  if (qr.amount != null) {
    const expectedAmt = parseFloat(qr.amount);
    const webhookAmt  = parseFloat(amount ?? "0");
    if (Math.abs(expectedAmt - webhookAmt) > 0.01) {
      logger.warn({ qrId: qr.id, expectedAmt, webhookAmt }, "ekqrCredit: amount mismatch — crediting agreed QR amount");
    }
    creditAmount = qr.amount;
  } else {
    creditAmount = amount ?? "0";
  }

  // Atomic claim + insert — all inside one transaction
  const result = await db.transaction(async (trx) => {
    // Single UPDATE: if another request already flipped status, zero rows return → duplicate
    const [claimed] = await trx
      .update(qrCodesTable)
      .set({ status: "used", updatedAt: new Date() })
      .where(and(
        eq(qrCodesTable.id, qr.id),
        eq(qrCodesTable.status, "active"),
      ))
      .returning({ id: qrCodesTable.id });

    if (!claimed) {
      return { credited: false, reason: "concurrent duplicate" as const, txId: null, utr: null };
    }

    // UTR priority: UPI bank reference > EKQR internal id > deterministic surrogate
    const utr = upiTxnId?.trim() || ekqrId?.trim() || `EKQR-${qr.id}-${Date.now()}`;

    const [tx] = await trx.insert(transactionsTable).values({
      merchantId:  qr.merchantId,
      qrCodeId:    qr.id,
      provider:    "ekqr",
      type:        "deposit",
      status:      "success",
      amount:      creditAmount,
      currency:    "INR",
      utr,
      referenceId: ekqrId ?? null,
      description: `EKQR payment — ${pInfo ?? qr.label ?? "QR Payment"}`,
      metadata:    rawPayload,
    }).returning().catch((err: unknown) => {
      const isDupe = err instanceof Error && err.message.includes("unique");
      if (isDupe) {
        logger.warn({ utr, qrId: qr.id }, "ekqrCredit: UTR unique constraint — duplicate");
        return [{ __duplicate: true }] as any;
      }
      throw err;
    });

    if ((tx as any)?.__duplicate) {
      return { credited: false, reason: "duplicate UTR" as const, txId: null, utr };
    }

    return { credited: true, txId: tx?.id ?? null, utr };
  });

  if (!result.credited) {
    logger.info({ qrId: qr.id, reason: result.reason }, "ekqrCredit: not credited");
    return { processingResult: "duplicate", errorMessage: result.reason ?? "Duplicate", txId: null, utr: result.utr ?? null };
  }

  logger.info({ qrId: qr.id, merchantId: qr.merchantId, utr: result.utr, amount: creditAmount }, "ekqrCredit: payment credited");

  // QR payment event — best-effort, never blocks the credit
  db.insert(qrPaymentEventsTable).values({
    qrCodeId:          qr.id,
    merchantId:        qr.merchantId,
    transactionId:     result.txId ?? null,
    amount:            creditAmount,
    orderId:           qr.orderId           ?? null,
    merchantReference: qr.merchantReference ?? null,
  }).catch((err: unknown) => {
    logger.warn({ err, qrId: qr.id }, "ekqrCredit: failed to insert qr_payment_event");
  });

  // Fire merchant callbackUrl — best-effort
  if (qr.callbackUrl) {
    void fireMerchantCallback(qr, result.txId, creditAmount, upiTxnId, ekqrId ?? undefined);
  }

  return { processingResult: "credited", errorMessage: null, txId: result.txId, utr: result.utr };
}

async function fireMerchantCallback(
  qr: typeof qrCodesTable.$inferSelect,
  txId: number | null,
  amount: string,
  upiTxnId: string | undefined,
  ekqrId: string | undefined,
) {
  const callbackPayload = JSON.stringify({
    event:             "payment.received",
    provider:          "ekqr",
    qrCodeId:          qr.id,
    merchantId:        qr.merchantId,
    orderId:           qr.orderId           ?? null,
    merchantReference: qr.merchantReference ?? null,
    amount,
    utr:               upiTxnId ?? ekqrId  ?? null,
    ekqrId:            ekqrId              ?? null,
    upiTxnId:          upiTxnId            ?? null,
    status:            "success",
  });

  let httpStatus: number | null = null;
  let responseBody: string | null = null;

  try {
    const callbackRes = await fetch(qr.callbackUrl!, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    callbackPayload,
    });
    httpStatus   = callbackRes.status;
    responseBody = await callbackRes.text().catch(() => null);
  } catch (err: unknown) {
    logger.warn({ err, callbackUrl: qr.callbackUrl, qrId: qr.id }, "ekqrCredit: merchant callbackUrl fire failed");
    responseBody = err instanceof Error ? err.message : String(err);
  }

  const callbackStatus = httpStatus != null && httpStatus >= 200 && httpStatus < 300 ? "success" : "failed";

  try {
    const [cbLog] = await db.insert(callbackLogsTable).values({
      merchantId:    qr.merchantId,
      qrCodeId:      qr.id,
      transactionId: txId,
      url:           qr.callbackUrl!,
      status:        callbackStatus,
      httpStatus,
      requestBody:   callbackPayload,
      responseBody,
      attempts:      1,
      lastAttemptAt: new Date(),
      eventType:     "payment.received",
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
    logger.warn({ logErr, qrId: qr.id }, "ekqrCredit: failed to insert callback log");
  }
}
