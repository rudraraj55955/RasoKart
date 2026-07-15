import { Router } from "express";
import { db, cashfreePaymentOrdersTable, systemConfigTable, SYSTEM_CONFIG_KEYS, PAYIN_ORDER_STATUS } from "@workspace/db";
import { eq, inArray, ne, and } from "drizzle-orm";
import { cashfreeCreateOrder, type CashfreeEnv } from "../helpers/cashfree";
import { requireAuth } from "../middlewares/auth";

const router = Router();

const SUSPENDED_MESSAGE = "This payment service is temporarily unavailable. Please use another available method.";

/**
 * GET /api/merchant/cashfree/status
 *
 * Merchant-accessible endpoint (no admin required).
 * Returns whether Cashfree is enabled and which environment it targets.
 * Used by the merchant Deposits page to decide whether to show the "Pay via Cashfree" button.
 */
router.get("/cashfree/status", requireAuth, async (req, res, next) => {
  try {
    const rows = await db.select().from(systemConfigTable).where(
      inArray(systemConfigTable.key, [
        SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED,
        SYSTEM_CONFIG_KEYS.CASHFREE_ENV,
        SYSTEM_CONFIG_KEYS.CASHFREE_PAYIN_SUSPENDED,
      ])
    );
    const cfg = new Map(rows.map(r => [r.key, r.value]));
    const suspended = cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYIN_SUSPENDED) === "true";
    res.json({
      enabled: !suspended && cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED) === "true",
      env: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_ENV) ?? "test",
      suspended,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/merchant/cashfree/create-order
 *
 * Merchant-authenticated endpoint.
 * Creates a Cashfree payment order using the global Cashfree credentials,
 * saves it to cashfree_payment_orders, and returns the payment_session_id
 * so the frontend can redirect the user to the Cashfree hosted checkout.
 *
 * Body: { amount: number, currency?: string, customerPhone: string, customerName?: string, customerEmail?: string, note?: string }
 */
router.post("/cashfree/create-order", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }

    const { amount, currency = "INR", customerPhone, customerName, customerEmail, note } = req.body as {
      amount?: number;
      currency?: string;
      customerPhone?: string;
      customerName?: string;
      customerEmail?: string;
      note?: string;
    };

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      res.status(400).json({ error: "Valid amount is required" });
      return;
    }
    if (!customerPhone) {
      res.status(400).json({ error: "customerPhone is required" });
      return;
    }

    // Load Cashfree config
    const keys = [
      SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_ID,
      SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_SECRET,
      SYSTEM_CONFIG_KEYS.CASHFREE_ENV,
      SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED,
      SYSTEM_CONFIG_KEYS.CASHFREE_PAYIN_SUSPENDED,
    ];
    const rows = await db.select().from(systemConfigTable).where(inArray(systemConfigTable.key, keys));
    const cfg = new Map(rows.map(r => [r.key, r.value]));

    // Suspension check — blocks all new live order creation
    if (cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYIN_SUSPENDED) === "true") {
      req.log.warn({ merchantId: user.merchantId }, "cashfree_payin_blocked_suspended");
      res.status(503).json({ error: SUSPENDED_MESSAGE });
      return;
    }

    if (cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED) !== "true") {
      res.status(400).json({ error: "Payment gateway is not enabled" });
      return;
    }

    const clientId = cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_ID) ?? "";
    const clientSecret = cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_SECRET) ?? "";
    const env = (cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_ENV) ?? "test") as CashfreeEnv;

    if (!clientId || !clientSecret) {
      res.status(400).json({ error: "Payment gateway credentials are not configured" });
      return;
    }

    const orderId = `RK-${user.merchantId}-${Date.now()}`;

    const { raw, parsed } = await cashfreeCreateOrder(clientId, clientSecret, env, {
      order_id: orderId,
      order_amount: Number(amount),
      order_currency: currency,
      customer_details: {
        customer_id: `merchant-${user.merchantId}`,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
      },
      order_note: note,
    });

    if (!parsed.payment_session_id) {
      req.log.warn({ parsed, raw }, "Cashfree create-order failed");
      res.status(502).json({ error: parsed.message ?? "Failed to create payment order" });
      return;
    }

    // Save order to DB — idempotent on cashfree_order_id unique constraint
    await db.insert(cashfreePaymentOrdersTable).values({
      merchantId: user.merchantId,
      cashfreeOrderId: parsed.order_id ?? orderId,
      paymentSessionId: parsed.payment_session_id,
      amount: String(amount),
      currency,
      status: PAYIN_ORDER_STATUS.CREATED,
      rawPayload: raw,
    }).onConflictDoNothing();

    res.json({
      orderId: parsed.order_id ?? orderId,
      paymentSessionId: parsed.payment_session_id,
      env,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// White-label routes — no provider name in URL, field names, or response body.
// Merchants call these; internal Cashfree details stay hidden.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/merchant/payment/status
 * White-label alias: returns { enabled, suspended } — no provider name or env exposed.
 * When suspended is true, enabled is always false so the payment button is hidden.
 */
router.get("/payment/status", requireAuth, async (req, res, next) => {
  try {
    const rows = await db.select().from(systemConfigTable).where(
      inArray(systemConfigTable.key, [
        SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED,
        SYSTEM_CONFIG_KEYS.CASHFREE_PAYIN_SUSPENDED,
      ])
    );
    const cfg = new Map(rows.map(r => [r.key, r.value]));
    const suspended = cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYIN_SUSPENDED) === "true";
    res.json({
      enabled: !suspended && cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED) === "true",
      suspended,
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/merchant/payment/create-order
 * White-label alias: creates a payment order and returns RasoKart-branded fields only.
 * Response: { publicOrderId, checkoutUrl, amount, status, message }
 * Never returns: paymentSessionId, cashfree_order_id, env, client credentials.
 */
router.post("/payment/create-order", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }

    const { amount, currency = "INR", customerPhone, customerName, customerEmail, note } = req.body as {
      amount?: number;
      currency?: string;
      customerPhone?: string;
      customerName?: string;
      customerEmail?: string;
      note?: string;
    };

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      res.status(400).json({ error: "Valid amount is required" });
      return;
    }
    if (!customerPhone) {
      res.status(400).json({ error: "Customer phone is required" });
      return;
    }

    const keys = [
      SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_ID,
      SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_SECRET,
      SYSTEM_CONFIG_KEYS.CASHFREE_ENV,
      SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED,
      SYSTEM_CONFIG_KEYS.CASHFREE_PAYIN_SUSPENDED,
    ];
    const rows = await db.select().from(systemConfigTable).where(inArray(systemConfigTable.key, keys));
    const cfg = new Map(rows.map(r => [r.key, r.value]));

    // Suspension check — blocks all new live order creation; white-labelled message
    if (cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYIN_SUSPENDED) === "true") {
      req.log.warn({ merchantId: user.merchantId }, "cashfree_payin_blocked_suspended");
      res.status(503).json({ error: SUSPENDED_MESSAGE });
      return;
    }

    if (cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED) !== "true") {
      res.status(400).json({ error: "Payment gateway is not enabled" });
      return;
    }

    const clientId  = cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_ID)     ?? "";
    const clientSecret = cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_SECRET) ?? "";
    const env = (cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_ENV) ?? "test") as CashfreeEnv;

    if (!clientId || !clientSecret) {
      res.status(400).json({ error: "Payment gateway credentials are not configured" });
      return;
    }

    const orderId = `RK-${user.merchantId}-${Date.now()}`;

    const { raw, parsed } = await cashfreeCreateOrder(clientId, clientSecret, env, {
      order_id: orderId,
      order_amount: Number(amount),
      order_currency: currency,
      customer_details: {
        customer_id: `merchant-${user.merchantId}`,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
      },
      order_note: note,
    });

    if (!parsed.payment_session_id) {
      req.log.warn({ parsed, raw }, "Payment create-order failed");
      res.status(502).json({ error: "Failed to create payment order. Please try again." });
      return;
    }

    await db.insert(cashfreePaymentOrdersTable).values({
      merchantId: user.merchantId,
      cashfreeOrderId: parsed.order_id ?? orderId,
      paymentSessionId: parsed.payment_session_id,
      amount: String(amount),
      currency,
      status: PAYIN_ORDER_STATUS.CREATED,
      rawPayload: raw,
    }).onConflictDoNothing();

    // checkoutUrl points to our own branded checkout page — no cashfree.com in merchant code
    const checkoutEnv = env === "live" ? "prod" : "sandbox";
    const checkoutUrl = `/checkout?token=${encodeURIComponent(parsed.payment_session_id)}&env=${checkoutEnv}&amount=${encodeURIComponent(String(amount))}`;

    res.json({
      publicOrderId: orderId,
      checkoutUrl,
      amount: Number(amount),
      status: PAYIN_ORDER_STATUS.CREATED,
      message: "Payment order created successfully",
    });
  } catch (err) { next(err); }
});

export default router;
