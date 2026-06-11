import { Router } from "express";
import { db, virtualAccountsTable, merchantsTable, transactionsTable, vaBalanceHistoryTable, usersTable, auditLogsTable } from "@workspace/db";
import { eq, and, ilike, count, or, desc, gte, lte, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { checkPlanLimit, rejectWithLimitError } from "../helpers/planLimits";

async function logVaAudit(req: any, action: string, targetId: number | null, details: object) {
  await db.insert(auditLogsTable).values({
    adminId: req.user.id,
    adminEmail: req.user.email,
    action,
    targetType: "virtual_account",
    targetId,
    details: JSON.stringify(details),
    ipAddress: req.ip ?? null,
  });
}

const router = Router();

// Public endpoint — no auth required — must be registered before requireAuth middleware
// GET /api/virtual-accounts/public/:id
router.get("/public/:id", async (req, res) => {
  const id = parseInt(req.params['id'] as string);
  if (isNaN(id)) { res.status(404).json({ error: "Virtual account not found" }); return; }

  const rows = await db.select({
    va: virtualAccountsTable,
    merchantName: merchantsTable.businessName,
    logoUrl: merchantsTable.logoUrl,
    brandColor: merchantsTable.brandColor,
  })
    .from(virtualAccountsTable)
    .leftJoin(merchantsTable, eq(virtualAccountsTable.merchantId, merchantsTable.id))
    .where(eq(virtualAccountsTable.id, id))
    .limit(1);

  if (!rows.length) { res.status(404).json({ error: "Virtual account not found" }); return; }

  const { va, merchantName, logoUrl, brandColor } = rows[0];
  res.json({
    id: va.id,
    merchantId: va.merchantId,
    accountHolder: va.accountHolder,
    accountNumber: va.accountNumber,
    ifsc: va.ifsc,
    bankName: va.bankName,
    label: va.label ?? null,
    status: va.status,
    createdAt: va.createdAt instanceof Date ? va.createdAt.toISOString() : String(va.createdAt),
    merchantName: merchantName ?? null,
    logoUrl: logoUrl ?? null,
    brandColor: brandColor ?? null,
  });
});

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

// POST /api/virtual-accounts/backfill (admin only)
router.post("/backfill", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const { inArray } = await import("drizzle-orm");

  const allVas = await db.select({
    id: virtualAccountsTable.id,
    balance: virtualAccountsTable.balance,
    totalCollection: virtualAccountsTable.totalCollection,
  }).from(virtualAccountsTable);

  let rowsUpdated = 0;
  let vasProcessed = 0;

  for (const va of allVas) {
    const rows = await db.select()
      .from(vaBalanceHistoryTable)
      .where(eq(vaBalanceHistoryTable.virtualAccountId, va.id))
      .orderBy(desc(vaBalanceHistoryTable.createdAt));

    const nullRows = rows.filter(r =>
      r.oldBalance == null || r.newBalance == null ||
      r.oldTotalCollection == null || r.newTotalCollection == null
    );

    if (!nullRows.length) continue;

    vasProcessed++;

    // Walk backwards from current VA state to fill in nulls
    let runningBalance = va.balance;
    let runningTotalCollection = va.totalCollection;

    for (const row of rows) {
      const updates: Record<string, string | boolean> = {};
      let needsUpdate = false;

      // Fill newBalance from running state if null
      const resolvedNewBalance = row.newBalance ?? runningBalance;
      const resolvedNewTotalCollection = row.newTotalCollection ?? runningTotalCollection;

      if (row.newBalance == null) {
        updates.newBalance = resolvedNewBalance;
        needsUpdate = true;
      }
      if (row.newTotalCollection == null) {
        updates.newTotalCollection = resolvedNewTotalCollection;
        needsUpdate = true;
      }

      // Fill oldBalance: if null, balance was unchanged so oldBalance = resolvedNewBalance
      if (row.oldBalance == null) {
        updates.oldBalance = resolvedNewBalance;
        needsUpdate = true;
        // Balance unchanged, running state stays the same
      } else {
        // Balance changed; the state before this row was oldBalance
        runningBalance = row.oldBalance;
      }

      if (row.oldTotalCollection == null) {
        updates.oldTotalCollection = resolvedNewTotalCollection;
        needsUpdate = true;
        // TotalCollection unchanged, running state stays the same
      } else {
        runningTotalCollection = row.oldTotalCollection;
      }

      if (needsUpdate) {
        updates.backfilled = true;
        await db.update(vaBalanceHistoryTable)
          .set(updates)
          .where(eq(vaBalanceHistoryTable.id, row.id));
        rowsUpdated++;
      }
    }
  }

  req.log.info({ rowsUpdated, vasProcessed }, "va_balance_history_backfill_complete");
  res.json({ rowsUpdated, vasProcessed });
});

