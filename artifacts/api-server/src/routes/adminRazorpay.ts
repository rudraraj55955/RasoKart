import { Router } from "express";
import { db, razorpayPaymentOrdersTable, razorpayWebhookLogsTable, systemConfigTable, SYSTEM_CONFIG_KEYS, providerProductsTable, razorpayRefundsTable } from "@workspace/db";
import { eq, inArray, desc, and, or, ilike, gte, lte, sql, like } from "drizzle-orm";
import { razorpayCreateRefund, razorpayFetchRefund, verifyRazorpayXActivation } from "../helpers/razorpay";
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
      keyIdLiveMode:         keyId.startsWith("rzp_live_"),
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

// ────────────────────────────────────────────────────────────────────────────
// CAPABILITY AUDIT MATRIX
// ────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/razorpay/capabilities
 * Returns all Razorpay product capability entries from provider_products.
 * Includes a summary count by capabilityStatus.
 */
router.get("/capabilities", requireSuperAdmin, async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(providerProductsTable)
      .where(like(providerProductsTable.productKey, "razorpay%"))
      .orderBy(providerProductsTable.sortOrder, providerProductsTable.productKey);

    const summary: Record<string, number> = { total: rows.length };
    for (const r of rows) {
      const k = r.capabilityStatus ?? "UNCHECKED";
      summary[k] = (summary[k] ?? 0) + 1;
    }

    res.json({ products: rows, summary });
  } catch (err) { next(err); }
});

/**
 * PATCH /api/admin/razorpay/capabilities/:productKey
 * Update notes, status, docsUrl, or any non-credential field for one capability row.
 * Only existing rows can be updated.
 */
