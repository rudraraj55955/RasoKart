import { Router } from "express";
import { db, qrCodesTable, systemConfigTable, SYSTEM_CONFIG_KEYS, ekqrWebhookLogsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { ekqrCheckOrderStatus, ekqrFormatDate } from "../helpers/ekqr";
import { creditEkqrQrPayment } from "../helpers/ekqrCredit";

const router = Router();

/**
 * POST /api/payment/webhook
 *
 * Public endpoint — called by EKQR when a QR payment is confirmed.
 *
 * EKQR delivers webhooks as application/x-www-form-urlencoded.
 * express.urlencoded({ extended: true }) is registered globally in app.ts.
 *
 * Documented EKQR webhook fields (https://ekqr.in portal):
 *   id              — EKQR internal order ID
 *   amount          — paid amount (string, e.g. "100.00")
 *   client_txn_id   — our reference, set at QR creation
 *   createdAt       — order creation timestamp (EKQR side)
 *   customer_email
 *   customer_mobile
 *   customer_name
 *   customer_vpa    — customer UPI VPA
 *   p_info          — payment info / description
 *   redirect_url
 *   remark          — bank/UPI remark
 *   status          — "SUCCESS" | "FAILED" | "PENDING"
 *   txnAt           — transaction timestamp
 *   udf1, udf2, udf3
 *   upi_txn_id      — UPI bank reference / UTR
 *
 * EKQR does NOT issue a webhook secret or HMAC signature.
 * The EKQR_WEBHOOK_SECRET config key is retained for future use but is NOT
 * enforced here — authentication is by client_txn_id matching a known QR.
 *
 * Credit path is in helpers/ekqrCredit.ts (shared with the sync scheduler).
 * See that file for amount verification and idempotency details.
 */
router.post("/webhook", async (req, res) => {
  // express.urlencoded (app.ts line 93) parses the form-encoded body into req.body.
  // JSON.stringify gives a stable log representation regardless of content-type.
  const rawPayload = JSON.stringify(req.body ?? {});
  const body = req.body as Record<string, string>;

  // ── Extract all documented EKQR webhook fields ──────────────────────────────
  const {
    id: ekqrId,           // EKQR internal order ID
    amount,
    client_txn_id,
    /* createdAt: ekqrCreatedAt, */ // logged via rawPayload
    /* customer_email, customer_mobile, customer_name: logged via rawPayload */
    customer_vpa,
    p_info,
    /* redirect_url: logged via rawPayload */
    remark,
    status,
    /* txnAt: logged via rawPayload */
    udf1,
    udf2,
    udf3,
    upi_txn_id,           // UPI bank reference / UTR
  } = body;

  logger.info({ client_txn_id, ekqrId, status, upi_txn_id }, "EKQR payment webhook received");

  // Always acknowledge immediately — EKQR retries on non-2xx.
  res.json({ success: true });

  let processingResult: "credited" | "duplicate" | "ignored" | "error" = "ignored";
  let qrCodeId: number | null = null;
  let merchantId: number | null = null;
  let errorMessage: string | null = null;

  try {
    // ── Load config in one round-trip ─────────────────────────────────────────
    const configRows = await db
      .select({ key: systemConfigTable.key, value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(inArray(systemConfigTable.key, [
        SYSTEM_CONFIG_KEYS.EKQR_ENABLED,
        SYSTEM_CONFIG_KEYS.EKQR_API_KEY,
      ]));
    const cfg = new Map(configRows.map(r => [r.key, r.value]));
    const ekqrEnabled = cfg.get(SYSTEM_CONFIG_KEYS.EKQR_ENABLED) === "true";
    const ekqrApiKey  = cfg.get(SYSTEM_CONFIG_KEYS.EKQR_API_KEY) ?? "";

    // ── Guard: EKQR must be globally enabled ─────────────────────────────────
    if (!ekqrEnabled) {
      logger.warn({ client_txn_id }, "EKQR webhook received but EKQR is disabled — ignoring");
      processingResult = "ignored";
      await log({ client_txn_id: client_txn_id ?? "", ekqrId: ekqrId ?? null, upiTxnId: upi_txn_id ?? null, qrCodeId: null, merchantId: null, status: status ?? null, amount: amount ?? null, rawPayload, processingResult, errorMessage: "EKQR disabled" });
      return;
    }

    // ── Guard: status must be SUCCESS ─────────────────────────────────────────
    if (!status || status.toUpperCase() !== "SUCCESS") {
      logger.info({ client_txn_id, ekqrId, status }, "EKQR webhook: non-SUCCESS status — ignoring");
      processingResult = "ignored";
      await log({ client_txn_id: client_txn_id ?? "", ekqrId: ekqrId ?? null, upiTxnId: upi_txn_id ?? null, qrCodeId: null, merchantId: null, status: status ?? null, amount: amount ?? null, rawPayload, processingResult, errorMessage: "Non-SUCCESS status" });
      return;
    }

    // ── Guard: client_txn_id required ────────────────────────────────────────
    if (!client_txn_id) {
      logger.warn({ rawPayload }, "EKQR webhook: missing client_txn_id");
      processingResult = "error";
      errorMessage = "Missing client_txn_id";
      await log({ client_txn_id: "", ekqrId: ekqrId ?? null, upiTxnId: upi_txn_id ?? null, qrCodeId: null, merchantId: null, status: status ?? null, amount: amount ?? null, rawPayload, processingResult, errorMessage });
      return;
    }

    // ── Locate QR code ────────────────────────────────────────────────────────
    // Primary: ekqrOrderId stored at create-time = our client_txn_id
    // Fallback: parse EKQR-{id} pattern (backward-compat with older QR codes)
    const qr = await resolveQrCode(client_txn_id);

    if (!qr) {
      logger.warn({ client_txn_id, ekqrId }, "EKQR webhook: QR code not found");
      processingResult = "error";
      errorMessage = "QR code not found";
      await log({ client_txn_id, ekqrId: ekqrId ?? null, upiTxnId: upi_txn_id ?? null, qrCodeId: null, merchantId: null, status: status ?? null, amount: amount ?? null, rawPayload, processingResult, errorMessage });
      return;
    }

    qrCodeId  = qr.id;
    merchantId = qr.merchantId;

    // ── Optional: independent server-side confirmation ────────────────────────
    // When EKQR_API_KEY is set, verify the payment via check_order_status before
    // crediting. A non-SUCCESS API response aborts the credit. A transient
    // network / timeout failure is logged and the webhook is trusted (we should
    // not block legitimate credits on API unavailability).
    let confirmedUpiTxnId = upi_txn_id;
    if (ekqrApiKey) {
      try {
        const txnDate = ekqrFormatDate(new Date(qr.createdAt));
        const { parsed: statusResp } = await ekqrCheckOrderStatus(ekqrApiKey, client_txn_id, txnDate);

        if (statusResp.status === true && statusResp.data) {
          const confirmedStatus = (statusResp.data.status ?? "").toUpperCase();
          if (confirmedStatus !== "SUCCESS") {
            logger.warn({ client_txn_id, ekqrId, confirmedStatus }, "EKQR check_order_status: not SUCCESS — aborting credit");
            processingResult = "ignored";
            errorMessage = `check_order_status returned: ${confirmedStatus}`;
            await log({ client_txn_id, ekqrId: ekqrId ?? null, upiTxnId: upi_txn_id ?? null, qrCodeId: qr.id, merchantId: qr.merchantId, status: status ?? null, amount: amount ?? null, rawPayload, processingResult, errorMessage });
            return;
          }
          // Use API upi_txn_id if webhook didn't carry one
          if (statusResp.data.upi_txn_id && !confirmedUpiTxnId) {
            confirmedUpiTxnId = statusResp.data.upi_txn_id;
          }
        } else {
          logger.warn({ client_txn_id, ekqrId, msg: statusResp.msg }, "EKQR check_order_status: status=false — proceeding with webhook");
        }
      } catch (checkErr) {
        logger.warn({ checkErr, client_txn_id }, "EKQR check_order_status: call failed — proceeding with webhook data");
      }
    }

    // ── Build rich metadata payload ───────────────────────────────────────────
    // Stores all documented EKQR fields so nothing is lost; the metadata column
    // accepts a JSON string (see transactions schema).
    const metadataJson = JSON.stringify({
      ekqrId:          ekqrId          ?? null,
      upi_txn_id:      confirmedUpiTxnId ?? null,
      customer_vpa:    customer_vpa    ?? null,
      customer_name:   body["customer_name"]   ?? null,
      customer_email:  body["customer_email"]  ?? null,
      customer_mobile: body["customer_mobile"] ?? null,
      remark:          remark          ?? null,
      txnAt:           body["txnAt"]   ?? null,
      udf1:            udf1            ?? null,
      udf2:            udf2            ?? null,
      udf3:            udf3            ?? null,
    });

    // ── Credit ────────────────────────────────────────────────────────────────
    const creditResult = await creditEkqrQrPayment({
      qr,
      amount,
      upiTxnId: confirmedUpiTxnId,
      ekqrId:   ekqrId ?? null,
      rawPayload: metadataJson,
      pInfo:    p_info ?? qr.label ?? "QR Payment",
    });

    processingResult = creditResult.processingResult;
    errorMessage     = creditResult.errorMessage;

    await log({ client_txn_id, ekqrId: ekqrId ?? null, upiTxnId: confirmedUpiTxnId ?? null, qrCodeId: qr.id, merchantId: qr.merchantId, status: status ?? null, amount: amount ?? null, rawPayload, processingResult, errorMessage });

  } catch (err) {
    processingResult = "error";
    errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err, client_txn_id, ekqrId }, "EKQR webhook: unhandled processing error");
    await log({ client_txn_id: client_txn_id ?? "", ekqrId: ekqrId ?? null, upiTxnId: upi_txn_id ?? null, qrCodeId, merchantId, status: status ?? null, amount: amount ?? null, rawPayload, processingResult: "error", errorMessage }).catch(() => {});
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveQrCode(clientTxnId: string) {
  // Primary: match by ekqrOrderId (the client_txn_id we sent at create-order time)
  const [byOrderId] = await db
    .select()
    .from(qrCodesTable)
    .where(eq(qrCodesTable.ekqrOrderId, clientTxnId))
    .limit(1);
  if (byOrderId) return byOrderId;

  // Fallback: EKQR-{numericId} pattern used by older QR codes
  const match = /^EKQR-(\d+)$/.exec(clientTxnId);
  if (!match) return null;
  const [byId] = await db
    .select()
    .from(qrCodesTable)
    .where(and(
      eq(qrCodesTable.id, parseInt(match[1])),
    ))
    .limit(1);
  return byId ?? null;
}

async function log(params: {
  client_txn_id: string;
  ekqrId: string | null;
  upiTxnId: string | null;
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
      clientTxnId:      params.client_txn_id,
      ekqrId:           params.ekqrId     ?? undefined,
      upiTxnId:         params.upiTxnId   ?? undefined,
      qrCodeId:         params.qrCodeId   ?? undefined,
      merchantId:       params.merchantId ?? undefined,
      status:           params.status     ?? undefined,
      amount:           params.amount     ?? undefined,
      rawPayload:       params.rawPayload,
      processingResult: params.processingResult,
      errorMessage:     params.errorMessage ?? undefined,
    });
  } catch (err) {
    logger.warn({ err }, "EKQR webhook: failed to insert webhook log");
  }
}

export default router;