// GET /api/virtual-accounts/balance-history/export (admin only — all VAs for a merchant)
router.get("/balance-history/export", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const { merchantId } = req.query as Record<string, string>;
  if (!merchantId) { res.status(400).json({ error: "merchantId is required" }); return; }

  const mid = parseInt(merchantId);
  const vas = await db.select({ id: virtualAccountsTable.id, accountNumber: virtualAccountsTable.accountNumber })
    .from(virtualAccountsTable)
    .where(eq(virtualAccountsTable.merchantId, mid));

  if (!vas.length) {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="balance-history-merchant-${mid}.csv"`);
    res.send("Date/Time,Virtual Account,Changed By,Role,Old Balance,New Balance,Old Total Collection,New Total Collection,Backfilled (estimated)\n");
    return;
  }

  const vaIds = vas.map(v => v.id);
  const vaMap = Object.fromEntries(vas.map(v => [v.id, v.accountNumber]));

  const { inArray } = await import("drizzle-orm");
  const entries = await db.select()
    .from(vaBalanceHistoryTable)
    .where(inArray(vaBalanceHistoryTable.virtualAccountId, vaIds))
    .orderBy(desc(vaBalanceHistoryTable.createdAt));

  const header = ["Date/Time", "Virtual Account", "Changed By", "Role", "Old Balance", "New Balance", "Old Total Collection", "New Total Collection", "Reason", "Backfilled (estimated)"];
  const csvRows = entries.map(e => [
    e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt),
    vaMap[e.virtualAccountId] ?? String(e.virtualAccountId),
    e.changedByName ?? "",
    e.changedByRole ?? "",
    e.oldBalance ?? "",
    e.newBalance ?? "",
    e.oldTotalCollection ?? "",
    e.newTotalCollection ?? "",
    e.reason ?? "",
    e.backfilled ? "Yes" : "No",
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));

  const csv = [header.join(","), ...csvRows].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="balance-history-merchant-${mid}.csv"`);
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

  await logVaAudit(req, "virtual_account_created", row.id, {
    label: row.label ?? null,
    accountHolder: row.accountHolder,
    accountNumber: row.accountNumber,
    bankName: row.bankName,
    merchantId,
  });

  res.status(201).json({ ...row, merchantName: null });
});

