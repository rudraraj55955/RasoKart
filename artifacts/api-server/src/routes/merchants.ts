import { Router } from "express";
import { db, merchantsTable, usersTable, merchantPlansTable, plansTable, planHistoryTable, auditLogsTable, invoicesTable } from "@workspace/db";
import { eq, ilike, and, or, count, sql, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();

router.use(requireAuth, requireAdmin);

function serializeMerchant(m: typeof merchantsTable.$inferSelect) {
  return {
    ...m,
    totalDeposits: Number(m.totalDeposits),
    totalWithdrawals: Number(m.totalWithdrawals),
    balance: Number(m.balance),
  };
}

function buildPlanResponse(mp: typeof merchantPlansTable.$inferSelect, plan: typeof plansTable.$inferSelect) {
  const isExpired = mp.expiresAt ? new Date() > mp.expiresAt : false;
  const daysUntilExpiry = mp.expiresAt
    ? Math.max(0, Math.ceil((mp.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;
  return {
    id: mp.id, merchantId: mp.merchantId, planId: mp.planId,
    planName: plan.name, description: plan.description ?? null,
    price: plan.price, monthlyFee: plan.monthlyFee, yearlyFee: plan.yearlyFee, setupFee: plan.setupFee,
    pricing: plan.pricing, features: plan.features, customFeatures: plan.customFeatures,
    dynamicQrLimit: plan.dynamicQrLimit, staticQrLimit: plan.staticQrLimit,
    virtualAccountLimit: plan.virtualAccountLimit, paymentLinkLimit: plan.paymentLinkLimit,
    payoutLimit: plan.payoutLimit, dailyTransactionLimit: plan.dailyTransactionLimit,
    monthlyTransactionLimit: plan.monthlyTransactionLimit,
    settlementFee: plan.settlementFee, depositFee: plan.depositFee,
    apiAccess: plan.apiAccess, webhookAccess: plan.webhookAccess, providerAccess: plan.providerAccess,
    status: mp.status,
    assignedAt: mp.assignedAt, expiresAt: mp.expiresAt ?? null, isExpired,
    daysUntilExpiry, notes: mp.notes ?? null,
  };
}

async function logPlanHistory(opts: {
  merchantId: number; fromPlanId: number | null; toPlanId: number | null;
  action: string; adminId?: number; adminEmail?: string; notes?: string;
}) {
  await db.insert(planHistoryTable).values({
    merchantId: opts.merchantId, fromPlanId: opts.fromPlanId ?? null,
    toPlanId: opts.toPlanId ?? null, action: opts.action,
    assignedBy: opts.adminId ?? null, adminEmail: opts.adminEmail ?? null, notes: opts.notes ?? null,
  });
}

// GET /api/merchants
router.get("/", async (req, res) => {
  const { status, search, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (status && status !== "all") conditions.push(eq(merchantsTable.status, status));
  if (search) {
    conditions.push(or(
      ilike(merchantsTable.businessName, `%${search}%`),
      ilike(merchantsTable.email, `%${search}%`),
      ilike(merchantsTable.contactName, `%${search}%`),
    )!);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(merchantsTable).where(where);
  const data = await db.select().from(merchantsTable).where(where).limit(limitNum).offset(offset).orderBy(sql`${merchantsTable.createdAt} DESC`);

  res.json({ data: data.map(serializeMerchant), total, page: pageNum, limit: limitNum });
});

// GET /api/merchants/:id
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [merchant] = await db.select().from(merchantsTable).where(eq(merchantsTable.id, id)).limit(1);
  if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }
  res.json(serializeMerchant(merchant));
});

// POST /api/merchants/:id/approve
router.post("/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id);
  const [merchant] = await db.update(merchantsTable)
    .set({ status: "approved", rejectionReason: null })
    .where(eq(merchantsTable.id, id)).returning();
  if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }
  res.json(serializeMerchant(merchant));
});

// POST /api/merchants/:id/reject
router.post("/:id/reject", async (req, res) => {
  const id = parseInt(req.params.id);
  const { reason } = req.body;
  if (!reason) { res.status(400).json({ error: "Rejection reason required" }); return; }
  const [merchant] = await db.update(merchantsTable)
    .set({ status: "rejected", rejectionReason: reason })
    .where(eq(merchantsTable.id, id)).returning();
  if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }
  res.json(serializeMerchant(merchant));
});

// GET /api/merchants/:id/plan
router.get("/:id/plan", async (req, res) => {
  const id = parseInt(req.params.id as string);
  const rows = await db.select({ mp: merchantPlansTable, plan: plansTable })
    .from(merchantPlansTable)
    .leftJoin(plansTable, eq(merchantPlansTable.planId, plansTable.id))
    .where(eq(merchantPlansTable.merchantId, id)).limit(1);
  if (rows.length === 0 || !rows[0].plan) { res.status(404).json({ error: "No plan assigned" }); return; }
  res.json(buildPlanResponse(rows[0].mp, rows[0].plan!));
});

