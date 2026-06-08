import { Router } from "express";
import { db, virtualAccountsTable, merchantsTable, transactionsTable } from "@workspace/db";
import { eq, and, ilike, count, sql, or, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

// GET /api/virtual-accounts
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const { status, search, merchantId, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (user.role !== "admin") conditions.push(eq(virtualAccountsTable.merchantId, user.merchantId!));
  if (merchantId && user.role === "admin") conditions.push(eq(virtualAccountsTable.merchantId, parseInt(merchantId)));
  if (status && status !== "all") conditions.push(eq(virtualAccountsTable.status, status));
  if (search) conditions.push(or(ilike(virtualAccountsTable.accountNumber, `%${search}%`), ilike(virtualAccountsTable.label, `%${search}%`), ilike(virtualAccountsTable.accountHolder, `%${search}%`))!);

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(virtualAccountsTable).where(where);

  const rows = await db.select({ va: virtualAccountsTable, merchantName: merchantsTable.businessName })
    .from(virtualAccountsTable)
    .leftJoin(merchantsTable, eq(virtualAccountsTable.merchantId, merchantsTable.id))
    .where(where)
    .limit(limitNum).offset(offset)
    .orderBy(desc(virtualAccountsTable.createdAt));

  res.json({
    data: rows.map(r => ({ ...r.va, merchantName: r.merchantName ?? null })),
    total, page: pageNum, limit: limitNum,
  });
});

// POST /api/virtual-accounts
router.post("/", async (req, res) => {
  const user = (req as any).user;
  const merchantId = user.merchantId!;
  const { accountNumber, ifsc, bankName, accountHolder, label, balance } = req.body;
  if (!accountNumber || !ifsc || !bankName || !accountHolder) {
    res.status(400).json({ error: "accountNumber, ifsc, bankName, accountHolder required" }); return;
  }
  const [row] = await db.insert(virtualAccountsTable)
    .values({ merchantId, accountNumber, ifsc, bankName, accountHolder, label: label ?? null, balance: balance ?? "0.00" })
    .returning();
  res.status(201).json({ ...row, merchantName: null });
});

// GET /api/virtual-accounts/:id/transactions
router.get("/:id/transactions", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id);

  const conditions = [eq(virtualAccountsTable.id, id)];
  if (user.role !== "admin") conditions.push(eq(virtualAccountsTable.merchantId, user.merchantId!));

  const [va] = await db.select().from(virtualAccountsTable).where(and(...conditions)).limit(1);
  if (!va) { res.status(404).json({ error: "Virtual account not found" }); return; }

  const txns = await db.select().from(transactionsTable)
    .where(eq(transactionsTable.merchantId, va.merchantId))
    .orderBy(desc(transactionsTable.createdAt))
    .limit(50);

  const data = txns.map(t => ({
    id: t.id,
    amount: t.amount,
    type: t.type,
    status: t.status,
    utr: t.utr ?? null,
    description: t.description ?? null,
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
  }));

  res.json({ data, total: data.length, page: 1, limit: 50 });
});

// PUT /api/virtual-accounts/:id
router.put("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id);
  const { label, status, balance } = req.body;
  const update: Record<string, unknown> = {};
  if (label !== undefined) update.label = label;
  if (status !== undefined) update.status = status;
  if (balance !== undefined) update.balance = balance;

  const conditions = [eq(virtualAccountsTable.id, id)];
  if (user.role !== "admin") conditions.push(eq(virtualAccountsTable.merchantId, user.merchantId!));

  const [row] = await db.update(virtualAccountsTable).set(update).where(and(...conditions)).returning();
  if (!row) { res.status(404).json({ error: "Virtual account not found" }); return; }
  res.json({ ...row, merchantName: null });
});

// DELETE /api/virtual-accounts/:id
router.delete("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id);
  const conditions = [eq(virtualAccountsTable.id, id)];
  if (user.role !== "admin") conditions.push(eq(virtualAccountsTable.merchantId, user.merchantId!));
  await db.delete(virtualAccountsTable).where(and(...conditions));
  res.json({ message: "Virtual account deleted" });
});

export default router;
