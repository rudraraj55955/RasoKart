import { Router } from "express";
import { db, merchantsTable, usersTable, merchantPlansTable, plansTable, planHistoryTable, auditLogsTable, invoicesTable } from "@workspace/db";
import { eq, ilike, and, or, count, sql, desc, lt, lte, gte, isNotNull } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { getMerchantPlanUsage } from "../helpers/planLimits";

const router = Router();

router.use(requireAuth);

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
router.get("/", requireAdmin, async (req, res) => {
  const { status, search, page = "1", limit = "20", expiryStatus } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 86400000);

  const conditions = [];
  if (status && status !== "all") conditions.push(eq(merchantsTable.status, status));
  if (search) {
    conditions.push(or(
      ilike(merchantsTable.businessName, `%${search}%`),
      ilike(merchantsTable.email, `%${search}%`),
      ilike(merchantsTable.contactName, `%${search}%`),
    )!);
  }

  const planConditions = [];
  if (expiryStatus === "expired") {
    planConditions.push(isNotNull(merchantPlansTable.expiresAt));
    planConditions.push(lt(merchantPlansTable.expiresAt, now));
  } else if (expiryStatus === "expiring") {
    planConditions.push(isNotNull(merchantPlansTable.expiresAt));
    planConditions.push(gte(merchantPlansTable.expiresAt, now));
    planConditions.push(lte(merchantPlansTable.expiresAt, sevenDaysLater));
  }

  const allConditions = [...conditions, ...planConditions];
  const where = allConditions.length > 0 ? and(...allConditions) : undefined;

  let total: number;
  if (planConditions.length > 0) {
    const [{ total: t }] = await db
      .select({ total: count() })
      .from(merchantsTable)
      .leftJoin(merchantPlansTable, eq(merchantPlansTable.merchantId, merchantsTable.id))
      .where(where);
    total = t;
  } else {
    const [{ total: t }] = await db.select({ total: count() }).from(merchantsTable).where(where);
    total = t;
  }

  const rows = await db
    .select({
      merchant: merchantsTable,
      currentPlanName: plansTable.name,
      currentPlanStatus: merchantPlansTable.status,
      currentPlanExpiresAt: merchantPlansTable.expiresAt,
    })
    .from(merchantsTable)
    .leftJoin(merchantPlansTable, eq(merchantPlansTable.merchantId, merchantsTable.id))
    .leftJoin(plansTable, eq(plansTable.id, merchantPlansTable.planId))
    .where(where)
    .limit(limitNum).offset(offset)
    .orderBy(sql`${merchantsTable.createdAt} DESC`);

  res.json({
    data: rows.map(r => {
      const expiresAt = r.currentPlanExpiresAt ?? null;
      const isExpired = expiresAt ? now > expiresAt : null;
      return {
        ...serializeMerchant(r.merchant),
        currentPlanName: r.currentPlanName ?? null,
        currentPlanStatus: r.currentPlanStatus ?? null,
        currentPlanExpiresAt: expiresAt ? expiresAt.toISOString() : null,
        currentPlanIsExpired: isExpired,
      };
    }),
    total,
    page: pageNum,
    limit: limitNum,
  });
});

// GET /api/merchants/:id  (admin, or the merchant viewing their own profile)
router.get("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id as string);
  if (user.role !== "admin" && user.merchantId !== id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const [merchant] = await db.select().from(merchantsTable).where(eq(merchantsTable.id, id)).limit(1);
  if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }
  res.json(serializeMerchant(merchant));
});

// PATCH /api/merchants/:id/branding  (merchant updates own, admin updates any)
router.patch("/:id/branding", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);
  if (user.role !== "admin" && user.merchantId !== id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { logoUrl, brandColor } = req.body;
  const update: Record<string, unknown> = {};
  if (logoUrl !== undefined) update.logoUrl = logoUrl ?? null;
  if (brandColor !== undefined) update.brandColor = brandColor ?? null;

  const [merchant] = await db.update(merchantsTable).set(update).where(eq(merchantsTable.id, id)).returning();
  if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }
  res.json(serializeMerchant(merchant));
});

