import { Router } from "express";
import { db, transactionsTable, merchantsTable, qrCodesTable, virtualAccountsTable, ledgerEntriesTable, auditLogsTable, merchantConnectionsTable, paymentLinksTable, usersTable } from "@workspace/db";
import { eq, ilike, and, count, sql, gte, lte, or, inArray, sum } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { maybeNotifyProviderLimit, maybeNotifyProviderLimitReset } from "../helpers/providerLimitNotifier";

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

/**
 * Fire-and-forget: after a deposit is recorded as 'success', check whether
 * the associated provider connection has crossed 80% or 100% of its monthly
 * limit and create the appropriate notification (with email) if so.
 * Safe to call concurrently — dedup is enforced at the DB level.
 */
async function checkProviderLimitAfterDeposit(merchantId: number, connectionId: number | null): Promise<void> {
  if (connectionId == null) return;

  const [connRows, merchantRows] = await Promise.all([
    db
      .select({ provider: merchantConnectionsTable.provider, monthlyLimit: merchantConnectionsTable.monthlyLimit, isActive: merchantConnectionsTable.isActive })
      .from(merchantConnectionsTable)
      .where(eq(merchantConnectionsTable.id, connectionId))
      .limit(1),
    db
      .select({ userId: usersTable.id, email: usersTable.email, businessName: merchantsTable.businessName })
      .from(usersTable)
      .innerJoin(merchantsTable, eq(usersTable.merchantId, merchantsTable.id))
      .where(eq(merchantsTable.id, merchantId))
      .limit(1),
  ]);

  const conn = connRows[0];
  const merchant = merchantRows[0];
  if (!conn || !conn.isActive || Number(conn.monthlyLimit) <= 0 || !merchant) return;

  const [usageRow] = await db
    .select({ total: sum(transactionsTable.amount) })
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.merchantId, merchantId),
        eq(transactionsTable.connectionId, connectionId),
        eq(transactionsTable.type, "deposit"),
        eq(transactionsTable.status, "success"),
        sql`date_trunc('month', ${transactionsTable.createdAt}) = date_trunc('month', now())`
      )
    );

  const monthlyUsed = Number(usageRow?.total ?? 0);
  const monthlyLimit = Number(conn.monthlyLimit);

  await Promise.all([
    maybeNotifyProviderLimit(merchant.userId, conn.provider, monthlyUsed, monthlyLimit, merchant.email, merchant.businessName ?? ""),
    maybeNotifyProviderLimitReset(merchant.userId, conn.provider, monthlyLimit),
  ]);
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
      // Match either via connectionId FK or directly on transactions.provider (for legacy/direct-tagged rows)
      conditions.push(
        or(
          inArray(transactionsTable.connectionId, matchingConnectionIds),
          eq(transactionsTable.provider, connectionProvider)
        )!
      );
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

    const isMerchantUser = user.role !== "admin";

    // Build a white-label gateway label ("Payment Gateway A", "B", …) for
    // each unique provider.
    //
    // For merchant users the label order is based on when each provider was
    // FIRST used by that merchant across ALL their transactions — completely
    // independent of the current date range, status filter, or page number.
    // This guarantees the same deposit always shows the same letter label
    // regardless of how the merchant navigates or what filters are active.
    //
    // For admin views the raw provider key is returned instead, so the label
    // is less critical; we keep the simpler per-filter computation there.
    let providerToLabel: Map<string, string>;

    if (isMerchantUser) {
      // Stable: first-ever usage date per provider, merchant-scoped, no other filters
      const stableRows = await db
        .select({
          connectionProvider: merchantConnectionsTable.provider,
          firstUsed: sql<string>`MIN(${transactionsTable.createdAt})`,
        })
        .from(transactionsTable)
        .leftJoin(merchantConnectionsTable, eq(transactionsTable.connectionId, merchantConnectionsTable.id))
        .where(
          and(
            eq(transactionsTable.merchantId, user.merchantId!),
            sql`${merchantConnectionsTable.provider} IS NOT NULL`
          )
        )
        .groupBy(merchantConnectionsTable.provider)
        .orderBy(sql`MIN(${transactionsTable.createdAt}) ASC, ${merchantConnectionsTable.provider} ASC`);

      providerToLabel = new Map<string, string>(
        stableRows.map((r, i) => [r.connectionProvider!, `Payment Gateway ${String.fromCharCode(65 + i)}`])
      );
    } else {
      // Admin: derive labels from the current filtered set (admins see raw provider names anyway)
      const allProviderRows = await db
        .selectDistinct({ connectionProvider: merchantConnectionsTable.provider })
        .from(transactionsTable)
        .leftJoin(merchantConnectionsTable, eq(transactionsTable.connectionId, merchantConnectionsTable.id))
        .where(and(where, sql`${merchantConnectionsTable.provider} IS NOT NULL`));

      const uniqueProviders = allProviderRows
        .map(r => r.connectionProvider)
        .filter((p): p is string => Boolean(p))
        .sort();
      providerToLabel = new Map<string, string>(
        uniqueProviders.map((p, i) => [p, `Payment Gateway ${String.fromCharCode(65 + i)}`])
      );
    }

    res.json({
      data: rows.map(r => ({
        ...r.transaction,
        amount: Number(r.transaction.amount),
        merchantName: r.merchantName ?? null,
        // Omit raw connectionProvider from merchant-facing responses — only
        // admins need the raw key. Merchants get the white-label label instead.
        connectionProvider: isMerchantUser ? undefined : (r.connectionProvider ?? null),
        payinGatewayLabel: r.connectionProvider ? (providerToLabel.get(r.connectionProvider) ?? null) : null,
      })),
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

    // Check provider limits whenever a successful deposit is recorded
    if (status === "success" && type === "deposit") {
      checkProviderLimitAfterDeposit(merchant.id, tx.connectionId ?? null).catch((err) => {
        req.log.warn({ err }, "Provider limit check after admin deposit failed");
      });
    }

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

    // Check provider limits whenever a simulated deposit resolves as success
    if (finalStatus === "success") {
      checkProviderLimitAfterDeposit(user.merchantId, finalTx.connectionId ?? null).catch((err) => {
        req.log.warn({ err }, "Provider limit check after simulated deposit failed");
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
  const { type, status, search, merchantId, dateFrom, dateTo, connectionProvider, amountMin, amountMax } = req.query as Record<string, string>;

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
    // Match either via connectionId FK or directly on transactions.provider (for legacy/direct-tagged rows)
    conditions.push(
      or(
        inArray(transactionsTable.connectionId, matchingConnectionIds),
        eq(transactionsTable.provider, connectionProvider)
      )!
    );
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
  if (amountMin) conditions.push(gte(sql`CAST(${transactionsTable.amount} AS DECIMAL)`, parseFloat(amountMin)));
  if (amountMax) conditions.push(lte(sql`CAST(${transactionsTable.amount} AS DECIMAL)`, parseFloat(amountMax)));

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
      filters: { type: type ?? null, status: status ?? null, search: search ?? null, merchantId: merchantId ?? null, dateFrom: dateFrom ?? null, dateTo: dateTo ?? null, connectionProvider: connectionProvider ?? null, amountMin: amountMin ?? null, amountMax: amountMax ?? null },
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
    const r = rows[0]!;
    const isMerchantUser = user.role !== "admin";
    // A single transaction has at most one gateway; label is always "A".
    const payinGatewayLabel = r.connectionProvider ? "Payment Gateway A" : null;
    res.json({
      ...r.transaction,
      amount: Number(r.transaction.amount),
      merchantName: r.merchantName ?? null,
      connectionProvider: isMerchantUser ? undefined : (r.connectionProvider ?? null),
      payinGatewayLabel,
    });
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

    // Check provider limits when a transaction is updated to success+deposit
    if (row.transaction.status === "success" && row.transaction.type === "deposit") {
      checkProviderLimitAfterDeposit(row.transaction.merchantId, row.transaction.connectionId ?? null).catch((err) => {
        req.log.warn({ err }, "Provider limit check after transaction status update failed");
      });
    }

    res.json({ ...row.transaction, amount: Number(row.transaction.amount), merchantName: row.merchantName ?? null });
  } catch (err) {
    next(err);
  }
});

export default router;
