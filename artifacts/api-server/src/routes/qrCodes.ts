import { Router, type Request } from "express";
import { db, qrCodesTable, merchantsTable, merchantConnectionsTable, transactionsTable, qrPaymentEventsTable, auditLogsTable, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS, providerIntegrationsTable } from "@workspace/db";
import { eq, and, ilike, count, sql, or, desc, gte, lte, inArray, type SQL } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { checkPlanLimit, rejectWithLimitError } from "../helpers/planLimits";
import { makeRateLimiter } from "../helpers/makeRateLimiter";
import { ekqrCreateOrder, ekqrCheckOrderStatus, ekqrClientTxnId, ekqrFormatDate } from "../helpers/ekqr";
import { createCustomGatewayOrder } from "../helpers/customGatewayClient";
import { logger } from "../lib/logger";

const qrCodeCreateLimiter = makeRateLimiter({
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: (req) => (req as Request & { user?: { merchantId?: number | null } }).user?.merchantId,
  message: { error: "Too many QR code creation requests. Please slow down and try again shortly." },
});

const qrCodeUpdateLimiter = makeRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  keyGenerator: (req) => (req as Request & { user?: { merchantId?: number | null } }).user?.merchantId,
  message: { error: "Too many QR code update requests. Please slow down and try again in a few minutes." },
});

async function logQrAudit(req: any, action: string, targetId: number | null, details: object) {
  await db.insert(auditLogsTable).values({
    adminId: req.user.id,
    adminEmail: req.user.email,
    action,
    targetType: "qr_code",
    targetId,
    details: JSON.stringify(details),
    ipAddress: req.ip ?? null,
  });
}

const PROVIDER_VPA_SUFFIX: Record<string, string> = {
  phonepe: "ybl",
  paytm: "paytm",
  bharatpe: "bharatpe",
  yono_sbi: "sbi",
  hdfc_smarthub: "hdfcbank",
};

function deriveVpa(provider: string, credentials: string | null): string | null {
  let creds: Record<string, string> = {};
  let isJson = false;
  try { if (credentials) { creds = JSON.parse(credentials); isJson = true; } } catch {}

  // Any provider may store a pre-formed VPA directly under the "vpa" key
  if (creds["vpa"]) return creds["vpa"];

  if (provider === "upi_id") {
    return creds["UPI ID"] ?? (!isJson && credentials ? credentials : null);
  }

  const suffix = PROVIDER_VPA_SUFFIX[provider];
  const mid = creds["Merchant ID"] ?? creds["MID"] ?? null;
  if (mid && suffix) return `${mid}@${suffix}`;
  return null;
}

function deriveDisplayName(provider: string, credentials: string | null, fallback: string): string {
  let creds: Record<string, string> = {};
  try { if (credentials) creds = JSON.parse(credentials); } catch {}
  if (provider === "upi_id") return creds["Display Name"] || fallback;
  return fallback;
}

function buildUpiPayload(vpa: string, name: string, amount: string | null, note: string | null): string {
  const params = new URLSearchParams({ pa: vpa, pn: name, cu: "INR" });
  if (amount) params.set("am", amount);
  if (note) params.set("tn", note);
  return `upi://pay?${params.toString()}`;
}

function serializeQr(qr: typeof qrCodesTable.$inferSelect, merchantName?: string | null, scanCount = 0) {
  return {
    ...qr,
    merchantName: merchantName ?? null,
    expiresAt: qr.expiresAt instanceof Date ? qr.expiresAt.toISOString() : qr.expiresAt,
    scanCount,
  };
}

const router = Router();