// POST /api/merchants/:id/approve
router.post("/:id/approve", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const [merchant] = await db.update(merchantsTable)
    .set({ status: "approved", rejectionReason: null })
    .where(eq(merchantsTable.id, id)).returning();
  if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }
  res.json(serializeMerchant(merchant));
});

// POST /api/merchants/:id/suspend
router.post("/:id/suspend", async (req, res) => {
  const id = parseInt(req.params['id'] as string);
  const [merchant] = await db
    .update(merchantsTable)
    .set({ status: "suspended" })
    .where(eq(merchantsTable.id, id))
    .returning();
  if (!merchant) {
    res.status(404).json({ error: "Merchant not found" });
    return;
  }
  res.json({
    ...merchant,
    totalDeposits: Number(merchant.totalDeposits),
    totalWithdrawals: Number(merchant.totalWithdrawals),
    balance: Number(merchant.balance),
  });
});

// POST /api/merchants/:id/unsuspend
router.post("/:id/unsuspend", async (req, res) => {
  const id = parseInt(req.params['id'] as string);
  const [merchant] = await db
    .update(merchantsTable)
    .set({ status: "approved" })
    .where(eq(merchantsTable.id, id))
    .returning();
  if (!merchant) {
    res.status(404).json({ error: "Merchant not found" });
    return;
  }
  res.json({
    ...merchant,
    totalDeposits: Number(merchant.totalDeposits),
    totalWithdrawals: Number(merchant.totalWithdrawals),
    balance: Number(merchant.balance),
  });
});

// POST /api/merchants/:id/reject
router.post("/:id/reject", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const { reason } = req.body;
  if (!reason) { res.status(400).json({ error: "Rejection reason required" }); return; }
  const [merchant] = await db.update(merchantsTable)
    .set({ status: "rejected", rejectionReason: reason })
    .where(eq(merchantsTable.id, id)).returning();
  if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }
  res.json(serializeMerchant(merchant));
});

// GET /api/merchants/:id/plan
router.get("/:id/plan", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const rows = await db.select({ mp: merchantPlansTable, plan: plansTable })
    .from(merchantPlansTable)
    .leftJoin(plansTable, eq(merchantPlansTable.planId, plansTable.id))
    .where(eq(merchantPlansTable.merchantId, id)).limit(1);
  if (rows.length === 0 || !rows[0].plan) { res.status(404).json({ error: "No plan assigned" }); return; }
  res.json(buildPlanResponse(rows[0].mp, rows[0].plan!));
});

// GET /api/merchants/:id/plan/usage
router.get("/:id/plan/usage", requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const usage = await getMerchantPlanUsage(id);
  if (!usage) { res.status(404).json({ error: "No plan assigned" }); return; }
  res.json(usage);
});

// GET /api/merchants/:id/plan/history
router.get("/:id/plan/history", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const rows = await db
    .select({ h: planHistoryTable, toPlan: { id: plansTable.id, name: plansTable.name } })
    .from(planHistoryTable)
    .leftJoin(plansTable, eq(planHistoryTable.toPlanId, plansTable.id))
    .where(eq(planHistoryTable.merchantId, id))
    .orderBy(desc(planHistoryTable.createdAt)).limit(50);
  res.json(rows.map(r => ({ ...r.h, toPlanName: r.toPlan?.name ?? null, createdAt: r.h.createdAt.toISOString() })));
});

// POST /api/merchants/bulk-approve
router.post("/bulk-approve", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const { merchantIds } = req.body;
  if (!Array.isArray(merchantIds) || merchantIds.length === 0) {
    res.status(400).json({ error: "merchantIds[] required" });
    return;
  }

  let updated = 0;
  let failed = 0;

  for (const merchantId of merchantIds as number[]) {
    try {
      const [merchant] = await db.update(merchantsTable)
        .set({ status: "approved", rejectionReason: null })
        .where(eq(merchantsTable.id, merchantId))
        .returning();
      if (!merchant) { failed++; continue; }
      await db.insert(auditLogsTable).values({
        adminId: user.id, adminEmail: user.email, action: "merchant_approved",
        targetType: "merchant", targetId: merchantId,
        details: JSON.stringify({ bulk: true }),
        ipAddress: (req as any).ip ?? null,
      });
      updated++;
    } catch {
      failed++;
    }
  }

  res.json({ updated, failed });
});

