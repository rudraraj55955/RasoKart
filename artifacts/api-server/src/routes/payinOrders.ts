import { Router } from "express";
import { db, cashfreePaymentOrdersTable, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS } from "@workspace/db";
import { eq, inArray, and, gte, sql } from "drizzle-orm";
import { cashfreeCreateOrder, cashfreeGetOrder, type CashfreeEnv } from "../helpers/cashfree";
import { decryptSecret } from "../helpers/cryptoUtils";
import { requireAuth } from "../middlewares/auth";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// White-label merchant Payin routes (RasoKart UPI Deposit).
// No "Cashfree", cf_order_id, payment_session_id, or raw provider payloads are
// ever exposed here — only RasoKart-branded fields.
// ─────────────────────────────────────────────────────────────────────────────

async function loadPayinConfig() {
  const keys = [
    SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_ID,
    SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_SECRET,
    SYSTEM_CONFIG_KEYS.CASHFREE_ENV,
    SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED,
    SYSTEM_CONFIG_KEYS.CASHFREE_BASE_URL,
    SYSTEM_CONFIG_KEYS.CASHFREE_API_VERSION,
    SYSTEM_CONFIG_KEYS.CASHFREE_UPI_ENABLED,
    SYSTEM_CONFIG_KEYS.CASHFREE_MERCHANT_PAYIN_ENABLED,
    SYSTEM_CONFIG_KEYS.CASHFREE_MIN_AMOUNT,
    SYSTEM_CONFIG_KEYS.CASHFREE_MAX_AMOUNT,
    SYSTEM_CONFIG_KEYS.CASHFREE_DAILY_LIMIT,
  ];
  const rows = await db.select().from(systemConfigTable).where(inArray(systemConfigTable.key, keys));
  const cfg = new Map(rows.map((r) => [r.key, r.value]));
  return {
    clientId: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_ID) ?? "",
    rawClientSecret: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_SECRET) ?? "",
    env: (cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_ENV) ?? "test") as CashfreeEnv,
    enabled: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED) === "true",
    baseUrl: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_BASE_URL) || undefined,
    apiVersion: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_API_VERSION) || undefined,
    upiEnabled: (cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_UPI_ENABLED) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.CASHFREE_UPI_ENABLED]) !== "false",
    merchantPayinEnabled: (cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_MERCHANT_PAYIN_ENABLED) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.CASHFREE_MERCHANT_PAYIN_ENABLED]) !== "false",
    minAmount: parseFloat(cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_MIN_AMOUNT) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.CASHFREE_MIN_AMOUNT]),
    maxAmount: parseFloat(cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_MAX_AMOUNT) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.CASHFREE_MAX_AMOUNT]),
    dailyLimit: parseFloat(cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_DAILY_LIMIT) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.CASHFREE_DAILY_LIMIT]),
  };
}

/**
 * GET /api/merchant/payin/status
 * White-label: whether RasoKart UPI deposits are available to this merchant.
 */
