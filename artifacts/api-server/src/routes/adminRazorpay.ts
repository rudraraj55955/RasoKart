import { Router } from "express";
import { db, razorpayPaymentOrdersTable, razorpayWebhookLogsTable, systemConfigTable, SYSTEM_CONFIG_KEYS } from "@workspace/db";
import { eq, inArray, desc, and, or, ilike, gte, lte, sql } from "drizzle-orm";
import { requireAuth, requireAdmin, requireSuperAdmin } from "../middlewares/auth";

const router = Router();

router.use(requireAuth, requireAdmin);

async function loadRazorpayCfgMap(): Promise<Map<string, string>> {
  const keys = [
    SYSTEM_CONFIG_KEYS.RAZORPAY_ENABLED,
    SYSTEM_CONFIG_KEYS.RAZORPAY_MIN_AMOUNT,
    SYSTEM_CONFIG_KEYS.RAZORPAY_MAX_AMOUNT,
    SYSTEM_CONFIG_KEYS.RAZORPAY_DAILY_LIMIT,
  ];
  const rows = await db.select().from(systemConfigTable).where(inArray(systemConfigTable.key, keys));
  return new Map(rows.map(r => [r.key, r.value]));
}

/**
 * GET /api/admin/razorpay/config
 * Returns Razorpay payin configuration.
 * Never returns credential values — only whether each is configured.
 */
router.get("/config", requireSuperAdmin, async (req, res, next) => {
  try {
    const cfg = await loadRazorpayCfgMap();
    const keyId        = process.env["RAZORPAY_KEY_ID"]        ?? "";
    const keySecret    = process.env["RAZORPAY_KEY_SECRET"]    ?? "";
    const webhookSecret = process.env["RAZORPAY_WEBHOOK_SECRET"] ?? "";

    res.json({
      enabled:               cfg.get(SYSTEM_CONFIG_KEYS.RAZORPAY_ENABLED) === "true",
      minAmount:             parseFloat(cfg.get(SYSTEM_CONFIG_KEYS.RAZORPAY_MIN_AMOUNT) ?? "100"),
      maxAmount:             parseFloat(cfg.get(SYSTEM_CONFIG_KEYS.RAZORPAY_MAX_AMOUNT) ?? "500000"),
      dailyLimit:            parseFloat(cfg.get(SYSTEM_CONFIG_KEYS.RAZORPAY_DAILY_LIMIT) ?? "1000000"),
      keyIdConfigured:       !!keyId,
      keySecretConfigured:   !!keySecret,
      webhookSecretConfigured: !!webhookSecret,
    });
  } catch (err) { next(err); }
});

/**
 * PUT /api/admin/razorpay/config
 * Update Razorpay payin configuration (enable/disable, limits).
 * Credentials are environment-variable-only and cannot be set via this endpoint.
 */