// POST /api/merchants/bulk-suspend
router.post("/bulk-suspend", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const { merchantIds, action } = req.body;
  if (!Array.isArray(merchantIds) || merchantIds.length === 0 || !["suspend", "reinstate"].includes(action)) {
    res.status(400).json({ error: "merchantIds[] and action (suspend|reinstate) required" });
    return;
  }

  const newStatus = action === "suspend" ? "suspended" : "approved";
  let updated = 0;
  let failed = 0;

  for (const merchantId of merchantIds as number[]) {
    try {
      const [merchant] = await db.update(merchantsTable)
        .set({ status: newStatus })
        .where(eq(merchantsTable.id, merchantId))
        .returning();
      if (!merchant) { failed++; continue; }
      await db.insert(auditLogsTable).values({
        adminId: user.id, adminEmail: user.email,
        action: action === "suspend" ? "merchant_suspended" : "merchant_reinstated",
        targetType: "merchant", targetId: merchantId,
        details: JSON.stringify({ bulk: true }),
        ipAddress: (req as any).ip ?? null,
      });
      updated++;
    } catch {
      failed++;
    }
  }

  res.json({ updated, failed });
});

// POST /api/merchants/bulk-assign-plan
router.post("/bulk-assign-plan", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const { merchantIds, planId, expiresAt, notes } = req.body;
  if (!planId || !Array.isArray(merchantIds) || merchantIds.length === 0) {
    res.status(400).json({ error: "planId and merchantIds[] required" });
    return;
  }

  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, planId)).limit(1);
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }

  const expiresAtDate = expiresAt ? new Date(expiresAt) : null;
  let updated = 0;
  let failed = 0;

  for (const merchantId of merchantIds as number[]) {
    try {
      const existing = await db.select().from(merchantPlansTable).where(eq(merchantPlansTable.merchantId, merchantId)).limit(1);
      const fromPlanId = existing.length > 0 ? existing[0].planId : null;
      const updateSet: Record<string, unknown> = { planId, assignedBy: user.id, notes: notes ?? null, status: "active" };
      if (expiresAtDate) updateSet.expiresAt = expiresAtDate;

      if (existing.length > 0) {
        await db.update(merchantPlansTable).set(updateSet).where(eq(merchantPlansTable.merchantId, merchantId));
      } else {
        await db.insert(merchantPlansTable).values({
          merchantId, planId, assignedBy: user.id,
          expiresAt: expiresAtDate ?? undefined, notes: notes ?? null,
        });
      }

      const action = fromPlanId === null ? "assigned" : fromPlanId === planId ? "renewed" : planId > fromPlanId ? "upgraded" : "downgraded";
      await logPlanHistory({ merchantId, fromPlanId, toPlanId: planId, action, adminId: user.id, adminEmail: user.email, notes });
      await db.insert(auditLogsTable).values({
        adminId: user.id, adminEmail: user.email, action: `plan_${action}`,
        targetType: "merchant", targetId: merchantId,
        details: JSON.stringify({ planName: plan.name, fromPlanId, toPlanId: planId, bulk: true }),
        ipAddress: (req as any).ip ?? null,
      });
      updated++;
    } catch {
      failed++;
    }
  }

  res.json({ updated, failed });
});

// POST /api/merchants/:id/assign-plan
router.post("/:id/assign-plan", requireAdmin, async (req, res) => {
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
router.post("/:id/plan/upgrade", requireAdmin, async (req, res) => {
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
router.post("/:id/plan/downgrade", requireAdmin, async (req, res) => {
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
router.post("/:id/plan/suspend", requireAdmin, async (req, res) => {
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
router.post("/:id/plan/reinstate", requireAdmin, async (req, res) => {
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
router.post("/:id/plan/renew", requireAdmin, async (req, res) => {
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
router.get("/:id/invoices", requireAdmin, async (req, res) => {
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