router.patch("/capabilities/:productKey", requireSuperAdmin, async (req, res, next) => {
  try {
    const productKey = req.params["productKey"] as string;
    const { implNotes, docsUrl, capabilityStatus, isEnabled, approvalReason, testModeStatus, liveModeStatus } =
      req.body as {
        implNotes?: string;
        docsUrl?: string;
        capabilityStatus?: string;
        isEnabled?: boolean;
        approvalReason?: string;
        testModeStatus?: string;
        liveModeStatus?: string;
      };

    const updates: Record<string, unknown> = {};
    if (implNotes !== undefined)       updates.implNotes = implNotes;
    if (docsUrl !== undefined)         updates.docsUrl = docsUrl;
    if (capabilityStatus !== undefined) updates.capabilityStatus = capabilityStatus;
    if (isEnabled !== undefined)       updates.isEnabled = !!isEnabled;
    if (approvalReason !== undefined)  updates.approvalReason = approvalReason;
    if (testModeStatus !== undefined)  updates.testModeStatus = testModeStatus;
    if (liveModeStatus !== undefined)  updates.liveModeStatus = liveModeStatus;
    if (!Object.keys(updates).length) {
      res.status(400).json({ error: "No valid update fields provided" });
      return;
    }

    const [updated] = await db
      .update(providerProductsTable)
      .set({ ...updates, updatedAt: new Date() } as never)
      .where(eq(providerProductsTable.productKey, productKey))
      .returning();

    if (!updated) {
      res.status(404).json({ error: `Product '${productKey}' not found` });
      return;
    }
    res.json(updated);
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// ANALYTICS
// ────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/razorpay/analytics
 * Aggregated Razorpay analytics from razorpay_payment_orders.
 * Includes KPIs, error breakdown, and method breakdown.
 */
router.get("/analytics", requireSuperAdmin, async (req, res, next) => {
  try {
    const [kpis] = await db
      .select({
        totalAttempts: sql<number>`count(*)::int`,
        successful:    sql<number>`count(*) filter (where status = 'CAPTURED')::int`,
        failed:        sql<number>`count(*) filter (where status = 'FAILED')::int`,
        pending:       sql<number>`count(*) filter (where status IN ('CREATED','PENDING'))::int`,
        totalVolumeInr: sql<string>`coalesce(sum(amount) filter (where status = 'CAPTURED'), 0)::text`,
        refundedCount:  sql<number>`count(*) filter (where status = 'REFUNDED')::int`,
      })
      .from(razorpayPaymentOrdersTable);

    const totalAttempts = kpis?.totalAttempts ?? 0;
    const successful    = kpis?.successful ?? 0;
    const successRate   = totalAttempts > 0 ? Math.round((successful / totalAttempts) * 10000) / 100 : 0;
    const totalVol      = parseFloat(kpis?.totalVolumeInr ?? "0");
    const avgTxn        = successful > 0 ? Math.round((totalVol / successful) * 100) / 100 : 0;

    // Error breakdown — group by error_code, top 10
    const errorBreakdown = await db
      .select({
        errorCode: razorpayPaymentOrdersTable.errorCode,
        count:     sql<number>`count(*)::int`,
      })
      .from(razorpayPaymentOrdersTable)
      .where(and(
        sql`${razorpayPaymentOrdersTable.errorCode} IS NOT NULL`,
        sql`${razorpayPaymentOrdersTable.errorCode} != ''`,
      ))
      .groupBy(razorpayPaymentOrdersTable.errorCode)
      .orderBy(sql`count(*) desc`)
      .limit(10);

    // Method breakdown — group by payment_method
    const methodBreakdown = await db
      .select({
        method: razorpayPaymentOrdersTable.paymentMethod,
        count:  sql<number>`count(*)::int`,
        volume: sql<string>`coalesce(sum(amount) filter (where status = 'CAPTURED'), 0)::text`,
      })
      .from(razorpayPaymentOrdersTable)
      .groupBy(razorpayPaymentOrdersTable.paymentMethod)
      .orderBy(sql`count(*) desc`)
      .limit(20);

    // Refund aggregate from razorpay_refunds table
    const [refundKpis] = await db
      .select({
        refundCount:  sql<number>`count(*)::int`,
        refundAmount: sql<string>`coalesce(sum(amount), 0)::text`,
      })
      .from(razorpayRefundsTable);

    res.json({
      kpis: {
        totalAttempts,
        successful,
        failed:        kpis?.failed ?? 0,
        pending:       kpis?.pending ?? 0,
        successRate,
        totalVolumeInr: totalVol.toFixed(2),
        avgTransactionValue: avgTxn.toFixed(2),
        refundCount:   refundKpis?.refundCount ?? 0,
        refundAmount:  parseFloat(refundKpis?.refundAmount ?? "0").toFixed(2),
      },
      errorBreakdown,
      methodBreakdown,
    });
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// REFUNDS
// ────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/razorpay/refunds
 * Paginated list of all initiated Razorpay refunds.
 */
router.get("/refunds", requireSuperAdmin, async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query["page"] as string ?? "1", 10) || 1);
    const limit  = Math.min(100, parseInt(req.query["limit"] as string ?? "20", 10) || 20);
    const offset = (page - 1) * limit;

    const rows = await db
      .select()
      .from(razorpayRefundsTable)
      .orderBy(desc(razorpayRefundsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(razorpayRefundsTable);

    res.json({ data: rows, total: totalRow?.count ?? 0, page, limit });
  } catch (err) { next(err); }
});

/**
 * POST /api/admin/razorpay/refunds
 * Initiate a Razorpay refund for a payment.
 * Body: { razorpayPaymentId, orderId, amount (paise, integer), speed?, notes? }
 */
router.post("/refunds", requireSuperAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const keyId     = process.env["RAZORPAY_KEY_ID"]     ?? "";
    const keySecret = process.env["RAZORPAY_KEY_SECRET"] ?? "";

    if (!keyId || !keySecret) {
      res.status(503).json({ error: "Razorpay credentials not configured in this environment." });
      return;
    }

    const { razorpayPaymentId, orderId, amount, speed, notes } = req.body as {
      razorpayPaymentId?: string;
      orderId?: number;
      amount?: number;
      speed?: "normal" | "optimum";
      notes?: string;
    };

    if (!razorpayPaymentId || typeof razorpayPaymentId !== "string") {
      res.status(400).json({ error: "razorpayPaymentId is required" });
      return;
    }
    if (!orderId || typeof orderId !== "number") {
      res.status(400).json({ error: "orderId (number) is required" });
      return;
    }

    const payload: { amount?: number; speed?: "normal" | "optimum"; notes?: Record<string, string> } = {};
    if (amount !== undefined && typeof amount === "number" && amount > 0) payload.amount = Math.round(amount);
    if (speed === "optimum" || speed === "normal") payload.speed = speed;
    if (notes && typeof notes === "string") payload.notes = { reason: notes };

    const [existing] = await db
      .select({ id: razorpayRefundsTable.id })
      .from(razorpayRefundsTable)
      .where(and(
        eq(razorpayRefundsTable.orderId, orderId),
        eq(razorpayRefundsTable.status, "PENDING"),
      ))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "A pending refund for this order already exists." });
      return;
    }

    const refundResp = await razorpayCreateRefund(keyId, keySecret, razorpayPaymentId, payload);

    const refundId = refundResp.parsed.id ?? null;
    const amountInr = payload.amount !== undefined
      ? (payload.amount / 100).toFixed(2)
      : (amount !== undefined ? String(amount) : "0.00");

    const [inserted] = await db
      .insert(razorpayRefundsTable)
      .values({
        orderId,
        razorpayPaymentId,
        razorpayRefundId: refundId,
        amount: amountInr,
        currency: "INR",
        status: refundResp.status === 200 ? "PROCESSED" : "PENDING",
        speed: speed ?? "normal",
        notes: notes ?? null,
        initiatedByAdminId: user.id ?? null,
        initiatedByEmail: user.email ?? null,
        providerResponse: refundResp.raw,
        processedAt: refundResp.status === 200 ? new Date() : null,
      })
      .returning();

    if (refundResp.status !== 200) {
      req.log.warn({ razorpayStatus: refundResp.status, refundId: inserted?.id }, "razorpay_refund_provider_error");
      res.status(refundResp.status >= 500 ? 502 : 422).json({
        error: "Razorpay returned an error for this refund.",
        providerStatus: refundResp.status,
        refund: inserted,
      });
      return;
    }

    res.status(201).json({ refund: inserted });
  } catch (err) { next(err); }
});