// Public endpoint — no auth required — must be registered before requireAuth middleware
// GET /api/qr-codes/public/:id
router.get("/public/:id", async (req, res) => {
  await expireOldQrCodes().catch(() => {});
  const id = parseInt(req.params['id'] as string);
  if (isNaN(id)) { res.status(404).json({ error: "QR code not found" }); return; }

  const rows = await db.select({
    qr: qrCodesTable,
    merchantName: merchantsTable.businessName,
    logoUrl: merchantsTable.logoUrl,
    brandColor: merchantsTable.brandColor,
  })
    .from(qrCodesTable)
    .leftJoin(merchantsTable, eq(qrCodesTable.merchantId, merchantsTable.id))
    .where(eq(qrCodesTable.id, id))
    .limit(1);

  if (!rows.length) { res.status(404).json({ error: "QR code not found" }); return; }

  const { qr, merchantName, logoUrl, brandColor } = rows[0];
  res.json({
    id: qr.id,
    merchantId: qr.merchantId,
    type: qr.type,
    label: qr.label ?? null,
    payload: qr.payload,
    amount: qr.amount ?? null,
    status: qr.status,
    expiresAt: qr.expiresAt instanceof Date ? qr.expiresAt.toISOString() : (qr.expiresAt ?? null),
    merchantName: merchantName ?? null,
    logoUrl: logoUrl ?? null,
    brandColor: brandColor ?? null,
  });
});

router.use(requireAuth);

// Auto-expire QR codes
async function expireOldQrCodes() {
  await db.execute(sql`
    UPDATE qr_codes SET status = 'expired'
    WHERE expires_at IS NOT NULL AND expires_at < NOW() AND status = 'active'
  `);
}

// GET /api/qr-codes
router.get("/", async (req, res) => {
  await expireOldQrCodes().catch(() => {});
  const user = (req as any).user;
  const { type, status, search, merchantId, merchantName, dateFrom, dateTo, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const qrConditions: SQL<unknown>[] = [];
  const merchantConditions: SQL<unknown>[] = [];
  if (user.role !== "admin") qrConditions.push(eq(qrCodesTable.merchantId, user.merchantId!));
  if (merchantId && user.role === "admin") qrConditions.push(eq(qrCodesTable.merchantId, parseInt(merchantId)));
  if (type && type !== "all") qrConditions.push(eq(qrCodesTable.type, type));
  if (status && status !== "all") qrConditions.push(eq(qrCodesTable.status, status));
  if (dateFrom) qrConditions.push(gte(qrCodesTable.createdAt, new Date(dateFrom)));
  if (dateTo) {
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);
    qrConditions.push(lte(qrCodesTable.createdAt, to));
  }
  if (search) {
    qrConditions.push(or(
      ilike(qrCodesTable.orderId, `%${search}%`),
      ilike(qrCodesTable.merchantReference, `%${search}%`),
      ilike(qrCodesTable.label, `%${search}%`),
    )!);
  }
  if (merchantName && user.role === "admin") {
    merchantConditions.push(ilike(merchantsTable.businessName, `%${merchantName}%`));
  }

  const allConditions = [...qrConditions, ...merchantConditions];
  const where = allConditions.length > 0 ? and(...allConditions) : undefined;

  const countRows = await db.select({ total: count() })
    .from(qrCodesTable)
    .leftJoin(merchantsTable, eq(qrCodesTable.merchantId, merchantsTable.id))
    .where(where);
  const total = countRows[0].total;

  const scanCountSq = sql<number>`(SELECT COUNT(*) FROM transactions WHERE qr_code_id = ${qrCodesTable.id})`;

  const rows = await db.select({
    qr: qrCodesTable,
    merchantName: merchantsTable.businessName,
    scanCount: scanCountSq,
  })
    .from(qrCodesTable)
    .leftJoin(merchantsTable, eq(qrCodesTable.merchantId, merchantsTable.id))
    .where(where)
    .limit(limitNum).offset(offset)
    .orderBy(desc(qrCodesTable.createdAt));

  res.json({
    data: rows.map(r => serializeQr(r.qr, r.merchantName, Number(r.scanCount ?? 0))),
    total, page: pageNum, limit: limitNum,
  });
});