router.get("/payin/status", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }
    const cfg = await loadPayinConfig();
    res.json({
      enabled: cfg.enabled && cfg.upiEnabled && cfg.merchantPayinEnabled,
      minAmount: cfg.minAmount,
      maxAmount: cfg.maxAmount,
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/merchant/payin/orders
 * Creates a RasoKart UPI deposit order. Enforces admin-configured min/max/daily limits.
 * Response never includes cf_order_id, payment_session_id, or raw provider fields.
 */
router.post("/payin/orders", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }

    const { amount, customerPhone, customerName, customerEmail } = req.body as {
      amount?: number;
      customerPhone?: string;
      customerName?: string;
      customerEmail?: string;
    };

    const depositAmount = Number(amount);
    if (!amount || isNaN(depositAmount) || depositAmount <= 0) {
      res.status(400).json({ error: "Valid amount is required" });
      return;
    }
    if (!customerPhone) {
      res.status(400).json({ error: "Customer phone is required" });
      return;
    }

    const cfg = await loadPayinConfig();
    if (!cfg.enabled || !cfg.upiEnabled || !cfg.merchantPayinEnabled) {
      res.status(400).json({ error: "UPI deposits are not available right now. Please try again later." });
      return;
    }
    if (depositAmount < cfg.minAmount || depositAmount > cfg.maxAmount) {
      res.status(400).json({ error: `Amount must be between ₹${cfg.minAmount} and ₹${cfg.maxAmount}` });
      return;
    }

    // Daily limit check — sum of this merchant's paid payin orders created today.
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [dailyTotalRow] = await db
      .select({ total: sql<string>`COALESCE(SUM(${cashfreePaymentOrdersTable.amount}), 0)` })
      .from(cashfreePaymentOrdersTable)
      .where(and(
        eq(cashfreePaymentOrdersTable.merchantId, user.merchantId),
        eq(cashfreePaymentOrdersTable.status, "paid"),
        gte(cashfreePaymentOrdersTable.paidAt, startOfDay),
      ));
    const dailyTotal = Number(dailyTotalRow?.total ?? 0);
    if (dailyTotal + depositAmount > cfg.dailyLimit) {
      res.status(400).json({ error: "Daily deposit limit reached. Please try again tomorrow or contact support." });
      return;
    }

    if (!cfg.clientId || !cfg.rawClientSecret) {
      res.status(400).json({ error: "UPI deposits are not available right now. Please try again later." });
      return;
    }
    const decrypted = decryptSecret(cfg.rawClientSecret);
    if (!decrypted.ok || !decrypted.value.trim()) {
      req.log.warn({ safeReason: "decrypt_failed" }, "payin_create_order: clientSecret decrypt failed");
      res.status(500).json({ error: "UPI deposits are temporarily unavailable. Please try again later." });
      return;
    }

    const publicOrderId = `RKPAYIN_${user.merchantId}_${Date.now()}`;

    const { raw, parsed } = await cashfreeCreateOrder(cfg.clientId, decrypted.value, cfg.env, {
      order_id: publicOrderId,
      order_amount: depositAmount,
      order_currency: "INR",
      customer_details: {
        customer_id: `merchant-${user.merchantId}`,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
      },
      order_note: "RasoKart UPI Deposit",
    }, { baseUrl: cfg.baseUrl, apiVersion: cfg.apiVersion });

    if (!parsed.payment_session_id) {
      req.log.warn({ safeReason: "provider_create_order_failed" }, "payin_create_order failed");
      res.status(502).json({ error: "Unable to start deposit right now. Please try again." });
      return;
    }

    await db.insert(cashfreePaymentOrdersTable).values({
      merchantId: user.merchantId,
      publicOrderId,
      providerKey: "cashfree",
      cashfreeOrderId: parsed.order_id ?? publicOrderId,
      paymentSessionId: parsed.payment_session_id,
      amount: depositAmount.toFixed(2),
      currency: "INR",
      status: "created",
      paymentMethod: "upi",
      customerPhone,
      customerEmail: customerEmail ?? null,
      rawPayload: raw,
    }).onConflictDoNothing();

    // checkoutUrl / paymentToken point to our own branded checkout — never expose provider internals.
    res.json({
      publicOrderId,
      paymentToken: parsed.payment_session_id,
      amount: depositAmount,
      status: "created",
      checkoutLabel: "RasoKart Secure Checkout",
      message: "Deposit order created. Complete the payment via UPI to add funds to your wallet.",
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/merchant/payin/orders/:publicOrderId
 * White-label status check. UTR is only ever included once status is "paid".
 */
router.get("/payin/orders/:publicOrderId", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }
    const publicOrderId = req.params["publicOrderId"] as string;

    const [order] = await db
      .select()
      .from(cashfreePaymentOrdersTable)
      .where(and(
        eq(cashfreePaymentOrdersTable.publicOrderId, publicOrderId),
        eq(cashfreePaymentOrdersTable.merchantId, user.merchantId),
      ))
      .limit(1);

    if (!order) {
      res.status(404).json({ error: "Deposit order not found" });
      return;
    }

    // Optionally refresh status from provider if still pending (best-effort, never surfaces raw errors).
    if (order.status === "created" || order.status === "pending") {
      try {
        const cfg = await loadPayinConfig();
        if (cfg.clientId && cfg.rawClientSecret) {
          const decrypted = decryptSecret(cfg.rawClientSecret);
          if (decrypted.ok && decrypted.value.trim()) {
            const { parsed } = await cashfreeGetOrder(cfg.clientId, decrypted.value, cfg.env, order.cashfreeOrderId, { baseUrl: cfg.baseUrl, apiVersion: cfg.apiVersion });
            const providerStatus = (parsed.order_status ?? "").toUpperCase();
            if (providerStatus === "ACTIVE") {
              // still pending — no change
            } else if (providerStatus && providerStatus !== "PAID") {
              await db.update(cashfreePaymentOrdersTable)
                .set({ rawProviderStatus: providerStatus })
                .where(eq(cashfreePaymentOrdersTable.id, order.id));
            }
          }
        }
      } catch {
        // Best-effort refresh only; webhook remains source of truth for "paid".
      }
    }

    const [fresh] = await db
      .select()
      .from(cashfreePaymentOrdersTable)
      .where(eq(cashfreePaymentOrdersTable.id, order.id))
      .limit(1);

    const isPaid = fresh?.status === "paid";
    res.json({
      publicOrderId,
      amount: Number(fresh?.amount ?? order.amount),
      status: fresh?.status ?? order.status,
      utr: isPaid ? (fresh?.utr ?? null) : null,
      paidAt: isPaid ? fresh?.paidAt ?? null : null,
      createdAt: fresh?.createdAt ?? order.createdAt,
    });
  } catch (err) { next(err); }
});

export default router;
