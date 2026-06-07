import { Router } from "express";
import { db, transactionsTable, merchantsTable } from "@workspace/db";
import { eq, ilike, and, count, sql, gte, lte, or } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

function buildMerchantCondition(user: any) {
  if (user.role === "admin") return undefined;
  return eq(transactionsTable.merchantId, user.merchantId!);
}

// GET /api/transactions
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const { type, status, search, merchantId, dateFrom, dateTo, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  const merchantCond = buildMerchantCondition(user);
  if (merchantCond) conditions.push(merchantCond);
  if (type && type !== "all") conditions.push(eq(transactionsTable.type, type));
  if (status && status !== "all") conditions.push(eq(transactionsTable.status, status));
  if (merchantId && user.role === "admin") conditions.push(eq(transactionsTable.merchantId, parseInt(merchantId)));
  if (search) {
    conditions.push(
      or(
        ilike(transactionsTable.utr, `%${search}%`),
        ilike(transactionsTable.referenceId, `%${search}%`),
      )!
    );
  }
  if (dateFrom) conditions.push(gte(transactionsTable.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(transactionsTable.createdAt, new Date(dateTo)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(transactionsTable).where(where);

  const rows = await db
    .select({
      transaction: transactionsTable,
      merchantName: merchantsTable.businessName,
    })
    .from(transactionsTable)
    .leftJoin(merchantsTable, eq(transactionsTable.merchantId, merchantsTable.id))
    .where(where)
    .limit(limitNum)
    .offset(offset)
    .orderBy(sql`${transactionsTable.createdAt} DESC`);

  res.json({
    data: rows.map(r => ({
      ...r.transaction,
      amount: Number(r.transaction.amount),
      merchantName: r.merchantName ?? null,
    })),
    total,
    page: pageNum,
    limit: limitNum,
  });
});

// GET /api/transactions/search/utr
router.get("/search/utr", async (req, res) => {
  const user = (req as any).user;
  const { utr } = req.query as { utr?: string };
  if (!utr) {
    res.status(400).json({ error: "UTR required" });
    return;
  }

  const conditions = [eq(transactionsTable.utr, utr)];
  const merchantCond = buildMerchantCondition(user);
  if (merchantCond) conditions.push(merchantCond);

  const rows = await db
    .select({
      transaction: transactionsTable,
      merchantName: merchantsTable.businessName,
    })
    .from(transactionsTable)
    .leftJoin(merchantsTable, eq(transactionsTable.merchantId, merchantsTable.id))
    .where(and(...conditions))
    .limit(1);

  if (rows.length === 0) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  const r = rows[0];
  res.json({ ...r.transaction, amount: Number(r.transaction.amount), merchantName: r.merchantName ?? null });
});

// GET /api/transactions/:id
router.get("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id);
  const conditions = [eq(transactionsTable.id, id)];
  const merchantCond = buildMerchantCondition(user);
  if (merchantCond) conditions.push(merchantCond);

  const rows = await db
    .select({
      transaction: transactionsTable,
      merchantName: merchantsTable.businessName,
    })
    .from(transactionsTable)
    .leftJoin(merchantsTable, eq(transactionsTable.merchantId, merchantsTable.id))
    .where(and(...conditions))
    .limit(1);

  if (rows.length === 0) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  const r = rows[0];
  res.json({ ...r.transaction, amount: Number(r.transaction.amount), merchantName: r.merchantName ?? null });
});

export default router;
