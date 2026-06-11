import { Router, type Request } from "express";
import { db, qrCodesTable, merchantsTable, merchantConnectionsTable, transactionsTable, qrPaymentEventsTable, auditLogsTable } from "@workspace/db";
import { eq, and, ilike, count, sql, or, desc, gte, lte, inArray, type SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { checkPlanLimit, rejectWithLimitError } from "../helpers/planLimits";
import rateLimit from "express-rate-limit";

const qrCodeCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req: Request) => String((req as Request & { user?: { merchantId?: number | null; id: number } }).user?.merchantId ?? req.ip),
  message: { error: "Too many QR code creation requests. Please slow down and try again shortly." },
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

  // Fetch active connection to auto-generate UPI payload
  const connections = await db.select()
    .from(merchantConnectionsTable)
    .where(and(eq(merchantConnectionsTable.merchantId, merchantId), eq(merchantConnectionsTable.isActive, true)))
    .limit(10);

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

  // Get merchant business name for display
  const [merchant] = await db.select({ businessName: merchantsTable.businessName })
    .from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
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
router.put("/:id", async (req, res) => {
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

export default router;