/**
 * GET /api/admin/razorpay/refunds/:refundId/status
 * Fetch live status of a specific refund from Razorpay.
 */
router.get("/refunds/:refundId/status", requireSuperAdmin, async (req, res, next) => {
  try {
    const refundId  = req.params["refundId"] as string;
    const keyId     = process.env["RAZORPAY_KEY_ID"]     ?? "";
    const keySecret = process.env["RAZORPAY_KEY_SECRET"] ?? "";

    if (!keyId || !keySecret) {
      res.status(503).json({ error: "Razorpay credentials not configured." });
      return;
    }

    if (!refundId || refundId === "undefined") {
      res.status(400).json({ error: "refundId is required" });
      return;
    }

    const resp = await razorpayFetchRefund(keyId, keySecret, refundId);

    if (resp.status === 200 && resp.parsed.status) {
      const providerStatus = String(resp.parsed.status).toUpperCase();
      const dbStatus =
        providerStatus === "PROCESSED" ? "PROCESSED" :
        providerStatus === "FAILED"    ? "FAILED"    : "PENDING";

      await db
        .update(razorpayRefundsTable)
        .set({ status: dbStatus, updatedAt: new Date() })
        .where(eq(razorpayRefundsTable.razorpayRefundId, refundId));
    }

    res.json({ status: resp.parsed.status ?? "unknown", raw: resp.parsed });
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// RAZORPAYX VERIFICATION
// ────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/razorpay/razorpayx/verify
 * Probe RazorpayX Payouts API and persist the result to system_config.
 * Safe: uses a read-only contacts list call with no financial side effects.
 */
router.get("/razorpayx/verify", requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await verifyRazorpayXActivation();

    const now = new Date().toISOString();
    const statusValue = result.activated ? "pass" : (result.keyConfigured ? "fail" : "not_configured");

    await db.insert(systemConfigTable)
      .values({ key: SYSTEM_CONFIG_KEYS.RAZORPAY_X_VERIFICATION_STATUS, value: statusValue })
      .onConflictDoUpdate({ target: systemConfigTable.key, set: { value: statusValue } });

    await db.insert(systemConfigTable)
      .values({ key: SYSTEM_CONFIG_KEYS.RAZORPAY_X_VERIFIED_AT, value: now })
      .onConflictDoUpdate({ target: systemConfigTable.key, set: { value: now } });

    if (!result.activated) {
      await db.insert(systemConfigTable)
        .values({ key: SYSTEM_CONFIG_KEYS.RAZORPAY_X_FAILURE_REASON, value: result.message })
        .onConflictDoUpdate({ target: systemConfigTable.key, set: { value: result.message } });
    }

    res.json({ ...result, verifiedAt: now });
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
// SETTLEMENT OVERVIEW
// ────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/razorpay/settlement-overview
 * Returns cached Razorpay settlement data from system_config.
 * The cache is populated by the webhook handler when settlement events arrive.
 */
router.get("/settlement-overview", requireSuperAdmin, async (req, res, next) => {
  try {
    const settleKeys = [
      SYSTEM_CONFIG_KEYS.RAZORPAY_SETTLEMENT_YESTERDAY_AMOUNT,
      SYSTEM_CONFIG_KEYS.RAZORPAY_SETTLEMENT_TODAY_AMOUNT,
      SYSTEM_CONFIG_KEYS.RAZORPAY_SETTLEMENT_NEXT_DATE,
      SYSTEM_CONFIG_KEYS.RAZORPAY_SETTLEMENT_BALANCE,
      SYSTEM_CONFIG_KEYS.RAZORPAY_SETTLEMENT_LAST_UTR,
      SYSTEM_CONFIG_KEYS.RAZORPAY_SETTLEMENT_LAST_UPDATED_AT,
      SYSTEM_CONFIG_KEYS.RAZORPAY_X_VERIFICATION_STATUS,
      SYSTEM_CONFIG_KEYS.RAZORPAY_X_VERIFIED_AT,
    ];
    const rows = await db.select().from(systemConfigTable).where(inArray(systemConfigTable.key, settleKeys));
    const cfg = new Map(rows.map(r => [r.key, r.value]));

    const xStatus = cfg.get(SYSTEM_CONFIG_KEYS.RAZORPAY_X_VERIFICATION_STATUS) ?? "not_checked";

    res.json({
      settlement: {
        yesterdayAmount: cfg.get(SYSTEM_CONFIG_KEYS.RAZORPAY_SETTLEMENT_YESTERDAY_AMOUNT) ?? null,
        todayAmount:     cfg.get(SYSTEM_CONFIG_KEYS.RAZORPAY_SETTLEMENT_TODAY_AMOUNT) ?? null,
        nextDate:        cfg.get(SYSTEM_CONFIG_KEYS.RAZORPAY_SETTLEMENT_NEXT_DATE) ?? null,
        balance:         cfg.get(SYSTEM_CONFIG_KEYS.RAZORPAY_SETTLEMENT_BALANCE) ?? null,
        lastUtr:         cfg.get(SYSTEM_CONFIG_KEYS.RAZORPAY_SETTLEMENT_LAST_UTR) ?? null,
        lastUpdatedAt:   cfg.get(SYSTEM_CONFIG_KEYS.RAZORPAY_SETTLEMENT_LAST_UPDATED_AT) ?? null,
      },
      razorpayx: {
        verificationStatus: xStatus,
        verifiedAt:         cfg.get(SYSTEM_CONFIG_KEYS.RAZORPAY_X_VERIFIED_AT) ?? null,
        activated:          xStatus === "pass",
      },
    });
  } catch (err) { next(err); }
});

export default router;