router.put("/config", requireSuperAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { enabled, minAmount, maxAmount, dailyLimit } = req.body as {
      enabled?: boolean;
      minAmount?: number;
      maxAmount?: number;
      dailyLimit?: number;
    };

    const updates: Array<{ key: string; value: string }> = [];

    if (enabled !== undefined) updates.push({ key: SYSTEM_CONFIG_KEYS.RAZORPAY_ENABLED, value: String(!!enabled) });
    if (minAmount !== undefined && !isNaN(Number(minAmount)) && Number(minAmount) >= 0) {
      updates.push({ key: SYSTEM_CONFIG_KEYS.RAZORPAY_MIN_AMOUNT, value: String(Number(minAmount)) });
    }
    if (maxAmount !== undefined && !isNaN(Number(maxAmount)) && Number(maxAmount) > 0) {
      updates.push({ key: SYSTEM_CONFIG_KEYS.RAZORPAY_MAX_AMOUNT, value: String(Number(maxAmount)) });
    }
    if (dailyLimit !== undefined && !isNaN(Number(dailyLimit)) && Number(dailyLimit) >= 0) {
      updates.push({ key: SYSTEM_CONFIG_KEYS.RAZORPAY_DAILY_LIMIT, value: String(Number(dailyLimit)) });
    }

    for (const { key, value } of updates) {
      await db
        .insert(systemConfigTable)
        .values({ key, value, updatedByEmail: user.email })
        .onConflictDoUpdate({ target: systemConfigTable.key, set: { value, updatedByEmail: user.email } });
    }

    const cfg = await loadRazorpayCfgMap();
    res.json({
      enabled:    cfg.get(SYSTEM_CONFIG_KEYS.RAZORPAY_ENABLED) === "true",
      minAmount:  parseFloat(cfg.get(SYSTEM_CONFIG_KEYS.RAZORPAY_MIN_AMOUNT) ?? "100"),
      maxAmount:  parseFloat(cfg.get(SYSTEM_CONFIG_KEYS.RAZORPAY_MAX_AMOUNT) ?? "500000"),
      dailyLimit: parseFloat(cfg.get(SYSTEM_CONFIG_KEYS.RAZORPAY_DAILY_LIMIT) ?? "1000000"),
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/admin/razorpay/orders
 * Paginated list of Razorpay payment orders with search and filter.
 */
router.get("/orders", async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query["page"] as string ?? "1", 10) || 1);
    const limit  = Math.min(100, parseInt(req.query["limit"] as string ?? "20", 10) || 20);
    const offset = (page - 1) * limit;
    const status = req.query["status"] as string | undefined;
    const search = (req.query["search"] as string | undefined)?.trim();

    const conditions: ReturnType<typeof eq>[] = [];
    if (status && status !== "all") conditions.push(eq(razorpayPaymentOrdersTable.status, status.toUpperCase()));

    const rows = await db
      .select()
      .from(razorpayPaymentOrdersTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(razorpayPaymentOrdersTable.createdAt))
      .limit(limit)
      .offset(offset);

    const filtered = search
      ? rows.filter(r =>
          r.internalOrderId.includes(search) ||
          r.razorpayOrderId.includes(search) ||
          (r.razorpayPaymentId ?? "").includes(search) ||
          (r.utr ?? "").includes(search) ||
          String(r.merchantId) === search,
        )
      : rows;

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(razorpayPaymentOrdersTable)
      .where(conditions.length ? and(...conditions) : undefined);

    res.json({
      data:  filtered,
      total: totalRow?.count ?? 0,
      page,
      limit,
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/admin/razorpay/orders/export/csv
 * CSV export of Razorpay orders.
 */
router.get("/orders/export/csv", async (req, res, next) => {
  try {
    const status = req.query["status"] as string | undefined;
    const conditions: ReturnType<typeof eq>[] = [];
    if (status && status !== "all") conditions.push(eq(razorpayPaymentOrdersTable.status, status.toUpperCase()));

    const rows = await db
      .select()
      .from(razorpayPaymentOrdersTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(razorpayPaymentOrdersTable.createdAt))
      .limit(10000);

    const header = ["ID", "Internal Order ID", "Razorpay Order ID", "Payment ID", "Merchant ID", "Amount", "Currency", "Status", "Payment Method", "UTR", "Paid At", "Created At"];
    const csvRows = rows.map(r => [
      r.id,
      r.internalOrderId,
      r.razorpayOrderId,
      r.razorpayPaymentId ?? "",
      r.merchantId,
      r.amount,
      r.currency,
      r.status,
      r.paymentMethod ?? "",
      r.utr ?? "",
      r.paidAt?.toISOString() ?? "",
      r.createdAt.toISOString(),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));

    const csv = [header.map(h => `"${h}"`).join(","), ...csvRows].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="razorpay-orders-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
});

/**
 * GET /api/admin/razorpay/webhook-logs
 * Super-admin-only paginated list of Razorpay webhook logs.
 * Logs are masked — no raw sensitive payloads.
 */
router.get("/webhook-logs", requireSuperAdmin, async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query["page"] as string ?? "1", 10) || 1);
    const limit  = Math.min(100, parseInt(req.query["limit"] as string ?? "20", 10) || 20);
    const offset = (page - 1) * limit;
    const result = req.query["result"] as string | undefined;
    const eventT = req.query["eventType"] as string | undefined;

    const conditions: ReturnType<typeof eq>[] = [];
    if (result && result !== "all") conditions.push(eq(razorpayWebhookLogsTable.processingResult, result));
    if (eventT && eventT !== "all") conditions.push(eq(razorpayWebhookLogsTable.eventType, eventT));

    const rows = await db
      .select()
      .from(razorpayWebhookLogsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(razorpayWebhookLogsTable.receivedAt))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(razorpayWebhookLogsTable)
      .where(conditions.length ? and(...conditions) : undefined);

    res.json({
      data:  rows,
      total: totalRow?.count ?? 0,
      page,
      limit,
    });
  } catch (err) { next(err); }
});

export default router;