// GET /api/merchants/:id/plan/history
router.get("/:id/plan/history", async (req, res) => {
  const id = parseInt(req.params.id as string);
  const rows = await db
    .select({ h: planHistoryTable, toPlan: { id: plansTable.id, name: plansTable.name } })
    .from(planHistoryTable)
    .leftJoin(plansTable, eq(planHistoryTable.toPlanId, plansTable.id))
    .where(eq(planHistoryTable.merchantId, id))
    .orderBy(desc(planHistoryTable.createdAt)).limit(50);
  res.json(rows.map(r => ({ ...r.h, toPlanName: r.toPlan?.name ?? null, createdAt: r.h.createdAt.toISOString() })));
});

// POST /api/merchants/:id/assign-plan
router.post("/:id/assign-plan", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id as string);
  const { planId, expiresAt, notes } = req.body;
  if (!planId) { res.status(400).json({ error: "planId required" }); return; }

  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, planId)).limit(1);
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }
  const [merchant] = await db.select().from(merchantsTable).where(eq(merchantsTable.id, id)).limit(1);
  if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }

  const existing = await db.select().from(merchantPlansTable).where(eq(merchantPlansTable.merchantId, id)).limit(1);
  const fromPlanId = existing.length > 0 ? existing[0].planId : null;
  const expiresAtDate = expiresAt ? new Date(expiresAt) : null;
  const updateSet: Record<string, unknown> = { planId, assignedBy: user.id, notes: notes ?? null, status: "active" };
  if (expiresAtDate) updateSet.expiresAt = expiresAtDate;

  let result;
  if (existing.length > 0) {
    [result] = await db.update(merchantPlansTable).set(updateSet).where(eq(merchantPlansTable.merchantId, id)).returning();
  } else {
    [result] = await db.insert(merchantPlansTable).values({
      merchantId: id, planId, assignedBy: user.id,
      expiresAt: expiresAtDate ?? undefined, notes: notes ?? null,
    }).returning();
  }

  const action = fromPlanId === null ? "assigned" : fromPlanId === planId ? "renewed" : planId > fromPlanId ? "upgraded" : "downgraded";
  await logPlanHistory({ merchantId: id, fromPlanId, toPlanId: planId, action, adminId: user.id, adminEmail: user.email, notes });
  await db.insert(auditLogsTable).values({
    adminId: user.id, adminEmail: user.email, action: `plan_${action}`,
    targetType: "merchant", targetId: id,
    details: JSON.stringify({ planName: plan.name, fromPlanId, toPlanId: planId }),
    ipAddress: (req as any).ip ?? null,
  });

  res.json({ ...result, planName: plan.name, expiresAt: result.expiresAt ?? null });
});

// POST /api/merchants/:id/plan/upgrade
router.post("/:id/plan/upgrade", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id as string);
  const { planId, expiresAt, notes } = req.body;
  if (!planId) { res.status(400).json({ error: "planId required" }); return; }

  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, planId)).limit(1);
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }
  const existing = await db.select().from(merchantPlansTable).where(eq(merchantPlansTable.merchantId, id)).limit(1);
  const fromPlanId = existing.length > 0 ? existing[0].planId : null;
  const expiresAtDate = expiresAt ? new Date(expiresAt) : null;
  const set: Record<string, unknown> = { planId, assignedBy: user.id, notes: notes ?? null, status: "active" };
  if (expiresAtDate) set.expiresAt = expiresAtDate;

  let result;
  if (existing.length > 0) {
    [result] = await db.update(merchantPlansTable).set(set).where(eq(merchantPlansTable.merchantId, id)).returning();
  } else {
    [result] = await db.insert(merchantPlansTable).values({ merchantId: id, planId, assignedBy: user.id, expiresAt: expiresAtDate ?? undefined }).returning();
  }
  await logPlanHistory({ merchantId: id, fromPlanId, toPlanId: planId, action: "upgraded", adminId: user.id, adminEmail: user.email, notes });
  res.json({ ...result, planName: plan.name, expiresAt: result.expiresAt ?? null });
});