// GET /api/qr-codes/stats
router.get("/stats", async (req, res) => {
  await expireOldQrCodes().catch(() => {});
  const user = (req as any).user;
  const { merchantName, search, dateFrom, dateTo } = req.query as Record<string, string>;

  const qrConditions: SQL<unknown>[] = [];
  const merchantConditions: SQL<unknown>[] = [];

  if (user.role !== "admin") {
    qrConditions.push(eq(qrCodesTable.merchantId, user.merchantId!));
  }
  if (search) {
    qrConditions.push(or(
      ilike(qrCodesTable.orderId, `%${search}%`),
      ilike(qrCodesTable.merchantReference, `%${search}%`),
      ilike(qrCodesTable.label, `%${search}%`),
    )!);
  }
  if (dateFrom) qrConditions.push(gte(qrCodesTable.createdAt, new Date(dateFrom)));
  if (dateTo) {
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);
    qrConditions.push(lte(qrCodesTable.createdAt, to));
  }
  if (merchantName && user.role === "admin") {
    merchantConditions.push(ilike(merchantsTable.businessName, `%${merchantName}%`));
  }

  const needsJoin = merchantConditions.length > 0;

  const buildWhere = (extraStatus?: string) => {
    const conditions = [...qrConditions, ...merchantConditions];
    if (extraStatus) conditions.push(eq(qrCodesTable.status, extraStatus));
    return conditions.length ? and(...conditions) : undefined;
  };

  const runCount = (extraStatus?: string) => {
    const where = buildWhere(extraStatus);
    if (needsJoin) {
      return db.select({ n: count() })
        .from(qrCodesTable)
        .leftJoin(merchantsTable, eq(qrCodesTable.merchantId, merchantsTable.id))
        .where(where);
    }
    return db.select({ n: count() }).from(qrCodesTable).where(where);
  };

  const [totalRow, activeRow, usedRow, expiredRow] = await Promise.all([
    runCount(),
    runCount("active"),
    runCount("used"),
    runCount("expired"),
  ]);

  res.json({
    total: totalRow[0].n,
    active: activeRow[0].n,
    used: usedRow[0].n,
    expired: expiredRow[0].n,
  });
});

// GET /api/qr-codes/:id/activity
router.get("/:id/activity", async (req, res) => {
  await expireOldQrCodes().catch(() => {});
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);

  const conditions = [eq(qrCodesTable.id, id)];
  if (user.role !== "admin") conditions.push(eq(qrCodesTable.merchantId, user.merchantId!));

  const rows = await db.select({ qr: qrCodesTable })
    .from(qrCodesTable)
    .where(and(...conditions))
    .limit(1);

  if (!rows.length) { res.status(404).json({ error: "QR code not found" }); return; }

  const events = await db.select()
    .from(qrPaymentEventsTable)
    .where(eq(qrPaymentEventsTable.qrCodeId, id))
    .orderBy(desc(qrPaymentEventsTable.receivedAt))
    .limit(50);

  const data = events.map(ev => ({
    id: ev.id,
    qrCodeId: ev.qrCodeId,
    merchantId: ev.merchantId,
    transactionId: ev.transactionId ?? null,
    amount: ev.amount ?? null,
    orderId: ev.orderId ?? null,
    merchantReference: ev.merchantReference ?? null,
    status: "success" as const,
    receivedAt: ev.receivedAt instanceof Date ? ev.receivedAt.toISOString() : ev.receivedAt,
  }));

  res.json({ data });
});

// GET /api/qr-codes/:id
router.get("/:id", async (req, res) => {
  await expireOldQrCodes().catch(() => {});
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);

  const conditions = [eq(qrCodesTable.id, id)];
  if (user.role !== "admin") conditions.push(eq(qrCodesTable.merchantId, user.merchantId!));

  const scanCountSq = sql<number>`(SELECT COUNT(*) FROM transactions WHERE qr_code_id = ${qrCodesTable.id})`;

  const rows = await db.select({
    qr: qrCodesTable,
    merchantName: merchantsTable.businessName,
    scanCount: scanCountSq,
  })
    .from(qrCodesTable)
    .leftJoin(merchantsTable, eq(qrCodesTable.merchantId, merchantsTable.id))
    .where(and(...conditions))
    .limit(1);

  if (!rows.length) { res.status(404).json({ error: "QR code not found" }); return; }
  res.json(serializeQr(rows[0].qr, rows[0].merchantName, Number(rows[0].scanCount ?? 0)));
});

