import { Router } from "express";
import { db, cashfreePaymentOrdersTable, systemConfigTable, SYSTEM_CONFIG_KEYS } from "@workspace/db";
import { eq, inArray, ne, and } from "drizzle-orm";
import { cashfreeCreateOrder, type CashfreeEnv } from "../helpers/cashfree";
import { requireAuth } from "../middlewares/auth";

const router = Router();

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
      inArray(systemConfigTable.key, [SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED, SYSTEM_CONFIG_KEYS.CASHFREE_ENV])
    );
    const cfg = new Map(rows.map(r => [r.key, r.value]));
    res.json({
      enabled: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED) === "true",
      env: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_ENV) ?? "test",
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
    ];
    const rows = await db.select().from(systemConfigTable).where(inArray(systemConfigTable.key, keys));
    const cfg = new Map(rows.map(r => [r.key, r.value]));

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
      status: "created",
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

export default router;