// POST /api/merchants/:id/plan/downgrade
router.post("/:id/plan/downgrade", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id as string);
  const { planId, expiresAt, notes } = req.body;
  if (!planId) { res.status(400).json({ error: "planId required" }); return; }

  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, planId)).limit(1);
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }
  const existing = await db.select().from(merchantPlansTable).where(eq(merchantPlansTable.merchantId, id)).limit(1);
  const fromPlanId = existing.length > 0 ? existing[0].planId : null;
  const expiresAtDate = expiresAt ? new Date(expiresAt) : null;
  const set: Record<string, unknown> = { planId, assignedBy: user.id, notes: notes ?? null, status: "active" };
  if (expiresAtDate) set.expiresAt = expiresAtDate;

  let result;
  if (existing.length > 0) {
    [result] = await db.update(merchantPlansTable).set(set).where(eq(merchantPlansTable.merchantId, id)).returning();
  } else {
    [result] = await db.insert(merchantPlansTable).values({ merchantId: id, planId, assignedBy: user.id, expiresAt: expiresAtDate ?? undefined }).returning();
  }
  await logPlanHistory({ merchantId: id, fromPlanId, toPlanId: planId, action: "downgraded", adminId: user.id, adminEmail: user.email, notes });
  res.json({ ...result, planName: plan.name, expiresAt: result.expiresAt ?? null });
});

// POST /api/merchants/:id/plan/suspend
router.post("/:id/plan/suspend", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id as string);
  const { notes } = req.body ?? {};

  const existing = await db.select().from(merchantPlansTable).where(eq(merchantPlansTable.merchantId, id)).limit(1);
  if (existing.length === 0) { res.status(404).json({ error: "No plan assigned" }); return; }

  const [result] = await db.update(merchantPlansTable)
    .set({ status: "suspended", notes: notes ?? existing[0].notes })
    .where(eq(merchantPlansTable.merchantId, id)).returning();
  await logPlanHistory({ merchantId: id, fromPlanId: existing[0].planId, toPlanId: existing[0].planId, action: "suspended", adminId: user.id, adminEmail: user.email, notes });
  res.json({ ...result, expiresAt: result.expiresAt ?? null });
});

// POST /api/merchants/:id/plan/reinstate
router.post("/:id/plan/reinstate", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id as string);
  const { notes } = req.body ?? {};

  const existing = await db.select().from(merchantPlansTable).where(eq(merchantPlansTable.merchantId, id)).limit(1);
  if (existing.length === 0) { res.status(404).json({ error: "No plan assigned" }); return; }

  const [result] = await db.update(merchantPlansTable)
    .set({ status: "active", notes: notes ?? existing[0].notes })
    .where(eq(merchantPlansTable.merchantId, id)).returning();
  await logPlanHistory({ merchantId: id, fromPlanId: existing[0].planId, toPlanId: existing[0].planId, action: "reinstated", adminId: user.id, adminEmail: user.email, notes });
  res.json({ ...result, expiresAt: result.expiresAt ?? null });
});

// POST /api/merchants/:id/plan/renew
router.post("/:id/plan/renew", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id as string);
  const { expiresAt, notes } = req.body;
  if (!expiresAt) { res.status(400).json({ error: "expiresAt required" }); return; }

  const existing = await db.select().from(merchantPlansTable).where(eq(merchantPlansTable.merchantId, id)).limit(1);
  if (existing.length === 0) { res.status(404).json({ error: "No plan assigned" }); return; }

  const [result] = await db.update(merchantPlansTable)
    .set({ expiresAt: new Date(expiresAt), status: "active", renewedAt: new Date(), notes: notes ?? existing[0].notes })
    .where(eq(merchantPlansTable.merchantId, id)).returning();
  await logPlanHistory({ merchantId: id, fromPlanId: existing[0].planId, toPlanId: existing[0].planId, action: "renewed", adminId: user.id, adminEmail: user.email, notes });
  res.json({ ...result, expiresAt: result.expiresAt ?? null });
});

// GET /api/merchants/:id/invoices (admin only)
router.get("/:id/invoices", async (req, res) => {
  const merchantId = parseInt(req.params.id as string);
  const { status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [eq(invoicesTable.merchantId, merchantId)];
  if (status && status !== "all") conditions.push(eq(invoicesTable.status, status));
  const where = and(...conditions);

  const [{ total }] = await db.select({ total: count() }).from(invoicesTable).where(where);
  const rows = await db.select({
    inv: invoicesTable,
    planName: plansTable.name,
  })
    .from(invoicesTable)
    .leftJoin(plansTable, eq(invoicesTable.planId, plansTable.id))
    .where(where)
    .orderBy(desc(invoicesTable.createdAt))
    .limit(limitNum).offset(offset);

  const data = rows.map(r => ({
    ...r.inv,
    amount: r.inv.amount,
    paidAt: r.inv.paidAt?.toISOString() ?? null,
    dueDate: r.inv.dueDate?.toISOString() ?? null,
    periodFrom: r.inv.periodFrom?.toISOString() ?? null,
    periodTo: r.inv.periodTo?.toISOString() ?? null,
    createdAt: r.inv.createdAt.toISOString(),
    updatedAt: r.inv.updatedAt.toISOString(),
    planName: r.planName ?? null,
    merchantName: null,
    merchantEmail: null,
  }));

  res.json({ data, total, page: pageNum, limit: limitNum });
});

export default router;