// POST /api/qr-codes
router.post("/", qrCodeCreateLimiter, async (req, res) => {
  const user = (req as any).user;
  const merchantId = user.merchantId!;
  const { type, label, amount, orderId, expiresAt, callbackUrl, merchantReference } = req.body;
  if (!type) { res.status(400).json({ error: "type required" }); return; }

  // Enforce plan limits
  const limitType = type === "dynamic" ? "dynamicQr" : "staticQr";
  const limitCheck = await checkPlanLimit(merchantId, limitType, user.id);
  if (!limitCheck.allowed) { rejectWithLimitError(res, limitCheck.message!); return; }

  // Fetch active connections and merchant info in parallel
  const [connections, [merchant]] = await Promise.all([
    db.select()
      .from(merchantConnectionsTable)
      .where(and(eq(merchantConnectionsTable.merchantId, merchantId), eq(merchantConnectionsTable.isActive, true)))
      .limit(10),
    db.select({ businessName: merchantsTable.businessName })
      .from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1),
  ]);

  // ── EKQR path: if merchant has an active EKQR connection and EKQR is globally enabled ──
  const ekqrConn = connections.find(c => c.provider === "ekqr");
  if (ekqrConn) {
    // Check global EKQR enabled flag, API key, and amount limits
    const ekqrRows = await db.select()
      .from(systemConfigTable)
      .where(inArray(systemConfigTable.key, [
        SYSTEM_CONFIG_KEYS.EKQR_ENABLED,
        SYSTEM_CONFIG_KEYS.EKQR_API_KEY,
        SYSTEM_CONFIG_KEYS.EKQR_MIN_AMOUNT,
        SYSTEM_CONFIG_KEYS.EKQR_MAX_AMOUNT,
        SYSTEM_CONFIG_KEYS.EKQR_DAILY_LIMIT,
      ]));
    const ekqrMap = new Map(ekqrRows.map(r => [r.key, r.value]));
    const ekqrEnabled = ekqrMap.get(SYSTEM_CONFIG_KEYS.EKQR_ENABLED) === "true";
    const ekqrApiKey = ekqrMap.get(SYSTEM_CONFIG_KEYS.EKQR_API_KEY) ?? "";

    if (ekqrEnabled && ekqrApiKey) {
      // ── EKQR amount and daily-volume limit enforcement ──
      // Enforce admin-configured limits before calling the gateway so the
      // merchant receives a clear 400 rather than a raw provider error.
      const _eMin = parseFloat(ekqrMap.get(SYSTEM_CONFIG_KEYS.EKQR_MIN_AMOUNT) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.EKQR_MIN_AMOUNT]);
      const _eMax = parseFloat(ekqrMap.get(SYSTEM_CONFIG_KEYS.EKQR_MAX_AMOUNT) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.EKQR_MAX_AMOUNT]);
      const _eDaily = parseFloat(ekqrMap.get(SYSTEM_CONFIG_KEYS.EKQR_DAILY_LIMIT) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.EKQR_DAILY_LIMIT]);
      const ekqrMinAmount = Number.isFinite(_eMin) ? _eMin : 1;
      const ekqrMaxAmount = Number.isFinite(_eMax) ? _eMax : 200000;
      const ekqrDailyLimit = Number.isFinite(_eDaily) ? _eDaily : 1000000;

      const parsedAmount = amount != null ? Number(amount) : null;
      if (parsedAmount !== null && !isNaN(parsedAmount)) {
        if (parsedAmount < ekqrMinAmount || parsedAmount > ekqrMaxAmount) {
          res.status(400).json({ error: `Amount must be between ₹${ekqrMinAmount} and ₹${ekqrMaxAmount}` });
          return;
        }

        // Daily limit: sum amounts from today's EKQR QR payment events for this merchant.
        // Join with qrCodesTable to scope to EKQR-originated QR codes only
        // (ekqrOrderId IS NOT NULL), so non-EKQR QR payments don't count against
        // this provider's cap.
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const [dailyRow] = await db
          .select({ total: sql<string>`COALESCE(SUM(${qrPaymentEventsTable.amount}::numeric), 0)` })
          .from(qrPaymentEventsTable)
          .innerJoin(qrCodesTable, and(
            eq(qrCodesTable.id, qrPaymentEventsTable.qrCodeId),
            sql`${qrCodesTable.ekqrOrderId} IS NOT NULL`,
          ))
          .where(and(
            eq(qrPaymentEventsTable.merchantId, merchantId),
            gte(qrPaymentEventsTable.receivedAt, startOfDay),
          ));
        const ekqrDailyTotal = Number(dailyRow?.total ?? 0);
        if (ekqrDailyTotal + parsedAmount > ekqrDailyLimit) {
          res.status(400).json({ error: "Daily deposit limit reached for this payment method. Please try again tomorrow or contact support." });
          return;
        }
      }

      // Insert QR row first to get the ID for client_txn_id
      const clientTxnId = ekqrClientTxnId(Date.now()); // temp ID, will update after insert
      const [row] = await db.insert(qrCodesTable).values({
        merchantId, type, label: label ?? null,
        payload: "", // placeholder — updated after EKQR responds
        amount: amount ?? null,
        orderId: orderId ?? null,
        callbackUrl: callbackUrl ?? null,
        merchantReference: merchantReference ?? null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      }).returning();

      const finalClientTxnId = ekqrClientTxnId(row.id);
      const redirectUrl = `https://rasokart.com/merchant/qr-codes`;

      try {
        const { raw, parsed } = await ekqrCreateOrder({
          key: ekqrApiKey,
          client_txn_id: finalClientTxnId,
          amount: amount ?? "1",
          p_info: label ?? merchantReference ?? "QR Payment",
          customer_name: merchant?.businessName ?? "Customer",
          customer_email: "payments@rasokart.com",
          customer_mobile: "9999999999",
          redirect_url: redirectUrl,
          udf1: String(row.id),
          udf2: String(merchantId),
        });

        logger.info({ qrId: row.id, status: parsed.status, msg: parsed.msg }, "EKQR create_order result");

        const paymentUrl = parsed.payment_url ?? "";
        const upiPayload = paymentUrl || `ekqr://pay?txn=${finalClientTxnId}`;

        await db.update(qrCodesTable).set({
          payload: upiPayload,
          ekqrOrderId: finalClientTxnId,
          ekqrPaymentUrl: paymentUrl || null,
        }).where(eq(qrCodesTable.id, row.id));

        const updatedRow = { ...row, payload: upiPayload, ekqrOrderId: finalClientTxnId, ekqrPaymentUrl: paymentUrl || null };
        await logQrAudit(req, "qr_code_created", row.id, { label: row.label ?? null, type: row.type, merchantId, provider: "ekqr", ekqrStatus: parsed.status });

        res.status(201).json({
          ...serializeQr(updatedRow as typeof row, merchant?.businessName ?? null),
          provider: "ekqr",
          ekqrPaymentUrl: paymentUrl || null,
          ekqrRaw: raw,
        });
      } catch (err) {
        // EKQR call failed — delete the placeholder row and return error
        await db.delete(qrCodesTable).where(eq(qrCodesTable.id, row.id)).catch(() => {});
        logger.error({ err, qrId: row.id }, "EKQR create_order failed");
        res.status(502).json({ error: "EKQR gateway error. Please try again." });
      }
      return;
    }
  }

  // ── Custom gateway path: merchant has an active connection whose provider
  // matches an admin-added, enabled custom gateway (provider_integrations) ──
  const customConn = connections.find(c => c.provider && !["ekqr", "upi_id"].includes(c.provider) && !(c.provider in PROVIDER_VPA_SUFFIX));
  if (customConn) {
    const [integration] = await db.select().from(providerIntegrationsTable)
      .where(and(
        eq(providerIntegrationsTable.providerKey, customConn.provider),
        eq(providerIntegrationsTable.isEnabled, true),
        eq(providerIntegrationsTable.isCustom, true),
      )).limit(1);

    if (integration) {
      const [row] = await db.insert(qrCodesTable).values({
        merchantId, type, label: label ?? null,
        payload: "", // placeholder — updated after the gateway responds
        amount: amount ?? null,
        orderId: orderId ?? null,
        callbackUrl: callbackUrl ?? null,
        merchantReference: merchantReference ?? null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        providerKey: integration.providerKey,
      }).returning();

      const gatewayOrderId = `RKQR_${row.id}`;
      const gatewayResult = await createCustomGatewayOrder(integration, {
        publicOrderId: gatewayOrderId,
        amount: Number(amount ?? 1),
        currency: "INR",
        customerName: merchant?.businessName ?? "Customer",
        note: label ?? merchantReference ?? "QR Payment",
      });

      if (!gatewayResult.ok || !gatewayResult.providerOrderId) {
        await db.delete(qrCodesTable).where(eq(qrCodesTable.id, row.id)).catch(() => {});
        logger.error({ qrId: row.id, providerKey: integration.providerKey, errorMessage: gatewayResult.errorMessage }, "Custom gateway create_order failed");
        res.status(502).json({ error: "Payment gateway error. Please try again." });
        return;
      }

      const upiPayload = gatewayResult.paymentUrl || `upi://pay?tid=${gatewayResult.providerOrderId}`;

      await db.update(qrCodesTable).set({
        payload: upiPayload,
        providerOrderId: gatewayResult.providerOrderId,
        providerPaymentUrl: gatewayResult.paymentUrl ?? null,
      }).where(eq(qrCodesTable.id, row.id));

      const updatedRow = { ...row, payload: upiPayload, providerOrderId: gatewayResult.providerOrderId, providerPaymentUrl: gatewayResult.paymentUrl ?? null };
      await logQrAudit(req, "qr_code_created", row.id, { label: row.label ?? null, type: row.type, merchantId, provider: integration.providerKey });

      res.status(201).json({
        ...serializeQr(updatedRow as typeof row, merchant?.businessName ?? null),
        provider: integration.providerKey,
        providerPaymentUrl: gatewayResult.paymentUrl ?? null,
      });
      return;
    }
  }

  // ── Standard UPI path ────────────────────────────────────────────────────
  // Priority: upi_id first, then others
  const sorted = [...connections].sort(a => a.provider === "upi_id" ? -1 : 1);
  let vpa: string | null = null;
  let activeConn: typeof connections[0] | undefined;
  for (const conn of sorted) {
    vpa = deriveVpa(conn.provider, conn.credentials ?? null);
    if (vpa) { activeConn = conn; break; }
  }

  if (!vpa || !activeConn) {
    res.status(400).json({ error: "No active payment provider connected. Please connect a provider first." });
    return;
  }

  const displayName = deriveDisplayName(activeConn.provider, activeConn.credentials ?? null, merchant?.businessName ?? "Merchant");

  // Include amount in UPI payload for both static (fixed) and dynamic (pre-filled hint)
  const payload = buildUpiPayload(vpa, displayName, amount ?? null, label ?? merchantReference ?? null);

  const [row] = await db.insert(qrCodesTable).values({
    merchantId, type, label: label ?? null, payload,
    amount: amount ?? null,
    orderId: orderId ?? null,
    callbackUrl: callbackUrl ?? null,
    merchantReference: merchantReference ?? null,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
  }).returning();

  await logQrAudit(req, "qr_code_created", row.id, { label: row.label ?? null, type: row.type, merchantId });

  res.status(201).json({
    ...serializeQr(row, merchant?.businessName ?? null),
    vpa,
    provider: activeConn.provider,
  });
});

