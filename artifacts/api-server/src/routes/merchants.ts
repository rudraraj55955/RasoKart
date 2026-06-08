import { Router } from "express";
import { db, merchantsTable, usersTable, merchantPlansTable, plansTable, planHistoryTable, auditLogsTable } from "@workspace/db";
import { eq, ilike, and, or, count, sql, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();

router.use(requireAuth, requireAdmin);

// GET /api/merchants
router.get("/", async (req, res) => {
  const { status, search, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (status && status !== "all") conditions.push(eq(merchantsTable.status, status));
  if (search) {
    conditions.push(
      or(
        ilike(merchantsTable.businessName, `%${search}%`),
        ilike(merchantsTable.email, `%${search}%`),
        ilike(merchantsTable.contactName, `%${search}%`),
      )!
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(merchantsTable).where(where);
  const data = await db.select().from(merchantsTable).where(where).limit(limitNum).offset(offset).orderBy(sql`${merchantsTable.createdAt} DESC`);

  res.json({
    data: data.map(m => ({
      ...m,
      totalDeposits: Number(m.totalDeposits),
      totalWithdrawals: Number(m.totalWithdrawals),
      balance: Number(m.balance),
    })),
    total,
    page: pageNum,
    limit: limitNum,
  });
});

// GET /api/merchants/:id
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [merchant] = await db.select().from(merchantsTable).where(eq(merchantsTable.id, id)).limit(1);
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

// POST /api/merchants/:id/approve
router.post("/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id);
  const [merchant] = await db
    .update(merchantsTable)
    .set({ status: "approved", rejectionReason: null })
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
router.post("/:id/reject", async (req, res) => {
  const id = parseInt(req.params.id);
  const { reason } = req.body;
  if (!reason) {
    res.status(400).json({ error: "Rejection reason required" });
    return;
  }
  const [merchant] = await db
    .update(merchantsTable)
    .set({ status: "rejected", rejectionReason: reason })
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

// GET /api/merchants/:id/plan
router.get("/:id/plan", async (req, res) => {
  const id = parseInt(req.params.id as string);
  const rows = await db
    .select({ mp: merchantPlansTable, plan: plansTable })
    .from(merchantPlansTable)
    .leftJoin(plansTable, eq(merchantPlansTable.planId, plansTable.id))
    .where(eq(merchantPlansTable.merchantId, id))
    .limit(1);

  if (rows.length === 0 || !rows[0].plan) { res.status(404).json({ error: "No plan assigned" }); return; }
  const { mp, plan } = rows[0];
  const isExpired = mp.expiresAt ? new Date() > mp.expiresAt : false;
  res.json({
    id: mp.id, merchantId: mp.merchantId, planId: mp.planId,
    planName: plan!.name, description: plan!.description ?? null,
    price: plan!.price,
    pricing: plan!.pricing, features: plan!.features,
    dynamicQrLimit: plan!.dynamicQrLimit, staticQrLimit: plan!.staticQrLimit,
    virtualAccountLimit: plan!.virtualAccountLimit, paymentLinkLimit: plan!.paymentLinkLimit,
    payoutLimit: plan!.payoutLimit, dailyTransactionLimit: plan!.dailyTransactionLimit,
    monthlyTransactionLimit: plan!.monthlyTransactionLimit,
    settlementFee: plan!.settlementFee, depositFee: plan!.depositFee,
    apiAccess: plan!.apiAccess, webhookAccess: plan!.webhookAccess,
    assignedAt: mp.assignedAt, expiresAt: mp.expiresAt ?? null, isExpired, notes: mp.notes ?? null,
  });
});

// GET /api/merchants/:id/plan/history
router.get("/:id/plan/history", async (req, res) => {
  const id = parseInt(req.params.id as string);
  const rows = await db
    .select({ h: planHistoryTable, toPlan: { id: plansTable.id, name: plansTable.name } })
    .from(planHistoryTable)
    .leftJoin(plansTable, eq(planHistoryTable.toPlanId, plansTable.id))
    .where(eq(planHistoryTable.merchantId, id))
    .orderBy(desc(planHistoryTable.createdAt))
    .limit(50);
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

  let result;
  const updateSet: Record<string, unknown> = { planId, assignedBy: user.id, notes: notes ?? null };
  if (expiresAtDate) updateSet.expiresAt = expiresAtDate;

  if (existing.length > 0) {
    [result] = await db.update(merchantPlansTable).set(updateSet).where(eq(merchantPlansTable.merchantId, id)).returning();
  } else {
    [result] = await db.insert(merchantPlansTable).values({
      merchantId: id, planId, assignedBy: user.id,
      expiresAt: expiresAtDate ?? undefined, notes: notes ?? null,
    }).returning();
  }

  const action = fromPlanId === null ? "assigned" : fromPlanId === planId ? "renewed" : planId > fromPlanId ? "upgraded" : "downgraded";
  await db.insert(planHistoryTable).values({
    merchantId: id, fromPlanId, toPlanId: planId, action,
    assignedBy: user.id, adminEmail: user.email, notes: notes ?? null,
  });

  await db.insert(auditLogsTable).values({
    adminId: user.id, adminEmail: user.email, action: `plan_${action}`,
    targetType: "merchant", targetId: id,
    details: JSON.stringify({ planName: plan.name, fromPlanId, toPlanId: planId, expiresAt: expiresAt ?? null }),
    ipAddress: (req as any).ip ?? null,
  });

  res.json({ ...result, planName: plan.name, expiresAt: result.expiresAt ?? null });
});

export default router;
