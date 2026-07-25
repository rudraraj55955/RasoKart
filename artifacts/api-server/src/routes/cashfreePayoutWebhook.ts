import { Router } from "express";
import { db, cashfreePayoutsTable, cashfreePayoutWebhookLogsTable, systemConfigTable, SYSTEM_CONFIG_KEYS, withdrawalsTable } from "@workspace/db";
import { and, eq, inArray, or } from "drizzle-orm";
import { logger } from "../lib/logger";
import { verifyCashfreeWebhookSignature } from "../helpers/cashfree";
import { normalizeCashfreePayoutStatus } from "../helpers/cashfreePayout";
import { mutateWallet } from "./wallets";
import { decryptSecret } from "../helpers/cryptoUtils";

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
 * Signature verification:
 *   HMAC-SHA256(timestamp + rawBody, payoutClientSecret) → base64
 *   Headers (Express lowercases all headers automatically):
 *     x-webhook-signature  — base64-encoded HMAC
 *     x-webhook-timestamp  — Unix epoch seconds as string
 *
 * Secret selection (single secret per environment — NO multi-secret fallback):
 *   - `cashfree_payout_webhook_secret` (admin-configured, decrypted) if non-empty
 *   - Otherwise: `cashfree_payout_client_secret` (decrypted) — the Cashfree
 *     Payout Live Client Secret for live env, Sandbox Client Secret for test env
 *   In production (env=live) ONLY the live credential is ever used.
 *   This matches the Cashfree Payout V2 webhook signing contract.
 *
 * Raw body:
 *   Captured by the global express.json `verify` callback in app.ts before
 *   JSON.parse() runs. The exact original UTF-8 bytes are used for verification.
 *   Fallback to JSON.stringify(req.body) only if rawBody is absent (should never
 *   happen when Content-Type: application/json is set by Cashfree).
 *
 * On valid signature  → HTTP 200 immediately; event processed idempotently.
 * On invalid signature → HTTP 401; rejection logged; no state mutations.
 * Secret not configured → HTTP 200; log with warning; NO state mutations.
 */