// PUT /api/qr-codes/:id
router.put("/:id", qrCodeUpdateLimiter, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);
  const { label, status, callbackUrl, merchantReference } = req.body;
  const update: Record<string, unknown> = {};
  if (label !== undefined) update.label = label;
  if (status !== undefined) update.status = status;
  if (callbackUrl !== undefined) update.callbackUrl = callbackUrl;
  if (merchantReference !== undefined) update.merchantReference = merchantReference;

  const conditions = [eq(qrCodesTable.id, id)];
  if (user.role !== "admin") conditions.push(eq(qrCodesTable.merchantId, user.merchantId!));

  const [row] = await db.update(qrCodesTable).set(update).where(and(...conditions)).returning();
  if (!row) { res.status(404).json({ error: "QR code not found" }); return; }

  await logQrAudit(req, "qr_code_updated", id, {
    label: row.label ?? null,
    changes: Object.keys(update),
  });

  res.json(serializeQr(row));
});

// DELETE /api/qr-codes/:id
router.delete("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);
  const conditions = [eq(qrCodesTable.id, id)];
  if (user.role !== "admin") conditions.push(eq(qrCodesTable.merchantId, user.merchantId!));

  const [existing] = await db.select().from(qrCodesTable).where(and(...conditions)).limit(1);

  await db.delete(qrCodesTable).where(and(...conditions));

  if (existing) {
    await logQrAudit(req, "qr_code_deleted", id, { label: existing.label ?? null, type: existing.type });
  }

  res.json({ message: "QR code deleted" });
});

