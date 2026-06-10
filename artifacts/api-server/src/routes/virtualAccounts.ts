import { Router } from "express";
import { db, virtualAccountsTable, merchantsTable, transactionsTable, vaBalanceHistoryTable, usersTable } from "@workspace/db";
import { eq, and, ilike, count, or, desc, gte, lte } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { checkPlanLimit, rejectWithLimitError } from "../helpers/planLimits";

const router = Router();
router.use(requireAuth);

// GET /api/virtual-accounts
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const { status, search, merchantId, merchantName, dateFrom, dateTo, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (user.role !== "admin") conditions.push(eq(virtualAccountsTable.merchantId, user.merchantId!));
  if (merchantId && user.role === "admin") conditions.push(eq(virtualAccountsTable.merchantId, parseInt(merchantId)));
  if (status && status !== "all") conditions.push(eq(virtualAccountsTable.status, status));
  if (search) conditions.push(or(
    ilike(virtualAccountsTable.accountNumber, `%${search}%`),
    ilike(virtualAccountsTable.accountHolder, `%${search}%`),
    ilike(virtualAccountsTable.label, `%${search}%`),
  )!);
  if (dateFrom) conditions.push(gte(virtualAccountsTable.createdAt, new Date(dateFrom)));
  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(virtualAccountsTable.createdAt, end));
  }

  const merchantNameCondition = merchantName && user.role === "admin"
    ? ilike(merchantsTable.businessName, `%${merchantName}%`)
    : undefined;

  const vaWhere = conditions.length > 0 ? and(...conditions) : undefined;
  const combinedWhere = vaWhere && merchantNameCondition
    ? and(vaWhere, merchantNameCondition)
    : vaWhere ?? merchantNameCondition;

  const [{ total }] = await db.select({ total: count() })
    .from(virtualAccountsTable)
    .leftJoin(merchantsTable, eq(virtualAccountsTable.merchantId, merchantsTable.id))
    .where(combinedWhere);

  const rows = await db.select({ va: virtualAccountsTable, merchantName: merchantsTable.businessName })
    .from(virtualAccountsTable)
    .leftJoin(merchantsTable, eq(virtualAccountsTable.merchantId, merchantsTable.id))
    .where(combinedWhere)
    .limit(limitNum)
    .offset(offset)
    .orderBy(desc(virtualAccountsTable.createdAt));

  res.json({
    data: rows.map(r => ({ ...r.va, merchantName: r.merchantName ?? null })),
    total, page: pageNum, limit: limitNum,
  });
});

