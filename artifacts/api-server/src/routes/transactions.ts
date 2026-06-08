import { Router } from "express";
import { db, transactionsTable, merchantsTable, qrCodesTable, virtualAccountsTable } from "@workspace/db";
import { eq, ilike, and, count, sql, gte, lte, or } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

function buildMerchantCondition(user: any) {
  if (user.role === "admin") return undefined;
  return eq(transactionsTable.merchantId, user.merchantId!);
}

function generateUtr(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `SIM${ts}${rand}`;
}

// GET /api/transactions
router.get("/", async (req, res, next) => {
  try {
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
      .select({ transaction: transactionsTable, merchantName: merchantsTable.businessName })
      .from(transactionsTable)
      .leftJoin(merchantsTable, eq(transactionsTable.merchantId, merchantsTable.id))
      .where(where)
      .limit(limitNum)
      .offset(offset)
      .orderBy(sql`${transactionsTable.createdAt} DESC`);

    res.json({
      data: rows.map(r => ({ ...r.transaction, amount: Number(r.transaction.amount), merchantName: r.merchantName ?? null })),
      total,
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/transactions/simulate — create a simulated deposit payment (demo)
router.post("/simulate", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!user.merchantId) {
      res.status(403).json({ error: "Only merchants can simulate payments" });
      return;
    }

    const { sourceType, sourceId, amount, utr, expectedStatus = "success" } = req.body;

    if (!sourceType || !sourceId || !amount) {
      res.status(400).json({ error: "sourceType, sourceId, and amount are required" });
      return;
    }
    if (!["qr", "va"].includes(sourceType)) {
      res.status(400).json({ error: "sourceType must be 'qr' or 'va'" });
      return;
    }
    if (Number(amount) <= 0) {
      res.status(400).json({ error: "Amount must be positive" });
      return;
    }

    // Verify source belongs to this merchant
    let sourceLabel = "";
    if (sourceType === "qr") {
      const [qr] = await db.select().from(qrCodesTable)
        .where(and(eq(qrCodesTable.id, parseInt(sourceId)), eq(qrCodesTable.merchantId, user.merchantId)))
        .limit(1);
      if (!qr) { res.status(404).json({ error: "QR code not found" }); return; }
      if (qr.status !== "active") { res.status(400).json({ error: "QR code is not active" }); return; }
      sourceLabel = qr.label ?? `QR #${qr.id}`;
    } else {
      const [va] = await db.select().from(virtualAccountsTable)
        .where(and(eq(virtualAccountsTable.id, parseInt(sourceId)), eq(virtualAccountsTable.merchantId, user.merchantId)))
        .limit(1);
      if (!va) { res.status(404).json({ error: "Virtual account not found" }); return; }
      if (va.status !== "active") { res.status(400).json({ error: "Virtual account is not active" }); return; }
      sourceLabel = va.label ?? va.accountNumber;
    }

    const finalUtr = utr || generateUtr();
    const finalStatus = ["success", "failed", "pending"].includes(expectedStatus) ? expectedStatus : "success";

    // Insert pending first
    const [pending] = await db.insert(transactionsTable).values({
      merchantId: user.merchantId,
      type: "deposit",
      status: "pending",
      amount: Number(amount).toFixed(2),
      currency: "INR",
      utr: finalUtr,
      referenceId: `SIM-${sourceType.toUpperCase()}-${sourceId}-${Date.now()}`,
      description: `Payment via ${sourceType === "qr" ? "QR Code" : "Virtual Account"}: ${sourceLabel}`,
      metadata: JSON.stringify({ sourceType, sourceId: parseInt(sourceId), simulated: true }),
    }).returning();

    // Resolve to final status (non-pending: update immediately)
    let finalTx = pending;
    if (finalStatus !== "pending") {
      const [resolved] = await db
        .update(transactionsTable)
        .set({ status: finalStatus, updatedAt: new Date() })
        .where(eq(transactionsTable.id, pending.id))
        .returning();
      finalTx = resolved;

      // Update merchant balance on success
      if (finalStatus === "success") {
        await db
          .update(merchantsTable)
          .set({
            balance: sql`CAST(COALESCE(balance, '0') AS DECIMAL) + ${Number(amount).toFixed(2)}`,
            totalDeposits: sql`CAST(COALESCE(total_deposits, '0') AS DECIMAL) + ${Number(amount).toFixed(2)}`,
            updatedAt: new Date(),
          })
          .where(eq(merchantsTable.id, user.merchantId));
      }
    }

    res.status(201).json({ ...finalTx, amount: Number(finalTx.amount), merchantName: null });
  } catch (err) {
    next(err);
  }
});

// GET /api/transactions/search/utr
router.get("/search/utr", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { utr } = req.query as { utr?: string };
    if (!utr) { res.status(400).json({ error: "UTR required" }); return; }

    const conditions = [eq(transactionsTable.utr, utr)];
    const merchantCond = buildMerchantCondition(user);
    if (merchantCond) conditions.push(merchantCond);

    const rows = await db
      .select({ transaction: transactionsTable, merchantName: merchantsTable.businessName })
      .from(transactionsTable)
      .leftJoin(merchantsTable, eq(transactionsTable.merchantId, merchantsTable.id))
      .where(and(...conditions))
      .limit(1);

    if (rows.length === 0) { res.status(404).json({ error: "Transaction not found" }); return; }
    const r = rows[0];
    res.json({ ...r.transaction, amount: Number(r.transaction.amount), merchantName: r.merchantName ?? null });
  } catch (err) {
    next(err);
  }
});

// GET /api/transactions/:id
router.get("/:id", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const id = parseInt(req.params.id);
    const conditions = [eq(transactionsTable.id, id)];
    const merchantCond = buildMerchantCondition(user);
    if (merchantCond) conditions.push(merchantCond);

    const rows = await db
      .select({ transaction: transactionsTable, merchantName: merchantsTable.businessName })
      .from(transactionsTable)
      .leftJoin(merchantsTable, eq(transactionsTable.merchantId, merchantsTable.id))
      .where(and(...conditions))
      .limit(1);

    if (rows.length === 0) { res.status(404).json({ error: "Transaction not found" }); return; }
    const r = rows[0];
    res.json({ ...r.transaction, amount: Number(r.transaction.amount), merchantName: r.merchantName ?? null });
  } catch (err) {
    next(err);
  }
});

export default router;