// POST /api/qr-codes/bulk-delete
router.post("/bulk-delete", async (req, res) => {
  const user = (req as any).user;
  const merchantId = user.merchantId as number | undefined;
  const { ids, status } = req.body as { ids?: number[]; status?: string };

  const allowedStatuses = ["expired", "used"];
  if (!ids?.length && !status) {
    res.status(400).json({ error: "Provide ids or status to bulk delete" });
    return;
  }
  if (status && !allowedStatuses.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${allowedStatuses.join(", ")}` });
    return;
  }

  const conditions: ReturnType<typeof eq>[] = [];

  // Merchants can only delete their own codes; admins can delete any
  if (user.role !== "admin") {
    if (!merchantId) { res.status(403).json({ error: "Forbidden" }); return; }
    conditions.push(eq(qrCodesTable.merchantId, merchantId));
  }

  if (ids?.length) {
    conditions.push(inArray(qrCodesTable.id, ids));
  } else if (status) {
    conditions.push(eq(qrCodesTable.status, status));
  }

  const deleted = await db.delete(qrCodesTable)
    .where(and(...conditions))
    .returning({ id: qrCodesTable.id });

  res.json({ deleted: deleted.length });
});

// POST /api/qr-codes/:id/ekqr-sync
// Admin or owning merchant: calls EKQR check_order_status and returns the result.
router.post("/:id/ekqr-sync", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);

  const conditions = [eq(qrCodesTable.id, id)];
  if (user.role !== "admin") conditions.push(eq(qrCodesTable.merchantId, user.merchantId!));

  const [qr] = await db.select().from(qrCodesTable).where(and(...conditions)).limit(1);
  if (!qr) { res.status(404).json({ error: "QR code not found" }); return; }

  if (!qr.ekqrOrderId) {
    res.status(400).json({ error: "This QR code was not created via EKQR" });
    return;
  }

  // Load EKQR API key
  const [keyRow] = await db.select({ value: systemConfigTable.value })
    .from(systemConfigTable).where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.EKQR_API_KEY)).limit(1);
  const apiKey = keyRow?.value ?? "";
  if (!apiKey) { res.status(400).json({ error: "EKQR API key is not configured" }); return; }

  const txnDate = ekqrFormatDate(qr.createdAt instanceof Date ? qr.createdAt : new Date(qr.createdAt));

  const { raw, parsed } = await ekqrCheckOrderStatus(apiKey, qr.ekqrOrderId, txnDate);

  logger.info({ qrId: id, ekqrOrderId: qr.ekqrOrderId, status: parsed.data?.status }, "EKQR status sync");

  // Auto-update QR status if EKQR confirms payment
  const ekqrConfirmed = parsed.status === true && parsed.data?.status?.toUpperCase() === "SUCCESS";
  const newStatus = ekqrConfirmed && qr.status === "active" ? "used" : qr.status;
  if (newStatus !== qr.status) {
    await db.update(qrCodesTable).set({ status: newStatus }).where(eq(qrCodesTable.id, id));
  }

  res.json({ raw, parsed, qrStatus: newStatus });
});

export default router;
