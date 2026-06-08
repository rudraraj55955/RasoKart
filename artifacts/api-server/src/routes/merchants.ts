import { Router } from "express";
import { db, merchantsTable, usersTable, merchantPlansTable, plansTable } from "@workspace/db";
import { eq, ilike, and, or, count, sql } from "drizzle-orm";
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

// GET /api/merchants/:id/plan (admin: view current plan assignment)
router.get("/:id/plan", async (req, res) => {
  const id = parseInt(req.params.id);
  const rows = await db
    .select({ mp: merchantPlansTable, plan: plansTable })
    .from(merchantPlansTable)
    .leftJoin(plansTable, eq(merchantPlansTable.planId, plansTable.id))
    .where(eq(merchantPlansTable.merchantId, id))
    .limit(1);

  if (rows.length === 0 || !rows[0].plan) {
    res.status(404).json({ error: "No plan assigned" });
    return;
  }
  const { mp, plan } = rows[0];
  res.json({
    id: mp.id,
    merchantId: mp.merchantId,
    planId: mp.planId,
    planName: plan!.name,
    description: plan!.description ?? null,
    pricing: plan!.pricing,
    features: plan!.features,
    dynamicQrLimit: plan!.dynamicQrLimit,
    staticQrLimit: plan!.staticQrLimit,
    virtualAccountLimit: plan!.virtualAccountLimit,
    paymentLinkLimit: plan!.paymentLinkLimit,
    payoutLimit: plan!.payoutLimit,
    assignedAt: mp.assignedAt,
  });
});

// POST /api/merchants/:id/assign-plan
router.post("/:id/assign-plan", async (req, res) => {
  const id = parseInt(req.params.id);
  const { planId } = req.body;
  if (!planId) { res.status(400).json({ error: "planId required" }); return; }

  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, planId)).limit(1);
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }

  const [merchant] = await db.select().from(merchantsTable).where(eq(merchantsTable.id, id)).limit(1);
  if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }

  const existing = await db.select().from(merchantPlansTable).where(eq(merchantPlansTable.merchantId, id)).limit(1);
  let result;
  if (existing.length > 0) {
    [result] = await db.update(merchantPlansTable).set({ planId }).where(eq(merchantPlansTable.merchantId, id)).returning();
  } else {
    [result] = await db.insert(merchantPlansTable).values({ merchantId: id, planId }).returning();
  }
  res.json({ ...result, planName: plan.name });
});

export default router;