// GET /api/virtual-accounts/export/csv (admin only)
router.get("/export/csv", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const { status, search, merchantName, dateFrom, dateTo } = req.query as Record<string, string>;

  const conditions = [];
  if (status && status !== "all") conditions.push(eq(virtualAccountsTable.status, status));
  if (search) conditions.push(or(
    ilike(virtualAccountsTable.accountNumber, `%${search}%`),
    ilike(virtualAccountsTable.accountHolder, `%${search}%`),
    ilike(virtualAccountsTable.label, `%${search}%`),
  )!);
  if (dateFrom) conditions.push(gte(virtualAccountsTable.createdAt, new Date(dateFrom)));
  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(virtualAccountsTable.createdAt, end));
  }

  const merchantNameCondition = merchantName
    ? ilike(merchantsTable.businessName, `%${merchantName}%`)
    : undefined;

  const vaWhere = conditions.length > 0 ? and(...conditions) : undefined;
  const combinedWhere = vaWhere && merchantNameCondition
    ? and(vaWhere, merchantNameCondition)
    : vaWhere ?? merchantNameCondition;

  const rows = await db.select({ va: virtualAccountsTable, merchantName: merchantsTable.businessName })
    .from(virtualAccountsTable)
    .leftJoin(merchantsTable, eq(virtualAccountsTable.merchantId, merchantsTable.id))
    .where(combinedWhere)
    .orderBy(desc(virtualAccountsTable.createdAt));

  const header = ["ID", "Merchant", "Account Holder", "Account Number", "IFSC", "Bank Name", "Balance", "Total Collection", "Status", "Created"];
  const csvRows = rows.map(r => [
    String(r.va.id),
    r.merchantName ?? "",
    r.va.accountHolder,
    r.va.accountNumber,
    r.va.ifsc,
    r.va.bankName,
    r.va.balance,
    r.va.totalCollection,
    r.va.status,
    r.va.createdAt instanceof Date ? r.va.createdAt.toISOString() : String(r.va.createdAt),
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));

  const csv = [header.join(","), ...csvRows].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="virtual-accounts-export.csv"`);
  res.send(csv);
});

// POST /api/virtual-accounts
router.post("/", async (req, res) => {
  const user = (req as any).user;
  const merchantId = user.merchantId!;
  const { accountNumber, ifsc, bankName, accountHolder, label } = req.body;
  if (!accountNumber || !ifsc || !bankName || !accountHolder) {
    res.status(400).json({ error: "accountNumber, ifsc, bankName, accountHolder required" }); return;
  }

  const limitCheck = await checkPlanLimit(merchantId, "virtualAccount", user.id);
  if (!limitCheck.allowed) { rejectWithLimitError(res, limitCheck.message!); return; }

  const [row] = await db.insert(virtualAccountsTable)
    .values({
      merchantId,
      accountNumber,
      ifsc,
      bankName,
      accountHolder,
      label: label ?? null,
      balance: "0.00",
      totalCollection: "0.00",
    })
    .returning();
  res.status(201).json({ ...row, merchantName: null });
});

// GET /api/virtual-accounts/:id/balance-history
router.get("/:id/balance-history", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);

  const vaConditions = [eq(virtualAccountsTable.id, id)];
  if (user.role !== "admin") vaConditions.push(eq(virtualAccountsTable.merchantId, user.merchantId!));

  const [va] = await db.select().from(virtualAccountsTable).where(and(...vaConditions)).limit(1);
  if (!va) { res.status(404).json({ error: "Virtual account not found" }); return; }

  const { page = "1", limit = "50" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const [{ total }] = await db.select({ total: count() })
    .from(vaBalanceHistoryTable)
    .where(eq(vaBalanceHistoryTable.virtualAccountId, id));

  const entries = await db.select()
    .from(vaBalanceHistoryTable)
    .where(eq(vaBalanceHistoryTable.virtualAccountId, id))
    .orderBy(desc(vaBalanceHistoryTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  const data = entries.map(e => ({
    id: e.id,
    virtualAccountId: e.virtualAccountId,
    changedBy: e.changedBy,
    changedByRole: e.changedByRole,
    changedByName: e.changedByName,
    oldBalance: e.oldBalance ?? null,
    newBalance: e.newBalance ?? null,
    oldTotalCollection: e.oldTotalCollection ?? null,
    newTotalCollection: e.newTotalCollection ?? null,
    createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt),
  }));

  res.json({ data, total: Number(total), page: pageNum, limit: limitNum });
});

// GET /api/virtual-accounts/:id/transactions
router.get("/:id/transactions", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);

  const vaConditions = [eq(virtualAccountsTable.id, id)];
  if (user.role !== "admin") vaConditions.push(eq(virtualAccountsTable.merchantId, user.merchantId!));

  const [va] = await db.select().from(virtualAccountsTable).where(and(...vaConditions)).limit(1);
  if (!va) { res.status(404).json({ error: "Virtual account not found" }); return; }

  const { page = "1", limit = "50" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const [{ total }] = await db.select({ total: count() })
    .from(transactionsTable)
    .where(eq(transactionsTable.virtualAccountId, id));

  const txns = await db.select().from(transactionsTable)
    .where(eq(transactionsTable.virtualAccountId, id))
    .orderBy(desc(transactionsTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  const data = txns.map(t => ({
    id: t.id,
    amount: t.amount,
    type: t.type,
    status: t.status,
    utr: t.utr ?? null,
    description: t.description ?? null,
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
  }));

  res.json({ data, total: Number(total), page: pageNum, limit: limitNum });
});

// PUT /api/virtual-accounts/:id
router.put("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);
  const { label, status, balance, totalCollection } = req.body;

  const conditions = [eq(virtualAccountsTable.id, id)];
  if (user.role !== "admin") conditions.push(eq(virtualAccountsTable.merchantId, user.merchantId!));

  const [existing] = await db.select().from(virtualAccountsTable).where(and(...conditions)).limit(1);
  if (!existing) { res.status(404).json({ error: "Virtual account not found" }); return; }

  if (balance !== undefined || totalCollection !== undefined) {
    const effectiveBalance = balance !== undefined ? parseFloat(balance) : parseFloat(existing.balance);
    const effectiveTotalCollection = totalCollection !== undefined ? parseFloat(totalCollection) : parseFloat(existing.totalCollection);
    if (!isNaN(effectiveBalance) && !isNaN(effectiveTotalCollection) && effectiveBalance > effectiveTotalCollection) {
      res.status(400).json({ error: "Balance cannot exceed total collection" }); return;
    }
  }
  const update: Record<string, unknown> = {};
  if (label !== undefined) update.label = label;
  if (status !== undefined) update.status = status;
  if (balance !== undefined) update.balance = balance;
  if (totalCollection !== undefined) update.totalCollection = totalCollection;

  const [row] = await db.update(virtualAccountsTable).set(update).where(and(...conditions)).returning();
  if (!row) { res.status(404).json({ error: "Virtual account not found" }); return; }

  const balanceChanged = balance !== undefined && balance !== existing.balance;
  const totalCollectionChanged = totalCollection !== undefined && totalCollection !== existing.totalCollection;

  if (balanceChanged || totalCollectionChanged) {
    const [actingUser] = await db.select({ name: usersTable.name }).from(usersTable)
      .where(eq(usersTable.id, user.id)).limit(1);
    await db.insert(vaBalanceHistoryTable).values({
      virtualAccountId: id,
      changedBy: user.id,
      changedByRole: user.role,
      changedByName: actingUser?.name ?? user.email ?? "Unknown",
      oldBalance: balanceChanged ? existing.balance : null,
      newBalance: balanceChanged ? balance : null,
      oldTotalCollection: totalCollectionChanged ? existing.totalCollection : null,
      newTotalCollection: totalCollectionChanged ? totalCollection : null,
    });
  }

  const [merchant] = await db.select({ businessName: merchantsTable.businessName })
    .from(merchantsTable).where(eq(merchantsTable.id, row.merchantId)).limit(1);
  res.json({ ...row, merchantName: merchant?.businessName ?? null });
});

// DELETE /api/virtual-accounts/:id
router.delete("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);
  const conditions = [eq(virtualAccountsTable.id, id)];
  if (user.role !== "admin") conditions.push(eq(virtualAccountsTable.merchantId, user.merchantId!));
  await db.delete(virtualAccountsTable).where(and(...conditions));
  res.json({ message: "Virtual account deleted" });
});

export default router;