// GET /api/virtual-accounts/balance-audit (admin-only)
router.get("/balance-audit", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const { merchantId, merchantName, changedBy, dateFrom, dateTo, fieldChanged, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (merchantId) conditions.push(eq(virtualAccountsTable.merchantId, parseInt(merchantId)));
  if (merchantName) conditions.push(ilike(merchantsTable.businessName, `%${merchantName}%`));
  if (changedBy) conditions.push(ilike(vaBalanceHistoryTable.changedByName, `%${changedBy}%`));
  if (dateFrom) conditions.push(gte(vaBalanceHistoryTable.createdAt, new Date(dateFrom)));
  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(vaBalanceHistoryTable.createdAt, end));
  }
  if (fieldChanged === "balance") {
    conditions.push(sql`${vaBalanceHistoryTable.oldBalance} IS DISTINCT FROM ${vaBalanceHistoryTable.newBalance}`);
  } else if (fieldChanged === "totalCollection") {
    conditions.push(sql`${vaBalanceHistoryTable.oldTotalCollection} IS DISTINCT FROM ${vaBalanceHistoryTable.newTotalCollection}`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(vaBalanceHistoryTable)
    .innerJoin(virtualAccountsTable, eq(vaBalanceHistoryTable.virtualAccountId, virtualAccountsTable.id))
    .leftJoin(merchantsTable, eq(virtualAccountsTable.merchantId, merchantsTable.id))
    .where(where);

  const rows = await db
    .select({
      id: vaBalanceHistoryTable.id,
      virtualAccountId: vaBalanceHistoryTable.virtualAccountId,
      accountNumber: virtualAccountsTable.accountNumber,
      merchantName: merchantsTable.businessName,
      changedBy: vaBalanceHistoryTable.changedBy,
      changedByRole: vaBalanceHistoryTable.changedByRole,
      changedByName: vaBalanceHistoryTable.changedByName,
      oldBalance: vaBalanceHistoryTable.oldBalance,
      newBalance: vaBalanceHistoryTable.newBalance,
      oldTotalCollection: vaBalanceHistoryTable.oldTotalCollection,
      newTotalCollection: vaBalanceHistoryTable.newTotalCollection,
      reason: vaBalanceHistoryTable.reason,
      backfilled: vaBalanceHistoryTable.backfilled,
      createdAt: vaBalanceHistoryTable.createdAt,
    })
    .from(vaBalanceHistoryTable)
    .innerJoin(virtualAccountsTable, eq(vaBalanceHistoryTable.virtualAccountId, virtualAccountsTable.id))
    .leftJoin(merchantsTable, eq(virtualAccountsTable.merchantId, merchantsTable.id))
    .where(where)
    .orderBy(desc(vaBalanceHistoryTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  const data = rows.map(r => ({
    id: r.id,
    virtualAccountId: r.virtualAccountId,
    accountNumber: r.accountNumber,
    merchantName: r.merchantName ?? null,
    changedBy: r.changedBy,
    changedByRole: r.changedByRole,
    changedByName: r.changedByName,
    oldBalance: r.oldBalance,
    newBalance: r.newBalance,
    oldTotalCollection: r.oldTotalCollection,
    newTotalCollection: r.newTotalCollection,
    reason: r.reason ?? null,
    backfilled: r.backfilled,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }));

  res.json({ data, total: Number(total), page: pageNum, limit: limitNum });
});

// GET /api/virtual-accounts/balance-audit/export/csv (admin only)
router.get("/balance-audit/export/csv", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const { merchantId, merchantName, changedBy, dateFrom, dateTo, fieldChanged } = req.query as Record<string, string>;

  const conditions = [];
  if (merchantId) conditions.push(eq(virtualAccountsTable.merchantId, parseInt(merchantId)));
  if (merchantName) conditions.push(ilike(merchantsTable.businessName, `%${merchantName}%`));
  if (changedBy) conditions.push(ilike(vaBalanceHistoryTable.changedByName, `%${changedBy}%`));
  if (dateFrom) conditions.push(gte(vaBalanceHistoryTable.createdAt, new Date(dateFrom)));
  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(vaBalanceHistoryTable.createdAt, end));
  }
  if (fieldChanged === "balance") {
    conditions.push(sql`${vaBalanceHistoryTable.oldBalance} IS DISTINCT FROM ${vaBalanceHistoryTable.newBalance}`);
  } else if (fieldChanged === "totalCollection") {
    conditions.push(sql`${vaBalanceHistoryTable.oldTotalCollection} IS DISTINCT FROM ${vaBalanceHistoryTable.newTotalCollection}`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      accountNumber: virtualAccountsTable.accountNumber,
      merchantName: merchantsTable.businessName,
      changedByName: vaBalanceHistoryTable.changedByName,
      changedByRole: vaBalanceHistoryTable.changedByRole,
      oldBalance: vaBalanceHistoryTable.oldBalance,
      newBalance: vaBalanceHistoryTable.newBalance,
      oldTotalCollection: vaBalanceHistoryTable.oldTotalCollection,
      newTotalCollection: vaBalanceHistoryTable.newTotalCollection,
      createdAt: vaBalanceHistoryTable.createdAt,
      backfilled: vaBalanceHistoryTable.backfilled,
    })
    .from(vaBalanceHistoryTable)
    .innerJoin(virtualAccountsTable, eq(vaBalanceHistoryTable.virtualAccountId, virtualAccountsTable.id))
    .leftJoin(merchantsTable, eq(virtualAccountsTable.merchantId, merchantsTable.id))
    .where(where)
    .orderBy(desc(vaBalanceHistoryTable.createdAt));

  const header = ["Account Number", "Merchant", "Changed By", "Role", "Old Balance", "New Balance", "Old Collection", "New Collection", "Timestamp", "Backfilled (estimated)"];
  const csvRows = rows.map(r => [
    r.accountNumber,
    r.merchantName ?? "",
    r.changedByName ?? "",
    r.changedByRole ?? "",
    r.oldBalance ?? "",
    r.newBalance ?? "",
    r.oldTotalCollection ?? "",
    r.newTotalCollection ?? "",
    r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    r.backfilled ? "Yes" : "No",
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));

  const csv = [header.join(","), ...csvRows].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="balance-audit-export.csv"`);
  res.send(csv);
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
    reason: e.reason ?? null,
    backfilled: e.backfilled,
    createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt),
  }));

  res.json({ data, total: Number(total), page: pageNum, limit: limitNum });
});

// GET /api/virtual-accounts/:id/balance-history/export
router.get("/:id/balance-history/export", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);

  const vaConditions = [eq(virtualAccountsTable.id, id)];
  if (user.role !== "admin") vaConditions.push(eq(virtualAccountsTable.merchantId, user.merchantId!));

  const [va] = await db.select().from(virtualAccountsTable).where(and(...vaConditions)).limit(1);
  if (!va) { res.status(404).json({ error: "Virtual account not found" }); return; }

  const entries = await db.select()
    .from(vaBalanceHistoryTable)
    .where(eq(vaBalanceHistoryTable.virtualAccountId, id))
    .orderBy(desc(vaBalanceHistoryTable.createdAt));

  const header = ["Date/Time", "Changed By", "Role", "Old Balance", "New Balance", "Old Total Collection", "New Total Collection", "Reason", "Backfilled (estimated)"];
  const csvRows = entries.map(e => [
    e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt),
    e.changedByName ?? "",
    e.changedByRole ?? "",
    e.oldBalance ?? "",
    e.newBalance ?? "",
    e.oldTotalCollection ?? "",
    e.newTotalCollection ?? "",
    e.reason ?? "",
    e.backfilled ? "Yes" : "No",
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));

  const csv = [header.join(","), ...csvRows].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="balance-history-va-${id}.csv"`);
  res.send(csv);
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
  const { label, status, balance, totalCollection, reason } = req.body;

  const conditions = [eq(virtualAccountsTable.id, id)];
  if (user.role !== "admin") conditions.push(eq(virtualAccountsTable.merchantId, user.merchantId!));

  const [existing] = await db.select().from(virtualAccountsTable).where(and(...conditions)).limit(1);
  if (!existing) { res.status(404).json({ error: "Virtual account not found" }); return; }

  if (balance !== undefined || totalCollection !== undefined) {
    const effectiveBalance = balance !== undefined ? parseFloat(balance) : parseFloat(existing.balance);
    const effectiveTotalCollection = totalCollection !== undefined ? parseFloat(totalCollection) : parseFloat(existing.totalCollection);
    if (isNaN(effectiveBalance)) {
      res.status(400).json({ error: "Balance must be a valid number" }); return;
    }
    if (isNaN(effectiveTotalCollection)) {
      res.status(400).json({ error: "Total collection must be a valid number" }); return;
    }
    if (effectiveBalance < 0) {
      res.status(400).json({ error: "Balance cannot be negative" }); return;
    }
    if (effectiveTotalCollection < 0) {
      res.status(400).json({ error: "Total collection cannot be negative" }); return;
    }
    if (effectiveBalance > effectiveTotalCollection) {
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

  await logVaAudit(req, "virtual_account_updated", id, {
    label: row.label ?? null,
    changes: Object.keys(update),
  });

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
      oldBalance: existing.balance,
      newBalance: balanceChanged ? balance : existing.balance,
      oldTotalCollection: existing.totalCollection,
      newTotalCollection: totalCollectionChanged ? totalCollection : existing.totalCollection,
      reason: (reason && typeof reason === "string" && reason.trim()) ? reason.trim() : null,
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

  const [existing] = await db.select().from(virtualAccountsTable).where(and(...conditions)).limit(1);

  await db.delete(virtualAccountsTable).where(and(...conditions));

  if (existing) {
    await logVaAudit(req, "virtual_account_deleted", id, {
      label: existing.label ?? null,
      accountHolder: existing.accountHolder,
      accountNumber: existing.accountNumber,
      bankName: existing.bankName,
    });
  }

  res.json({ message: "Virtual account deleted" });
});

export default router;