router.post("/", async (req, res) => {
  const endpoint = req.originalUrl.split("?")[0] ?? "/api/cashfree-payout/webhook";

  // ── Raw body ───────────────────────────────────────────────────────────────
  // req.rawBody is set by the express.json verify callback in app.ts.
  // It captures the exact bytes before JSON.parse(), so signature verification
  // uses the original wire bytes — never a JSON.stringify reconstruction.
  const rawBodyBuf = (req as any).rawBody as Buffer | undefined;
  const rawBody = rawBodyBuf?.toString("utf8") ?? JSON.stringify(req.body);
  const rawBodyBytes = rawBodyBuf?.length ?? Buffer.byteLength(rawBody, "utf8");

  // ── Headers — Express normalises all incoming header names to lowercase ────
  const signature = (req.headers["x-webhook-signature"] as string | undefined) ?? "";
  const timestamp = (req.headers["x-webhook-timestamp"] as string | undefined) ?? "";

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
    // ── Load config: env + both candidate secrets ─────────────────────────────
    const cfgRows = await db
      .select({ key: systemConfigTable.key, value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(
        inArray(systemConfigTable.key, [
          SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENV,
          SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_WEBHOOK_SECRET,
          SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_SECRET,
        ])
      );
    const cfgMap = new Map(cfgRows.map(r => [r.key, r.value ?? ""]));

    const payoutEnv = (cfgMap.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENV) ?? "test").toLowerCase();
    const isLive = payoutEnv === "live";

    // Decrypt stored secrets — values are AES-256-GCM encrypted by encryptSecret().
    // Plain-text values (stored before encryption was introduced) are returned as-is.
    const rawWebhookSecret = cfgMap.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_WEBHOOK_SECRET) ?? "";
    const rawClientSecret  = cfgMap.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_SECRET) ?? "";

    const decryptedWebhookSecret = rawWebhookSecret
      ? (decryptSecret(rawWebhookSecret).ok ? (decryptSecret(rawWebhookSecret) as { ok: true; value: string }).value : "")
      : "";
    const decryptClientResult = rawClientSecret ? decryptSecret(rawClientSecret) : { ok: true as const, value: "" };
    const decryptedClientSecret = decryptClientResult.ok ? decryptClientResult.value : "";

    // ── Single-secret selection — NO multi-secret fallback ────────────────────
    // Use the dedicated webhook secret when non-empty; otherwise the client secret.
    // In production (live) this MUST be the Live Payout credential — never sandbox.
    // The admin-saved `cashfree_payout_client_secret` corresponds to the live
    // credential when env=live, sandbox credential when env=test.
    const activeSecret = decryptedWebhookSecret || decryptedClientSecret;

    // Safe fingerprint for logs — last 4 chars of the secret actually used.
    const secretFingerprint = activeSecret.length >= 4
      ? `...${activeSecret.slice(-4)}`
      : activeSecret.length > 0 ? "****" : "(none)";

    // Diagnostic log — header presence, body size, environment, credential fingerprint.
    // Never logs the secret value or full signature.
    logger.info(
      {
        endpoint,
        env: isLive ? "LIVE" : "SANDBOX",
        hasTimestamp: !!timestamp,
        hasSignature: !!signature,
        rawBodyBytes,
        secretConfigured: !!activeSecret,
        secretFingerprint,
        usingWebhookSecret: !!decryptedWebhookSecret,
      },
      "cashfree_payout_webhook_received"
    );

    if (!activeSecret) {
      // Fail-closed: no secret configured — log event but perform NO state mutations.
      // Return 200 so Cashfree does not retry. Configure the secret to enable processing.
      logger.warn({ endpoint, env: isLive ? "LIVE" : "SANDBOX" }, "cashfree_payout_webhook_no_secret_configured — skipping all state mutations");
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
      await insertLog({ endpoint, eventType, status: statusRaw, signatureVerified: null, payoutId: null, transferId, cfTransferId, utr, safeError: "No secret configured — webhook received without signature verification", processingResult, rawPayload: rawBody });
      return;
    }

    // ── Signature verification — single secret, no fallback ──────────────────
    // Cashfree Payout V2:  HMAC-SHA256(timestamp + rawBody, secret) → base64
    // Both header names are lowercase here because Express lowercases all headers.
    const valid = verifyCashfreeWebhookSignature(rawBody, timestamp, signature, activeSecret);

    signatureVerified = valid;
    if (!valid) {
      logger.warn(
        {
          endpoint,
          env: isLive ? "LIVE" : "SANDBOX",
          hasTimestamp: !!timestamp,
          hasSignature: !!signature,
          rawBodyBytes,
          secretFingerprint,
          usingWebhookSecret: !!decryptedWebhookSecret,
        },
        "cashfree_payout_webhook_signature_mismatch"
      );
      await insertLog({ endpoint, eventType: null, status: null, signatureVerified: false, payoutId: null, transferId: null, cfTransferId: null, utr: null, safeError: "webhook.signature_mismatch", processingResult: "rejected", rawPayload: rawBody });
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }

    logger.info({ endpoint, env: isLive ? "LIVE" : "SANDBOX", secretFingerprint }, "cashfree_payout_webhook_signature_valid");

    // Acknowledge immediately — Cashfree expects 200 within a short timeout
    res.status(200).json({ ok: true, received: true });

    // ── Parse Cashfree Payout V2 webhook payload ──────────────────────────────
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

    logger.info({ endpoint, eventType, transferId, cfTransferId, status: statusRaw }, "cashfree_payout_webhook_event");

    // ── TEST / ping events — just acknowledge ─────────────────────────────────
    const evtUpper = (eventType ?? "").toUpperCase();
    if (!eventType || evtUpper === "TEST" || evtUpper === "WEBHOOK_TEST" || (!transferId && !cfTransferId)) {
      processingResult = "ignored";
      await insertLog({ endpoint, eventType, status: statusRaw, signatureVerified, payoutId: null, transferId, cfTransferId, utr, safeError: null, processingResult, rawPayload: rawBody });
      return;
    }

    const normalizedStatus = normalizeCashfreePayoutStatus(statusRaw);

    // ── Look up both tables in parallel ──────────────────────────────────────
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
      logger.warn({ endpoint, transferId, cfTransferId }, "cashfree_payout_webhook_record_not_found");
      processingResult = "unmatched";
      safeError = "Payout record not found";
      await insertLog({ endpoint, eventType, status: statusRaw, signatureVerified, payoutId: null, transferId, cfTransferId, utr, safeError, processingResult, rawPayload: rawBody });
      return;
    }

    // ── Update cashfreePayoutsTable (legacy path) ─────────────────────────────
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
        logger.info({ endpoint, payoutId: payout.id, transferId, oldStatus: payout.status, newStatus: normalizedStatus, utr }, "cashfree_payout_status_updated_via_webhook");
      }
    }

    // ── Update withdrawalsTable + wallet mutations ─────────────────────────────
    // Primary path for merchant withdrawal payouts.
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

      // Idempotent guard — WHERE clause on current transferStatus prevents
      // concurrent webhook deliveries from double-updating the same withdrawal.
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

        // Wallet mutations — only executed once per state transition (idempotency
        // enforced by the conditional WHERE above).
        if (normalizedStatus === "SUCCESS") {
          if (["FAILED", "REVERSED"].includes(prevTransferStatus)) {
            await mutateWallet(
              withdrawal.merchantId,
              { availableDelta: -wAmt, totalPayoutDelta: wAmt, totalReversalsDelta: -wAmt },
              { txnType: "payout_success_correction", bucket: "available", amount: -wAmt, referenceType: "withdrawal", referenceId: withdrawal.id, description: `Payout #${withdrawal.id} — provider SUCCESS via webhook (was locally ${prevTransferStatus}) — ₹${wAmt} corrected`, createdBy: null }
            );
          } else {
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
    await insertLog({ endpoint, eventType, status: normalizedStatus, signatureVerified, payoutId, transferId, cfTransferId, utr, safeError: null, processingResult, rawPayload: rawBody });

  } catch (err) {
    logger.error({ err, endpoint, transferId, eventType }, "cashfree_payout_webhook_processing_error");
    processingResult = "error";
    safeError = "Internal processing error";
    try {
      await insertLog({ endpoint, eventType, status: statusRaw, signatureVerified, payoutId, transferId, cfTransferId, utr, safeError, processingResult: "error", rawPayload: rawBody });
    } catch (logErr) {
      logger.warn({ logErr }, "cashfree_payout_webhook_log_insert_failed");
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
    logger.warn({ err }, "cashfree_payout_webhook_log_insert_failed");
  }
}

export default router;
