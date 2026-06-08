import { Router } from "express";
import { db, settlementsTable, merchantsTable } from "@workspace/db";
import { eq, and, count, sql, gte, lte, sum } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

function mapSettlement(s: typeof settlementsTable.$inferSelect, merchantName?: string | null) {
  return {
    ...s,
    amount: Number(s.amount),
    requestedAmount: s.requestedAmount != null ? Number(s.requestedAmount) : null,
    merchantName: merchantName ?? null,
  };
}

// GET /api/settlements/stats  (admin only)
router.get("/stats", requireAdmin, async (_req, res) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [pendingRow] = await db
    .select({ total: sum(settlementsTable.requestedAmount) })
    .from(settlementsTable)
    .where(eq(settlementsTable.status, "pending"));

  const [paidRow] = await db
    .select({ total: sum(settlementsTable.requestedAmount) })
    .from(settlementsTable)
    .where(and(eq(settlementsTable.status, "paid"), gte(settlementsTable.paidAt, startOfMonth)));

  const statusRows = await db
    .select({ status: settlementsTable.status, cnt: count() })
    .from(settlementsTable)
    .groupBy(settlementsTable.status);

  const counts: Record<string, number> = {};
  for (const r of statusRows) counts[r.status] = Number(r.cnt);

  res.json({
    pendingTotal: Number(pendingRow?.total ?? 0),
    paidMTD: Number(paidRow?.total ?? 0),
    counts,
  });
});

