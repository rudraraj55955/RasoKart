import { Router } from "express";
import { db, razorpayPaymentOrdersTable, razorpayWebhookLogsTable, merchantWalletsTable, walletLedgerTable, transactionsTable, systemConfigTable, SYSTEM_CONFIG_KEYS, RAZORPAY_ORDER_STATUS } from "@workspace/db";
import { eq, and, inArray, sql, ne } from "drizzle-orm";
import { razorpayCreateOrder, razorpayFetchPayment, verifyRazorpaySignature } from "../helpers/razorpay";
import { requireAuth } from "../middlewares/auth";

const router = Router();

function getRazorpayCreds(): { keyId: string; keySecret: string } | null {
  const keyId = process.env["RAZORPAY_KEY_ID"] ?? "";
  const keySecret = process.env["RAZORPAY_KEY_SECRET"] ?? "";
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret };
}

async function loadRazorpayConfig(): Promise<{
  enabled: boolean;
  minAmount: number;
  maxAmount: number;
  dailyLimit: number;
}> {
  const keys = [
    SYSTEM_CONFIG_KEYS.RAZORPAY_ENABLED,
    SYSTEM_CONFIG_KEYS.RAZORPAY_MIN_AMOUNT,
    SYSTEM_CONFIG_KEYS.RAZORPAY_MAX_AMOUNT,
    SYSTEM_CONFIG_KEYS.RAZORPAY_DAILY_LIMIT,
  ];
  const rows = await db.select().from(systemConfigTable).where(inArray(systemConfigTable.key, keys));
  const cfg = new Map(rows.map(r => [r.key, r.value]));
  return {
    enabled: cfg.get(SYSTEM_CONFIG_KEYS.RAZORPAY_ENABLED) === "true",
    minAmount: parseFloat(cfg.get(SYSTEM_CONFIG_KEYS.RAZORPAY_MIN_AMOUNT) ?? "100"),
    maxAmount: parseFloat(cfg.get(SYSTEM_CONFIG_KEYS.RAZORPAY_MAX_AMOUNT) ?? "500000"),
    dailyLimit: parseFloat(cfg.get(SYSTEM_CONFIG_KEYS.RAZORPAY_DAILY_LIMIT) ?? "1000000"),
  };
}

/**
 * Credit the merchant wallet for a confirmed Razorpay payment.
 * Atomic: transitions order to SUCCESS (idempotent), credits pending_balance,
 * creates wallet ledger entry, and inserts transaction record.
 *
 * Returns: "credited" | "duplicate" | "error"
 */
