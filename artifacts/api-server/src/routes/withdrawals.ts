import { Router } from "express";
import { db, withdrawalsTable, merchantsTable } from "@workspace/db";
import { eq, and, count, sum, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { requireModule } from "../middlewares/checkModule";
import { checkPlanLimit, rejectWithLimitError } from "../helpers/planLimits";

const router = Router();
router.use(requireAuth);

// GET /api/withdrawals
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const { status, merchantId, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (user.role !== "admin") conditions.push(eq(withdrawalsTable.merchantId, user.merchantId!));
  if (status && status !== "all") conditions.push(eq(withdrawalsTable.status, status));
  if (merchantId && user.role === "admin") conditions.push(eq(withdrawalsTable.merchantId, parseInt(merchantId)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [aggregates, rows] = await Promise.all([
    db
      .select({
        total: count(),
        totalVolume: sum(withdrawalsTable.amount),
        pendingCount: count(sql`CASE WHEN ${withdrawalsTable.status} = 'pending' THEN 1 END`),
        approvedCount: count(sql`CASE WHEN ${withdrawalsTable.status} = 'approved' THEN 1 END`),
        rejectedCount: count(sql`CASE WHEN ${withdrawalsTable.status} = 'rejected' THEN 1 END`),
      })
      .from(withdrawalsTable)
      .where(where),
    db
      .select({
        withdrawal: withdrawalsTable,
        merchantName: merchantsTable.businessName,
      })
      .from(withdrawalsTable)
      .leftJoin(merchantsTable, eq(withdrawalsTable.merchantId, merchantsTable.id))
      .where(where)
      .limit(limitNum)
      .offset(offset)
      .orderBy(sql`${withdrawalsTable.createdAt} DESC`),
  ]);

  const agg = aggregates[0]!;

  res.json({
    data: rows.map(r => ({
      ...r.withdrawal,
      amount: Number(r.withdrawal.amount),
      merchantName: r.merchantName ?? null,
    })),
    total: agg.total,
    page: pageNum,
    limit: limitNum,
    stats: {
      totalVolume: Number(agg.totalVolume ?? 0),
      pendingCount: Number(agg.pendingCount),
      approvedCount: Number(agg.approvedCount),
      rejectedCount: Number(agg.rejectedCount),
    },
  });
});

// POST /api/withdrawals
router.post("/", requireModule("merchant_withdrawals"), async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "merchant") {
    res.status(403).json({ error: "Only merchants can request withdrawals" });
    return;
  }
  const { amount, bankAccount, bankName, ifscCode, accountHolder } = req.body;
  if (!amount || !bankAccount || !bankName || !ifscCode || !accountHolder) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  // Enforce plan payout limits
  const limitCheck = await checkPlanLimit(user.merchantId!, "payout", user.id);
  if (!limitCheck.allowed) { rejectWithLimitError(res, limitCheck.message!); return; }

  const [withdrawal] = await db.insert(withdrawalsTable).values({
    merchantId: user.merchantId!,
    amount: String(amount),
    bankAccount,
    bankName,
    ifscCode,
    accountHolder,
  }).returning();
  res.status(201).json({ ...withdrawal, amount: Number(withdrawal.amount) });
});

// POST /api/withdrawals/:id/approve
router.post("/:id/approve", requireAdmin, async (req, res) => {
  const id = parseInt(req.params['id'] as string);
  const [withdrawal] = await db
    .update(withdrawalsTable)
    .set({ status: "approved" })
    .where(eq(withdrawalsTable.id, id))
    .returning();
  if (!withdrawal) {
    res.status(404).json({ error: "Withdrawal not found" });
    return;
  }
  res.json({ ...withdrawal, amount: Number(withdrawal.amount), merchantName: null });
});

// POST /api/withdrawals/:id/reject
router.post("/:id/reject", requireAdmin, async (req, res) => {
  const id = parseInt(req.params['id'] as string);
  const { reason } = req.body;
  if (!reason) {
    res.status(400).json({ error: "Rejection reason required" });
    return;
  }
  const [withdrawal] = await db
    .update(withdrawalsTable)
    .set({ status: "rejected", rejectionReason: reason })
    .where(eq(withdrawalsTable.id, id))
    .returning();
  if (!withdrawal) {
    res.status(404).json({ error: "Withdrawal not found" });
    return;
  }
  res.json({ ...withdrawal, amount: Number(withdrawal.amount), merchantName: null });
});

export default router;
