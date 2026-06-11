import { Router } from "express";
import { db, ledgerEntriesTable, merchantsTable, auditLogsTable, transactionsTable, systemConfigTable, SYSTEM_CONFIG_KEYS } from "@workspace/db";
import { eq, and, count, gte, lte, sql, desc, asc, notExists, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

function parseId(param: string | string[]): number {
  return parseInt(Array.isArray(param) ? param[0] : param);
}

function mapEntry(e: typeof ledgerEntriesTable.$inferSelect, merchantName?: string | null) {
  return {
    ...e,
    amount: Number(e.amount),
    balanceBefore: Number(e.balanceBefore),
    balanceAfter: Number(e.balanceAfter),
    merchantName: merchantName ?? null,
  };
}

// GET /api/ledger — merchant sees own, admin sees all (with optional merchantId filter)
router.get("/", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { merchantId, type, dateFrom, dateTo, page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: ReturnType<typeof eq>[] = [];
    if (user.role !== "admin") {
      conditions.push(eq(ledgerEntriesTable.merchantId, user.merchantId!));
    } else if (merchantId) {
      conditions.push(eq(ledgerEntriesTable.merchantId, parseInt(merchantId)));
    }
    if (type && type !== "all") conditions.push(eq(ledgerEntriesTable.type, type));
    if (dateFrom) conditions.push(gte(ledgerEntriesTable.createdAt, new Date(dateFrom)));
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(ledgerEntriesTable.createdAt, end));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Fetch total count, period boundary rows (for opening/closing balance), and page of data in parallel
    const [countResult, oldestEntry, newestEntry, rows] = await Promise.all([
      db.select({ total: count() }).from(ledgerEntriesTable).where(where),
      // Oldest entry in the filtered window (for opening balance)
      db.select({ balanceBefore: ledgerEntriesTable.balanceBefore })
        .from(ledgerEntriesTable).where(where)
        .orderBy(asc(ledgerEntriesTable.createdAt)).limit(1),
      // Newest entry in the filtered window (for closing balance)
      db.select({ balanceAfter: ledgerEntriesTable.balanceAfter })
        .from(ledgerEntriesTable).where(where)
        .orderBy(desc(ledgerEntriesTable.createdAt)).limit(1),
      db.select({ entry: ledgerEntriesTable, merchantName: merchantsTable.businessName })
        .from(ledgerEntriesTable)
        .leftJoin(merchantsTable, eq(ledgerEntriesTable.merchantId, merchantsTable.id))
        .where(where)
        .orderBy(desc(ledgerEntriesTable.createdAt))
        .limit(limitNum)
        .offset(offset),
    ]);

    // Current balance: fetch from merchants table for scoped merchant
    let currentBalance = 0;
    const scopedMerchantId = user.role !== "admin" ? user.merchantId : (merchantId ? parseInt(merchantId) : null);
    if (scopedMerchantId) {
      const [m] = await db.select({ balance: merchantsTable.balance }).from(merchantsTable).where(eq(merchantsTable.id, scopedMerchantId)).limit(1);
      if (m) currentBalance = Number(m.balance);
    }

    const openingBalance = oldestEntry[0] ? Number(oldestEntry[0].balanceBefore) : currentBalance;
    const closingBalance = newestEntry[0] ? Number(newestEntry[0].balanceAfter) : currentBalance;

    res.json({
      data: rows.map(r => mapEntry(r.entry, r.merchantName)),
      total: Number(countResult[0].total),
      page: pageNum,
      limit: limitNum,
      currentBalance,
      openingBalance,
      closingBalance,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/ledger/backfill/last-run — return last backfill run metadata (admin only)
router.get("/backfill/last-run", requireAdmin, async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(systemConfigTable)
      .where(
        inArray(systemConfigTable.key, [
          SYSTEM_CONFIG_KEYS.LEDGER_BACKFILL_LAST_RUN_AT,
          SYSTEM_CONFIG_KEYS.LEDGER_BACKFILL_ROWS_UPDATED,
        ])
      );
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const lastRunAt = map.get(SYSTEM_CONFIG_KEYS.LEDGER_BACKFILL_LAST_RUN_AT) ?? null;
    const rowsUpdatedRaw = map.get(SYSTEM_CONFIG_KEYS.LEDGER_BACKFILL_ROWS_UPDATED);
    const rowsUpdated = rowsUpdatedRaw != null ? parseInt(rowsUpdatedRaw) : null;
    res.json({ lastRunAt, rowsUpdated });
  } catch (err) {
    next(err);
  }
});

// POST /api/ledger/backfill — backfill ledger entries for success deposits with no ledger record (admin only)
router.post("/backfill", requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;

    // Find all success deposits that don't yet have a ledger entry referencing them
    const depositsToBackfill = await db
      .select({
        id: transactionsTable.id,
        merchantId: transactionsTable.merchantId,
        amount: transactionsTable.amount,
        description: transactionsTable.description,
        utr: transactionsTable.utr,
        createdAt: transactionsTable.createdAt,
      })
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.type, "deposit"),
          eq(transactionsTable.status, "success"),
          notExists(
            db
              .select({ id: ledgerEntriesTable.id })
              .from(ledgerEntriesTable)
              .where(
                and(
                  eq(ledgerEntriesTable.referenceType, "transaction"),
                  eq(ledgerEntriesTable.referenceId, transactionsTable.id)
                )
              )
          )
        )
      )
      .orderBy(asc(transactionsTable.merchantId), asc(transactionsTable.createdAt));

    if (depositsToBackfill.length === 0) {
      const now = new Date().toISOString();
      await Promise.all([
        db.insert(systemConfigTable)
          .values({ key: SYSTEM_CONFIG_KEYS.LEDGER_BACKFILL_LAST_RUN_AT, value: now, updatedByEmail: user.email })
          .onConflictDoUpdate({ target: systemConfigTable.key, set: { value: now, updatedByEmail: user.email, updatedAt: sql`now()` } }),
        db.insert(systemConfigTable)
          .values({ key: SYSTEM_CONFIG_KEYS.LEDGER_BACKFILL_ROWS_UPDATED, value: "0", updatedByEmail: user.email })
          .onConflictDoUpdate({ target: systemConfigTable.key, set: { value: "0", updatedByEmail: user.email, updatedAt: sql`now()` } }),
      ]);
      res.json({ rowsUpdated: 0 });
      return;
    }

    // Group deposits by merchantId and process each merchant's missing deposits in chronological order
    const byMerchant = new Map<number, typeof depositsToBackfill>();
    for (const dep of depositsToBackfill) {
      const list = byMerchant.get(dep.merchantId) ?? [];
      list.push(dep);
      byMerchant.set(dep.merchantId, list);
    }

    let totalRowsInserted = 0;

    for (const [merchantId, deposits] of byMerchant) {
      // For each deposit, create a ledger entry with balanceBefore/After set to 0
      // (we cannot reliably reconstruct historical running balances from incomplete data)
      for (const dep of deposits) {
        const amount = Number(dep.amount);
        await db.insert(ledgerEntriesTable).values({
          merchantId,
          type: "deposit",
          amount: amount.toFixed(2),
          balanceBefore: "0.00",
          balanceAfter: amount.toFixed(2),
          referenceType: "transaction",
          referenceId: dep.id,
          description: dep.description ?? `Deposit (UTR: ${dep.utr})`,
          createdBy: null,
          createdAt: dep.createdAt,
        });
        totalRowsInserted++;
      }
    }

    const now = new Date().toISOString();
    await Promise.all([
      db.insert(systemConfigTable)
        .values({ key: SYSTEM_CONFIG_KEYS.LEDGER_BACKFILL_LAST_RUN_AT, value: now, updatedByEmail: user.email })
        .onConflictDoUpdate({ target: systemConfigTable.key, set: { value: now, updatedByEmail: user.email, updatedAt: sql`now()` } }),
      db.insert(systemConfigTable)
        .values({ key: SYSTEM_CONFIG_KEYS.LEDGER_BACKFILL_ROWS_UPDATED, value: String(totalRowsInserted), updatedByEmail: user.email })
        .onConflictDoUpdate({ target: systemConfigTable.key, set: { value: String(totalRowsInserted), updatedByEmail: user.email, updatedAt: sql`now()` } }),
    ]);

    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "ledger_backfill_run",
      targetType: "system",
      targetId: null,
      details: JSON.stringify({ rowsUpdated: totalRowsInserted }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ rowsUpdated: totalRowsInserted }, "ledger_backfill_complete");

    res.json({ rowsUpdated: totalRowsInserted });
  } catch (err) {
    next(err);
  }
});

