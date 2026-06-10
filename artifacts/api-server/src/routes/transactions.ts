import { Router } from "express";
import { db, transactionsTable, merchantsTable, qrCodesTable, virtualAccountsTable, ledgerEntriesTable, auditLogsTable, merchantConnectionsTable, paymentLinksTable } from "@workspace/db";
import { eq, ilike, and, count, sql, gte, lte, or, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

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

async function expirePaymentLinks() {
  await db.execute(sql`
    UPDATE payment_links SET status = 'expired'
    WHERE expires_at IS NOT NULL AND expires_at < NOW() AND status = 'active'
  `);
  await db.execute(sql`
    UPDATE payment_links SET status = 'expired'
    WHERE max_payments IS NOT NULL AND status = 'active'
      AND (SELECT COUNT(*) FROM transactions WHERE payment_link_id = payment_links.id) >= max_payments
  `);
}

// GET /api/transactions
router.get("/", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { type, status, search, merchantId, dateFrom, dateTo, amountMin, amountMax, connectionProvider, paymentLinkId, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    const merchantCond = buildMerchantCondition(user);
    if (merchantCond) conditions.push(merchantCond);
    if (type && type !== "all") conditions.push(eq(transactionsTable.type, type));
    if (status && status !== "all") conditions.push(eq(transactionsTable.status, status));
    if (merchantId && user.role === "admin") conditions.push(eq(transactionsTable.merchantId, parseInt(merchantId)));
    if (connectionProvider) {
      const matchingConnectionIds = db
        .select({ id: merchantConnectionsTable.id })
        .from(merchantConnectionsTable)
        .where(eq(merchantConnectionsTable.provider, connectionProvider));
      conditions.push(inArray(transactionsTable.connectionId, matchingConnectionIds));
    }
    if (search) {
      conditions.push(
        or(
          ilike(transactionsTable.utr, `%${search}%`),
          ilike(transactionsTable.referenceId, `%${search}%`),
        )!
      );
    }
    if (dateFrom) conditions.push(gte(transactionsTable.createdAt, new Date(dateFrom)));
    if (dateTo) {
      const endOfDay = new Date(dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      conditions.push(lte(transactionsTable.createdAt, endOfDay));
    }
    if (amountMin) conditions.push(gte(sql`CAST(${transactionsTable.amount} AS DECIMAL)`, parseFloat(amountMin)));
    if (amountMax) conditions.push(lte(sql`CAST(${transactionsTable.amount} AS DECIMAL)`, parseFloat(amountMax)));
    if (paymentLinkId) conditions.push(eq(transactionsTable.paymentLinkId, parseInt(paymentLinkId)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ total }] = await db.select({ total: count() }).from(transactionsTable).where(where);

    const aggRows = await db
      .select({
        depositVolume: sql<string>`COALESCE(SUM(CASE WHEN ${transactionsTable.type} = 'deposit' THEN CAST(${transactionsTable.amount} AS DECIMAL) ELSE 0 END), 0)`,
        withdrawalVolume: sql<string>`COALESCE(SUM(CASE WHEN ${transactionsTable.type} = 'withdrawal' THEN CAST(${transactionsTable.amount} AS DECIMAL) ELSE 0 END), 0)`,
        successCount: sql<number>`CAST(COUNT(CASE WHEN ${transactionsTable.status} = 'success' THEN 1 END) AS INTEGER)`,
        failedCount: sql<number>`CAST(COUNT(CASE WHEN ${transactionsTable.status} = 'failed' THEN 1 END) AS INTEGER)`,
        pendingCount: sql<number>`CAST(COUNT(CASE WHEN ${transactionsTable.status} = 'pending' THEN 1 END) AS INTEGER)`,
      })
      .from(transactionsTable)
      .where(where);

    const agg = aggRows[0];

    const rows = await db
      .select({
        transaction: transactionsTable,
        merchantName: merchantsTable.businessName,
        connectionProvider: merchantConnectionsTable.provider,
      })
      .from(transactionsTable)
      .leftJoin(merchantsTable, eq(transactionsTable.merchantId, merchantsTable.id))
      .leftJoin(merchantConnectionsTable, eq(transactionsTable.connectionId, merchantConnectionsTable.id))
      .where(where)
      .limit(limitNum)
      .offset(offset)
      .orderBy(sql`${transactionsTable.createdAt} DESC`);

    res.json({
      data: rows.map(r => ({ ...r.transaction, amount: Number(r.transaction.amount), merchantName: r.merchantName ?? null, connectionProvider: r.connectionProvider ?? null })),
      total,
      page: pageNum,
      limit: limitNum,
      stats: {
        depositVolume: Number(agg.depositVolume),
        withdrawalVolume: Number(agg.withdrawalVolume),
        successCount: Number(agg.successCount),
        failedCount: Number(agg.failedCount),
        pendingCount: Number(agg.pendingCount),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/transactions — admin manually records a transaction (optionally attributed to a payment link)
router.post("/", requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { merchantId, type, status, amount, utr, referenceId, description, paymentLinkId } = req.body;

    if (!merchantId || !type || !status || amount == null) {
      res.status(400).json({ error: "merchantId, type, status, and amount are required" });
      return;
    }
    if (!["deposit", "withdrawal"].includes(type)) {
      res.status(400).json({ error: "type must be 'deposit' or 'withdrawal'" });
      return;
    }
    if (!["pending", "success", "failed"].includes(status)) {
      res.status(400).json({ error: "status must be 'pending', 'success', or 'failed'" });
      return;
    }
    if (Number(amount) <= 0) {
      res.status(400).json({ error: "Amount must be positive" });
      return;
    }

    // Verify merchant exists
    const [merchant] = await db.select({ id: merchantsTable.id, businessName: merchantsTable.businessName, balance: merchantsTable.balance })
      .from(merchantsTable).where(eq(merchantsTable.id, parseInt(merchantId))).limit(1);
    if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }

    // Verify payment link belongs to merchant and is active (if provided)
    if (paymentLinkId != null) {
      const [link] = await db.select({ id: paymentLinksTable.id, status: paymentLinksTable.status })
        .from(paymentLinksTable)
        .where(and(eq(paymentLinksTable.id, parseInt(paymentLinkId)), eq(paymentLinksTable.merchantId, merchant.id)))
        .limit(1);
      if (!link) { res.status(404).json({ error: "Payment link not found or does not belong to this merchant" }); return; }
      if (link.status !== "active") {
        res.status(422).json({ error: "This payment link is expired or inactive and cannot accept new payments. Use the 'include expired' option in the form if you intend to backfill this correction." });
        return;
      }
    }

    const finalUtr = utr || generateUtr();
    const depositAmt = Number(amount);

    const tx = await db.transaction(async (trx) => {
      const [inserted] = await trx.insert(transactionsTable).values({
        merchantId: merchant.id,
        type,
        status,
        amount: depositAmt.toFixed(2),
        currency: "INR",
        utr: finalUtr,
        referenceId: referenceId ?? null,
        description: description ?? null,
        paymentLinkId: paymentLinkId != null ? parseInt(paymentLinkId) : null,
        metadata: JSON.stringify({ adminRecorded: true, adminId: user.id }),
      }).returning();

      // If successful deposit, update merchant balance and write ledger entry
      if (status === "success" && type === "deposit") {
        const balanceBefore = Number(merchant.balance ?? 0);
        const balanceAfter = balanceBefore + depositAmt;

        await trx.update(merchantsTable).set({
          balance: sql`CAST(COALESCE(balance, '0') AS DECIMAL) + ${depositAmt.toFixed(2)}`,
          totalDeposits: sql`CAST(COALESCE(total_deposits, '0') AS DECIMAL) + ${depositAmt.toFixed(2)}`,
          updatedAt: new Date(),
        }).where(eq(merchantsTable.id, merchant.id));

        await trx.insert(ledgerEntriesTable).values({
          merchantId: merchant.id,
          type: "deposit",
          amount: depositAmt.toFixed(2),
          balanceBefore: balanceBefore.toFixed(2),
          balanceAfter: balanceAfter.toFixed(2),
          referenceType: "transaction",
          referenceId: inserted.id,
          description: description ?? `Admin-recorded deposit${paymentLinkId != null ? ` via payment link #${paymentLinkId}` : ""}`,
          createdBy: user.id,
        });
      }

      return inserted;
    });

    // After inserting, run expiry check for payment links with maxPayments
    if (paymentLinkId != null) {
      await expirePaymentLinks().catch(() => {});
    }

    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "create_transaction",
      targetType: "transaction",
      targetId: tx.id,
      details: JSON.stringify({ merchantId: merchant.id, type, status, amount: depositAmt, paymentLinkId: paymentLinkId ?? null }),
      ipAddress: req.ip ?? null,
    }).catch(() => {});

    res.status(201).json({ ...tx, amount: Number(tx.amount), merchantName: merchant.businessName ?? null });
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

    const { sourceType, sourceId, amount, utr, expectedStatus = "success", provider } = req.body;

    if (!sourceType || !sourceId || !amount) {
      res.status(400).json({ error: "sourceType, sourceId, and amount are required" });
      return;
    }
    if (!["qr", "va", "link"].includes(sourceType)) {
      res.status(400).json({ error: "sourceType must be 'qr', 'va', or 'link'" });
      return;
    }
    if (Number(amount) <= 0) {
      res.status(400).json({ error: "Amount must be positive" });
      return;
    }

    // Verify source belongs to this merchant
    let sourceLabel = "";
    let paymentLinkId: number | null = null;
    if (sourceType === "qr") {
      const [qr] = await db.select().from(qrCodesTable)
        .where(and(eq(qrCodesTable.id, parseInt(sourceId)), eq(qrCodesTable.merchantId, user.merchantId)))
        .limit(1);
      if (!qr) { res.status(404).json({ error: "QR code not found" }); return; }
      if (qr.status !== "active") { res.status(400).json({ error: "QR code is not active" }); return; }
      sourceLabel = qr.label ?? `QR #${qr.id}`;
    } else if (sourceType === "va") {
      const [va] = await db.select().from(virtualAccountsTable)
        .where(and(eq(virtualAccountsTable.id, parseInt(sourceId)), eq(virtualAccountsTable.merchantId, user.merchantId)))
        .limit(1);
      if (!va) { res.status(404).json({ error: "Virtual account not found" }); return; }
      if (va.status !== "active") { res.status(400).json({ error: "Virtual account is not active" }); return; }
      sourceLabel = va.label ?? va.accountNumber;
    } else {
      // sourceType === "link"
      const [link] = await db.select().from(paymentLinksTable)
        .where(and(eq(paymentLinksTable.id, parseInt(sourceId)), eq(paymentLinksTable.merchantId, user.merchantId)))
        .limit(1);
      if (!link) { res.status(404).json({ error: "Payment link not found" }); return; }
      if (link.status !== "active") { res.status(400).json({ error: "Payment link is not active" }); return; }
      sourceLabel = link.title ?? `Link #${link.id}`;
      paymentLinkId = link.id;
    }

    const finalUtr = utr || generateUtr();
    const finalStatus = ["success", "failed", "pending"].includes(expectedStatus) ? expectedStatus : "success";

    const vaId = sourceType === "va" ? parseInt(sourceId) : null;

    // Resolve connectionId: prefer explicit provider match, fall back to first active connection
    let connectionId: number | null = null;
    if (provider) {
      const [conn] = await db.select({ id: merchantConnectionsTable.id })
        .from(merchantConnectionsTable)
        .where(and(eq(merchantConnectionsTable.merchantId, user.merchantId), eq(merchantConnectionsTable.provider, provider), eq(merchantConnectionsTable.isActive, true)))
        .limit(1);
      connectionId = conn?.id ?? null;
    }
    if (connectionId === null) {
      // No explicit provider or provider not found — infer from first active connection
      const [conn] = await db.select({ id: merchantConnectionsTable.id })
        .from(merchantConnectionsTable)
        .where(and(eq(merchantConnectionsTable.merchantId, user.merchantId), eq(merchantConnectionsTable.isActive, true)))
        .limit(1);
      connectionId = conn?.id ?? null;
    }

    // Build description based on sourceType
    const sourceDescription = sourceType === "qr"
      ? `QR Code: ${sourceLabel}`
      : sourceType === "va"
        ? `Virtual Account: ${sourceLabel}`
        : `Payment Link: ${sourceLabel}`;

    // Insert pending first
    const [pending] = await db.insert(transactionsTable).values({
      merchantId: user.merchantId,
      virtualAccountId: vaId,
      paymentLinkId,
      connectionId,
      provider: provider ?? null,
      type: "deposit",
      status: "pending",
      amount: Number(amount).toFixed(2),
      currency: "INR",
      utr: finalUtr,
      referenceId: `SIM-${sourceType.toUpperCase()}-${sourceId}-${Date.now()}`,
      description: `Payment via ${sourceDescription}`,
      metadata: JSON.stringify({ sourceType, sourceId: parseInt(sourceId), simulated: true }),
    }).returning();

    // Resolve to final status (non-pending: update immediately)
    let finalTx = pending;
    if (finalStatus !== "pending") {
      finalTx = await db.transaction(async (tx) => {
        const [resolved] = await tx
          .update(transactionsTable)
          .set({ status: finalStatus, updatedAt: new Date() })
          .where(eq(transactionsTable.id, pending.id))
          .returning();

        if (finalStatus === "success") {
          const [merchantRow] = await tx
            .select({ balance: merchantsTable.balance })
            .from(merchantsTable)
            .where(eq(merchantsTable.id, user.merchantId))
            .limit(1);
          const balanceBefore = Number(merchantRow?.balance ?? 0);
          const depositAmt = Number(amount);
          const balanceAfter = balanceBefore + depositAmt;

          await tx
            .update(merchantsTable)
            .set({
              balance: sql`CAST(COALESCE(balance, '0') AS DECIMAL) + ${depositAmt.toFixed(2)}`,
              totalDeposits: sql`CAST(COALESCE(total_deposits, '0') AS DECIMAL) + ${depositAmt.toFixed(2)}`,
              updatedAt: new Date(),
            })
            .where(eq(merchantsTable.id, user.merchantId));

          await tx.insert(ledgerEntriesTable).values({
            merchantId: user.merchantId,
            type: "deposit",
            amount: depositAmt.toFixed(2),
            balanceBefore: balanceBefore.toFixed(2),
            balanceAfter: balanceAfter.toFixed(2),
            referenceType: "transaction",
            referenceId: resolved.id,
            description: `Deposit via ${sourceDescription}`,
            createdBy: null,
          });

          if (vaId !== null) {
            await tx
              .update(virtualAccountsTable)
              .set({
                balance: sql`CAST(COALESCE(${virtualAccountsTable.balance}, '0') AS DECIMAL) + ${depositAmt.toFixed(2)}`,
                totalCollection: sql`CAST(COALESCE(${virtualAccountsTable.totalCollection}, '0') AS DECIMAL) + ${depositAmt.toFixed(2)}`,
                updatedAt: new Date(),
              })
              .where(eq(virtualAccountsTable.id, vaId));
          }
        }

        return resolved;
      });
    }

    res.status(201).json({ ...finalTx, amount: Number(finalTx.amount), merchantName: null });
  } catch (err) {
    next(err);
  }
});

// GET /api/transactions/export/csv
router.get("/export/csv", async (req, res) => {
  const user = (req as any).user;
  const { type, status, search, merchantId, dateFrom, dateTo, connectionProvider } = req.query as Record<string, string>;

  const conditions = [];
  const merchantCond = buildMerchantCondition(user);
  if (merchantCond) conditions.push(merchantCond);
  if (type && type !== "all") conditions.push(eq(transactionsTable.type, type));
  if (status && status !== "all") conditions.push(eq(transactionsTable.status, status));
  if (merchantId && user.role === "admin") conditions.push(eq(transactionsTable.merchantId, parseInt(merchantId)));
  if (connectionProvider) {
    const matchingConnectionIds = db
      .select({ id: merchantConnectionsTable.id })
      .from(merchantConnectionsTable)
      .where(eq(merchantConnectionsTable.provider, connectionProvider));
    conditions.push(inArray(transactionsTable.connectionId, matchingConnectionIds));
  }
  if (search) {
    conditions.push(
      or(
        ilike(transactionsTable.utr, `%${search}%`),
        ilike(transactionsTable.referenceId, `%${search}%`),
      )!
    );
  }
  if (dateFrom) conditions.push(gte(transactionsTable.createdAt, new Date(dateFrom)));
  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(transactionsTable.createdAt, end));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      transaction: transactionsTable,
      merchantName: merchantsTable.businessName,
      connectionProvider: merchantConnectionsTable.provider,
    })
    .from(transactionsTable)
    .leftJoin(merchantsTable, eq(transactionsTable.merchantId, merchantsTable.id))
    .leftJoin(merchantConnectionsTable, eq(transactionsTable.connectionId, merchantConnectionsTable.id))
    .where(where)
    .orderBy(sql`${transactionsTable.createdAt} DESC`);

  const header = ["ID", "UTR", "Merchant", "Provider", "Type", "Status", "Amount", "Currency", "Reference", "Date"];
  const csvRows = rows.map(r => [
    String(r.transaction.id),
    r.transaction.utr,
    r.merchantName ?? "",
    r.connectionProvider ?? "",
    r.transaction.type,
    r.transaction.status,
    String(Number(r.transaction.amount)),
    r.transaction.currency,
    r.transaction.referenceId ?? "",
    r.transaction.createdAt instanceof Date ? r.transaction.createdAt.toISOString() : String(r.transaction.createdAt),
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));

  const csv = [header.join(","), ...csvRows].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=\"transactions.csv\"");
  res.send(csv);

  void db.insert(auditLogsTable).values({
    adminId: user.id,
    adminEmail: user.email,
    action: "csv_export",
    targetType: "transactions",
    targetId: null,
    details: JSON.stringify({
      rowCount: rows.length,
      filters: { type: type ?? null, status: status ?? null, search: search ?? null, merchantId: merchantId ?? null, dateFrom: dateFrom ?? null, dateTo: dateTo ?? null },
    }),
    ipAddress: req.ip ?? null,
  }).catch(() => {});
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
      .select({
        transaction: transactionsTable,
        merchantName: merchantsTable.businessName,
        connectionProvider: merchantConnectionsTable.provider,
      })
      .from(transactionsTable)
      .leftJoin(merchantsTable, eq(transactionsTable.merchantId, merchantsTable.id))
      .leftJoin(merchantConnectionsTable, eq(transactionsTable.connectionId, merchantConnectionsTable.id))
      .where(and(...conditions))
      .limit(1);

    if (rows.length === 0) { res.status(404).json({ error: "Transaction not found" }); return; }
    const r = rows[0];
    res.json({ ...r.transaction, amount: Number(r.transaction.amount), merchantName: r.merchantName ?? null, connectionProvider: r.connectionProvider ?? null });
  } catch (err) {
    next(err);
  }
});

