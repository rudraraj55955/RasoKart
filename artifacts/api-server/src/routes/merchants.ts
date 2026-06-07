import { Router } from "express";
import { db, merchantsTable, usersTable } from "@workspace/db";
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

export default router;