// GET /api/settlements
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const { merchantId, status, dateFrom, dateTo, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions: ReturnType<typeof eq>[] = [];
  if (user.role !== "admin") conditions.push(eq(settlementsTable.merchantId, user.merchantId!));
  if (merchantId && user.role === "admin") conditions.push(eq(settlementsTable.merchantId, parseInt(merchantId)));
  if (status && status !== "all") conditions.push(eq(settlementsTable.status, status));
  if (dateFrom) conditions.push(gte(settlementsTable.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(settlementsTable.createdAt, new Date(dateTo)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(settlementsTable).where(where);

  const rows = await db
    .select({ settlement: settlementsTable, merchantName: merchantsTable.businessName })
    .from(settlementsTable)
    .leftJoin(merchantsTable, eq(settlementsTable.merchantId, merchantsTable.id))
    .where(where)
    .limit(limitNum)
    .offset(offset)
    .orderBy(sql`${settlementsTable.createdAt} DESC`);

  res.json({
    data: rows.map(r => mapSettlement(r.settlement, r.merchantName)),
    total,
    page: pageNum,
    limit: limitNum,
  });
});

// GET /api/settlements/export/csv  (admin only)
router.get("/export/csv", requireAdmin, async (req, res) => {
  const { merchantId, dateFrom, dateTo, search, status } = req.query as Record<string, string>;

  const conditions: ReturnType<typeof eq>[] = [];
  if (merchantId) conditions.push(eq(settlementsTable.merchantId, parseInt(merchantId)));
  if (status && status !== "all") conditions.push(eq(settlementsTable.status, status));
  if (dateFrom) conditions.push(gte(settlementsTable.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(settlementsTable.createdAt, new Date(dateTo)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({ settlement: settlementsTable, merchantName: merchantsTable.businessName })
    .from(settlementsTable)
    .leftJoin(merchantsTable, eq(settlementsTable.merchantId, merchantsTable.id))
    .where(where)
    .orderBy(sql`${settlementsTable.createdAt} DESC`);

  const filtered = search
    ? rows.filter(r => r.merchantName?.toLowerCase().includes(search.toLowerCase()))
    : rows;

  const header = ["ID", "Merchant", "Requested Amount", "Currency", "Status", "Admin Remark", "Reference", "Paid At", "Created"];
  const csvRows = filtered.map(r => [
    String(r.settlement.id),
    r.merchantName ?? "",
    String(Number(r.settlement.requestedAmount ?? r.settlement.amount)),
    r.settlement.currency,
    r.settlement.status,
    r.settlement.adminRemark ?? "",
    r.settlement.referenceNumber ?? "",
    r.settlement.paidAt ? (r.settlement.paidAt instanceof Date ? r.settlement.paidAt.toISOString() : String(r.settlement.paidAt)) : "",
    r.settlement.createdAt instanceof Date ? r.settlement.createdAt.toISOString() : String(r.settlement.createdAt),
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));

  const csv = [header.join(","), ...csvRows].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=\"settlements.csv\"");
  res.send(csv);
});

// POST /api/settlements  (merchant creates settlement request)
router.post("/", async (req, res) => {
  const user = (req as any).user;
  if (!user.merchantId) {
    res.status(403).json({ error: "Not a merchant" });
    return;
  }

  const { requestedAmount, requestedNote } = req.body as { requestedAmount?: number; requestedNote?: string };
  if (!requestedAmount || typeof requestedAmount !== "number" || requestedAmount <= 0) {
    res.status(400).json({ error: "requestedAmount must be a positive number" });
    return;
  }

  const [merchant] = await db.select().from(merchantsTable).where(eq(merchantsTable.id, user.merchantId)).limit(1);
  if (!merchant) {
    res.status(404).json({ error: "Merchant not found" });
    return;
  }

  if (Number(merchant.balance) < requestedAmount) {
    res.status(400).json({ error: "Insufficient balance", available: Number(merchant.balance) });
    return;
  }

  // Block duplicate in-flight requests
  const [existing] = await db.select({ id: settlementsTable.id })
    .from(settlementsTable)
    .where(and(
      eq(settlementsTable.merchantId, user.merchantId),
      sql`${settlementsTable.status} IN ('pending', 'processing')`
    ))
    .limit(1);

  if (existing) {
    res.status(400).json({ error: "You already have a pending or in-progress settlement request" });
    return;
  }

  const [settlement] = await db.insert(settlementsTable).values({
    merchantId: user.merchantId,
    amount: String(requestedAmount),
    requestedAmount: String(requestedAmount),
    requestedNote: requestedNote || undefined,
    status: "pending",
    transactionCount: 0,
  }).returning();

  res.status(201).json(mapSettlement(settlement));
});

// --- Admin action helpers ---

async function getSettlementOrFail(id: number, res: any): Promise<typeof settlementsTable.$inferSelect | null> {
  const [s] = await db.select().from(settlementsTable).where(eq(settlementsTable.id, id)).limit(1);
  if (!s) {
    res.status(404).json({ error: "Settlement not found" });
    return null;
  }
  return s;
}

function parseId(param: string | string[]): number {
  return parseInt(Array.isArray(param) ? param[0] : param);
}

function getRemark(body: any): string | null {
  const remark = body?.remark;
  return typeof remark === "string" && remark.trim() ? remark.trim() : null;
}

// POST /api/settlements/:id/process  (admin: pending → processing)
router.post("/:id/process", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseId(req.params.id);
  const s = await getSettlementOrFail(id, res);
  if (!s) return;

  if (s.status !== "pending") {
    res.status(400).json({ error: `Cannot process a settlement with status '${s.status}'` });
    return;
  }

  const remark = getRemark(req.body);
  if (!remark) { res.status(400).json({ error: "Remark is required" }); return; }

  const [updated] = await db.update(settlementsTable)
    .set({ status: "processing", adminRemark: remark, processedBy: user.id, processedAt: new Date() })
    .where(and(eq(settlementsTable.id, id), eq(settlementsTable.status, "pending")))
    .returning();

  if (!updated) {
    res.status(409).json({ error: "Settlement status changed — concurrent modification detected" });
    return;
  }

  res.json(mapSettlement(updated));
});

// POST /api/settlements/:id/approve  (admin: processing → approved, deduct balance atomically)
router.post("/:id/approve", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseId(req.params.id);
  const s = await getSettlementOrFail(id, res);
  if (!s) return;

  if (s.status !== "processing") {
    res.status(400).json({ error: `Cannot approve a settlement with status '${s.status}'. Process it first.` });
    return;
  }

  const remark = getRemark(req.body);
  if (!remark) { res.status(400).json({ error: "Remark is required" }); return; }

  const requestedAmt = Number(s.requestedAmount ?? s.amount);

  let updated: typeof settlementsTable.$inferSelect;
  try {
    updated = await db.transaction(async (tx) => {
      // Re-validate balance at approval time inside transaction
      const [merchant] = await tx.select({ balance: merchantsTable.balance })
        .from(merchantsTable)
        .where(eq(merchantsTable.id, s.merchantId))
        .limit(1);

      if (!merchant || Number(merchant.balance) < requestedAmt) {
        throw Object.assign(new Error("Insufficient balance at time of approval"), { statusCode: 400 });
      }

      // Atomically deduct balance and update settlement status
      await tx.update(merchantsTable)
        .set({ balance: sql`${merchantsTable.balance} - ${requestedAmt}::numeric` })
        .where(eq(merchantsTable.id, s.merchantId));

      const [result] = await tx.update(settlementsTable)
        .set({ status: "approved", adminRemark: remark, processedBy: user.id })
        .where(and(eq(settlementsTable.id, id), eq(settlementsTable.status, "processing")))
        .returning();

      if (!result) {
        throw Object.assign(
          new Error("Settlement status changed — concurrent modification detected"),
          { statusCode: 409 }
        );
      }

      return result;
    });
  } catch (err: any) {
    const code = err?.statusCode ?? 500;
    res.status(code).json({ error: err?.message ?? "Approval failed" });
    return;
  }

  res.json(mapSettlement(updated));
});

// POST /api/settlements/:id/reject  (admin: pending|processing → rejected)
router.post("/:id/reject", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseId(req.params.id);
  const s = await getSettlementOrFail(id, res);
  if (!s) return;

  if (!["pending", "processing"].includes(s.status)) {
    res.status(400).json({ error: `Cannot reject a settlement with status '${s.status}'` });
    return;
  }

  const remark = getRemark(req.body);
  if (!remark) { res.status(400).json({ error: "Remark is required" }); return; }

  const [updated] = await db.update(settlementsTable)
    .set({ status: "rejected", adminRemark: remark, processedBy: user.id, processedAt: new Date() })
    .where(and(eq(settlementsTable.id, id), sql`${settlementsTable.status} IN ('pending', 'processing')`))
    .returning();

  if (!updated) {
    res.status(409).json({ error: "Settlement status changed — concurrent modification detected" });
    return;
  }

  res.json(mapSettlement(updated));
});

// POST /api/settlements/:id/hold  (admin: processing → pending)
router.post("/:id/hold", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseId(req.params.id);
  const s = await getSettlementOrFail(id, res);
  if (!s) return;

  if (s.status !== "processing") {
    res.status(400).json({ error: `Cannot hold a settlement with status '${s.status}'` });
    return;
  }

  const remark = getRemark(req.body);
  if (!remark) { res.status(400).json({ error: "Remark is required" }); return; }

  const [updated] = await db.update(settlementsTable)
    .set({ status: "pending", adminRemark: remark, processedBy: user.id })
    .where(and(eq(settlementsTable.id, id), eq(settlementsTable.status, "processing")))
    .returning();

  if (!updated) {
    res.status(409).json({ error: "Settlement status changed — concurrent modification detected" });
    return;
  }

  res.json(mapSettlement(updated));
});

// POST /api/settlements/:id/mark-paid  (admin: approved → paid)
router.post("/:id/mark-paid", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseId(req.params.id);
  const s = await getSettlementOrFail(id, res);
  if (!s) return;

  if (s.status !== "approved") {
    res.status(400).json({ error: `Cannot mark paid a settlement with status '${s.status}'. Approve it first.` });
    return;
  }

  const remark = getRemark(req.body);
  if (!remark) { res.status(400).json({ error: "Remark is required" }); return; }

  const referenceNumber = req.body?.referenceNumber;
  if (typeof referenceNumber !== "string" || !referenceNumber.trim()) {
    res.status(400).json({ error: "Reference number is required" });
    return;
  }

  const [updated] = await db.update(settlementsTable)
    .set({
      status: "paid",
      adminRemark: remark,
      referenceNumber: referenceNumber.trim(),
      paidAt: new Date(),
      processedBy: user.id,
    })
    .where(and(eq(settlementsTable.id, id), eq(settlementsTable.status, "approved")))
    .returning();

  if (!updated) {
    res.status(409).json({ error: "Settlement status changed — concurrent modification detected" });
    return;
  }

  res.json(mapSettlement(updated));
});

export default router;