// POST /api/ledger/adjustment — admin creates manual credit/debit adjustment
router.post("/adjustment", requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { merchantId, amount, description } = req.body as { merchantId?: number; amount?: number; description?: string };

    if (!merchantId || typeof merchantId !== "number") {
      res.status(400).json({ error: "merchantId is required" });
      return;
    }
    if (amount === undefined || amount === null || typeof amount !== "number" || amount === 0) {
      res.status(400).json({ error: "amount must be a non-zero number (positive = credit, negative = debit)" });
      return;
    }
    if (!description || typeof description !== "string" || !description.trim()) {
      res.status(400).json({ error: "description is required" });
      return;
    }

    let entry: typeof ledgerEntriesTable.$inferSelect;
    try {
      entry = await db.transaction(async (tx) => {
        const [merchant] = await tx
          .select({ balance: merchantsTable.balance })
          .from(merchantsTable)
          .where(eq(merchantsTable.id, merchantId))
          .limit(1);

        if (!merchant) throw Object.assign(new Error("Merchant not found"), { statusCode: 404 });

        const balanceBefore = Number(merchant.balance);
        const balanceAfter = balanceBefore + amount;

        if (balanceAfter < 0) {
          throw Object.assign(new Error("Adjustment would result in a negative balance"), { statusCode: 400 });
        }

        await tx
          .update(merchantsTable)
          .set({ balance: sql`${merchantsTable.balance} + ${amount}::numeric`, updatedAt: new Date() })
          .where(eq(merchantsTable.id, merchantId));

        const [created] = await tx
          .insert(ledgerEntriesTable)
          .values({
            merchantId,
            type: "adjustment",
            amount: amount.toFixed(2),
            balanceBefore: balanceBefore.toFixed(2),
            balanceAfter: balanceAfter.toFixed(2),
            referenceType: "manual",
            description: description.trim(),
            createdBy: user.id,
          })
          .returning();

        await tx.insert(auditLogsTable).values({
          adminId: user.id,
          adminEmail: user.email,
          action: "ledger_adjustment",
          targetType: "merchant",
          targetId: merchantId,
          details: JSON.stringify({
            amount,
            balanceBefore,
            balanceAfter,
            description: description.trim(),
            ledgerEntryId: created.id,
          }),
          ipAddress: (req as any).ip ?? null,
        });

        return created;
      });
    } catch (err: any) {
      const code = err?.statusCode ?? 500;
      res.status(code).json({ error: err?.message ?? "Adjustment failed" });
      return;
    }

    res.status(201).json(mapEntry(entry));
  } catch (err) {
    next(err);
  }
});

export default router;