export async function creditWalletForRazorpay(
  internalOrderId: string,
  razorpayPaymentId: string,
  paymentMethod: string | null,
): Promise<"credited" | "duplicate" | "error"> {
  try {
    return await db.transaction(async (tx) => {
      const updated = await tx
        .update(razorpayPaymentOrdersTable)
        .set({
          status: RAZORPAY_ORDER_STATUS.SUCCESS,
          razorpayPaymentId,
          paymentMethod: paymentMethod ?? undefined,
          utr: `RZP-${razorpayPaymentId}`,
          paidAt: new Date(),
        })
        .where(and(
          eq(razorpayPaymentOrdersTable.internalOrderId, internalOrderId),
          inArray(razorpayPaymentOrdersTable.status, [
            RAZORPAY_ORDER_STATUS.CREATED,
            RAZORPAY_ORDER_STATUS.PENDING,
          ]),
        ))
        .returning({ id: razorpayPaymentOrdersTable.id, merchantId: razorpayPaymentOrdersTable.merchantId, amount: razorpayPaymentOrdersTable.amount, currency: razorpayPaymentOrdersTable.currency, razorpayOrderId: razorpayPaymentOrdersTable.razorpayOrderId });

      if (!updated.length) return "duplicate";

      const order = updated[0]!;
      const amountStr = String(order.amount);
      const amountNum = parseFloat(amountStr);

      const [wallet] = await tx
        .select()
        .from(merchantWalletsTable)
        .where(eq(merchantWalletsTable.merchantId, order.merchantId))
        .for("update");

      if (!wallet) {
        await tx
          .insert(merchantWalletsTable)
          .values({ merchantId: order.merchantId })
          .onConflictDoNothing();
        const [newWallet] = await tx
          .select()
          .from(merchantWalletsTable)
          .where(eq(merchantWalletsTable.merchantId, order.merchantId))
          .for("update");
        if (!newWallet) throw new Error("Failed to create wallet");
        Object.assign(wallet ?? {}, newWallet);
      }

      const pendingBefore  = parseFloat(wallet?.pendingBalance  ?? "0");
      const availableBefore = parseFloat(wallet?.availableBalance ?? "0");
      const pendingAfter   = pendingBefore + amountNum;

      await tx
        .update(merchantWalletsTable)
        .set({
          pendingBalance:  String(pendingAfter),
          totalCollection: sql`${merchantWalletsTable.totalCollection} + ${amountStr}::numeric`,
        })
        .where(eq(merchantWalletsTable.merchantId, order.merchantId));

      await tx.insert(walletLedgerTable).values({
        merchantId: order.merchantId,
        txnType: "pending_credit",
        bucket: "pending",
        amount: amountStr,
        availableBefore: String(availableBefore),
        availableAfter:  String(availableBefore),
        pendingBefore:   String(pendingBefore),
        pendingAfter:    String(pendingAfter),
        referenceType:   "transaction",
        description:     `RasoKart deposit via payment gateway — ref ${internalOrderId}`,
        createdBy:       null,
      });

      const utr = `RZP-${razorpayPaymentId}`;
      await tx.insert(transactionsTable).values({
        merchantId: order.merchantId,
        provider:    "razorpay",
        type:        "deposit",
        status:      "success",
        amount:      amountStr,
        currency:    order.currency ?? "INR",
        utr,
        referenceId: order.razorpayOrderId,
        description: `RasoKart payment — order ${internalOrderId}`,
        metadata:    JSON.stringify({ sourceType: "razorpay", sourceId: internalOrderId, paymentId: razorpayPaymentId }),
      }).onConflictDoNothing();

      return "credited";
    });
  } catch {
    return "error";
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/merchant/razorpay/status
 * White-label: whether RasoKart payment collection is available.
 * Never exposes provider name or credential details.
 */
router.get("/razorpay/status", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }
    const cfg = await loadRazorpayConfig();
    const creds = getRazorpayCreds();
    res.json({
      enabled: cfg.enabled && !!creds,
      minAmount: cfg.minAmount,
      maxAmount: cfg.maxAmount,
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/merchant/razorpay/create-order
 * Creates a Razorpay order server-side. Amount validated/calculated server-side in paise.
 * Returns {internalOrderId, razorpayOrderId, amount, currency, keyId} — never keySecret.
 */
router.post("/razorpay/create-order", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }

    const cfg = await loadRazorpayConfig();
    if (!cfg.enabled) {
      res.status(400).json({ error: "Payment collection is not available" });
      return;
    }

    const creds = getRazorpayCreds();
    if (!creds) {
      res.status(400).json({ error: "Payment collection is not configured" });
      return;
    }

    const { amount, note } = req.body as { amount?: unknown; note?: string };
    const amountNum = Number(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      res.status(400).json({ error: "Valid amount (in INR) is required" });
      return;
    }
    if (amountNum < cfg.minAmount) {
      res.status(400).json({ error: `Minimum deposit is ₹${cfg.minAmount}` });
      return;
    }
    if (amountNum > cfg.maxAmount) {
      res.status(400).json({ error: `Maximum deposit is ₹${cfg.maxAmount}` });
      return;
    }

    const amountInPaise = Math.round(amountNum * 100);
    const internalOrderId = `RKRPAY-${user.merchantId}-${Date.now()}`;
    const receipt = `rk-${Date.now().toString(36)}`;

    const { parsed, status: httpStatus } = await razorpayCreateOrder(creds.keyId, creds.keySecret, {
      amount: amountInPaise,
      currency: "INR",
      receipt,
      notes: { internal_order_id: internalOrderId, merchant_id: String(user.merchantId) },
    });

    if (!parsed.id || httpStatus >= 400) {
      req.log.warn({ merchantId: user.merchantId, httpStatus }, "Razorpay create-order failed");
      res.status(502).json({ error: "Unable to create payment order. Please try again." });
      return;
    }

    await db.insert(razorpayPaymentOrdersTable).values({
      merchantId:     user.merchantId,
      internalOrderId,
      razorpayOrderId: parsed.id,
      amount:         String(amountNum),
      currency:       parsed.currency ?? "INR",
      status:         RAZORPAY_ORDER_STATUS.CREATED,
    }).onConflictDoNothing();

    res.json({
      internalOrderId,
      razorpayOrderId: parsed.id,
      amount:          amountNum,
      amountInPaise,
      currency:        parsed.currency ?? "INR",
      keyId:           creds.keyId,
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/merchant/razorpay/verify-payment
 * Verifies HMAC-SHA256 signature, fetches payment from Razorpay, credits wallet.
 * Never trusts amount, status, or order-id from the request — all fetched server-side.
 */
router.post("/razorpay/verify-payment", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }

    const { internalOrderId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = req.body as {
      internalOrderId?: string;
      razorpayPaymentId?: string;
      razorpayOrderId?: string;
      razorpaySignature?: string;
    };

    if (!internalOrderId || !razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
      res.status(400).json({ error: "Missing required payment verification fields" });
      return;
    }

    const creds = getRazorpayCreds();
    if (!creds) {
      res.status(400).json({ error: "Payment collection is not configured" });
      return;
    }

    const signatureValid = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature, creds.keySecret);
    if (!signatureValid) {
      req.log.warn({ merchantId: user.merchantId, internalOrderId }, "Razorpay signature verification failed");
      res.status(400).json({ error: "Payment verification failed. Please contact support." });
      return;
    }

    const [order] = await db
      .select()
      .from(razorpayPaymentOrdersTable)
      .where(and(
        eq(razorpayPaymentOrdersTable.internalOrderId, internalOrderId),
        eq(razorpayPaymentOrdersTable.merchantId, user.merchantId),
        eq(razorpayPaymentOrdersTable.razorpayOrderId, razorpayOrderId),
      ))
      .limit(1);

    if (!order) {
      req.log.warn({ merchantId: user.merchantId, internalOrderId }, "Razorpay verify: order not found");
      res.status(404).json({ error: "Order not found" });
      return;
    }

    if (order.status === RAZORPAY_ORDER_STATUS.SUCCESS) {
      res.json({
        status: "success",
        message: "Payment already credited",
        internalOrderId,
        amount: order.amount,
        paidAt: order.paidAt,
      });
      return;
    }

    const { parsed: payment, status: fetchStatus } = await razorpayFetchPayment(creds.keyId, creds.keySecret, razorpayPaymentId);

    if (fetchStatus >= 400 || !payment.id) {
      req.log.warn({ merchantId: user.merchantId, razorpayPaymentId }, "Razorpay fetch payment failed");
      res.status(502).json({ error: "Unable to verify payment status. Please contact support." });
      return;
    }

    if (payment.status !== "captured" && payment.status !== "authorized") {
      req.log.warn({ merchantId: user.merchantId, paymentStatus: payment.status }, "Razorpay payment not captured");
      res.status(400).json({ error: "Payment is not yet confirmed. Please wait or contact support." });
      return;
    }

    const paymentMethod = typeof payment.method === "string" ? payment.method : null;
    const result = await creditWalletForRazorpay(internalOrderId, razorpayPaymentId, paymentMethod);

    if (result === "error") {
      req.log.error({ merchantId: user.merchantId, internalOrderId }, "Razorpay wallet credit failed");
      res.status(500).json({ error: "Payment verified but wallet credit failed. Please contact support." });
      return;
    }

    req.log.info({ merchantId: user.merchantId, internalOrderId, razorpayPaymentId, result }, "Razorpay payment verified and processed");

    const [finalOrder] = await db
      .select()
      .from(razorpayPaymentOrdersTable)
      .where(eq(razorpayPaymentOrdersTable.internalOrderId, internalOrderId))
      .limit(1);

    res.json({
      status: "success",
      message: result === "duplicate" ? "Payment already credited" : "Payment confirmed and credited",
      internalOrderId,
      amount: finalOrder?.amount ?? order.amount,
      paidAt: finalOrder?.paidAt ?? new Date(),
      utr: finalOrder?.utr ?? `RZP-${razorpayPaymentId}`,
      paymentMethod: finalOrder?.paymentMethod ?? paymentMethod,
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/merchant/razorpay/order-status/:internalOrderId
 * Poll order status (for fallback after webhook/verify).
 */
router.get("/razorpay/order-status/:id", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }
    const internalOrderId = req.params["id"] as string;
    const [order] = await db
      .select()
      .from(razorpayPaymentOrdersTable)
      .where(and(
        eq(razorpayPaymentOrdersTable.internalOrderId, internalOrderId),
        eq(razorpayPaymentOrdersTable.merchantId, user.merchantId),
      ))
      .limit(1);

    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    res.json({
      internalOrderId: order.internalOrderId,
      status: order.status,
      amount: order.amount,
      currency: order.currency,
      paidAt: order.paidAt,
      utr: order.utr,
      paymentMethod: order.paymentMethod,
    });
  } catch (err) { next(err); }
});

export default router;