// GET /api/transactions/:id
router.get("/:id", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const id = parseInt(req.params['id'] as string);
    const conditions = [eq(transactionsTable.id, id)];
    const merchantCond = buildMerchantCondition(user);
    if (merchantCond) conditions.push(merchantCond);

    const rows = await db
      .select({
        transaction: transactionsTable,
        merchantName: merchantsTable.businessName,
        connectionProvider: merchantConnectionsTable.provider,
      })
      .from(transactionsTable)
      .leftJoin(merchantsTable, eq(transactionsTable.merchantId, merchantsTable.id))
      .leftJoin(merchantConnectionsTable, eq(transactionsTable.connectionId, merchantConnectionsTable.id))
      .where(and(...conditions))
      .limit(1);

    if (rows.length === 0) { res.status(404).json({ error: "Transaction not found" }); return; }
    const r = rows[0];
    res.json({ ...r.transaction, amount: Number(r.transaction.amount), merchantName: r.merchantName ?? null, connectionProvider: r.connectionProvider ?? null });
  } catch (err) {
    next(err);
  }
});

// PUT /api/transactions/:id — admin updates status or paymentLinkId
router.put("/:id", requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const id = parseInt(req.params['id'] as string);
    const { status, paymentLinkId } = req.body;

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (status !== undefined) {
      if (!["pending", "success", "failed"].includes(status)) {
        res.status(400).json({ error: "status must be 'pending', 'success', or 'failed'" });
        return;
      }
      update.status = status;
    }
    if (paymentLinkId !== undefined) {
      update.paymentLinkId = paymentLinkId != null ? parseInt(paymentLinkId) : null;
    }

    const [tx] = await db.update(transactionsTable)
      .set(update)
      .where(eq(transactionsTable.id, id))
      .returning();

    if (!tx) { res.status(404).json({ error: "Transaction not found" }); return; }

    if (paymentLinkId != null) {
      await expirePaymentLinks().catch(() => {});
    }

    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "update_transaction",
      targetType: "transaction",
      targetId: id,
      details: JSON.stringify({ status: status ?? null, paymentLinkId: paymentLinkId ?? null }),
      ipAddress: req.ip ?? null,
    }).catch(() => {});

    const [row] = await db
      .select({ transaction: transactionsTable, merchantName: merchantsTable.businessName })
      .from(transactionsTable)
      .leftJoin(merchantsTable, eq(transactionsTable.merchantId, merchantsTable.id))
      .where(eq(transactionsTable.id, id))
      .limit(1);

    res.json({ ...row.transaction, amount: Number(row.transaction.amount), merchantName: row.merchantName ?? null });
  } catch (err) {
    next(err);
  }
});

export default router;
