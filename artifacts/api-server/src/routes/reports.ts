import { Router } from "express";
import { db, transactionsTable, merchantsTable, merchantConnectionsTable, ledgerEntriesTable, settlementsTable } from "@workspace/db";
import { eq, and, sql, gte, lte, or, inArray, isNotNull, isNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

// GET /api/reports/transactions
// Returns all matching transactions (no pagination, up to 10,000 rows) with aggregate stats,
// fee per transaction (from ledger_entries type=fee), and settlement status (from settlements).
// Merchant: auto-scoped. Admin: optionally scoped by merchantId.
router.get("/transactions", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { type, status, merchantId, dateFrom, dateTo, amountMin, amountMax, connectionProvider, source } = req.query as Record<string, string>;

    const conditions = [];
    if (user.role !== "admin") {
      conditions.push(eq(transactionsTable.merchantId, user.merchantId!));
    } else if (merchantId) {
      conditions.push(eq(transactionsTable.merchantId, parseInt(merchantId as string)));
    }
    if (type && type !== "all") conditions.push(eq(transactionsTable.type, type));
    if (status && status !== "all") conditions.push(eq(transactionsTable.status, status));
    if (connectionProvider) {
      const matchingConnectionIds = db
        .select({ id: merchantConnectionsTable.id })
        .from(merchantConnectionsTable)
        .where(eq(merchantConnectionsTable.provider, connectionProvider));
      conditions.push(
        or(
          inArray(transactionsTable.connectionId, matchingConnectionIds),
          eq(transactionsTable.provider, connectionProvider)
        )!
      );
    }
    if (source) {
      switch (source) {
        case "qr_code":
          conditions.push(isNotNull(transactionsTable.qrCodeId));
          break;
        case "virtual_account":
          conditions.push(isNotNull(transactionsTable.virtualAccountId));
          break;
        case "payment_link":
          conditions.push(isNotNull(transactionsTable.paymentLinkId));
          break;
        case "direct":
          conditions.push(isNull(transactionsTable.qrCodeId));
          conditions.push(isNull(transactionsTable.virtualAccountId));
          conditions.push(isNull(transactionsTable.paymentLinkId));
          break;
      }
    }
    if (dateFrom) conditions.push(gte(transactionsTable.createdAt, new Date(dateFrom)));
    if (dateTo) {
      const endOfDay = new Date(dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      conditions.push(lte(transactionsTable.createdAt, endOfDay));
    }
    if (amountMin) conditions.push(gte(sql`CAST(${transactionsTable.amount} AS DECIMAL)`, parseFloat(amountMin)));
    if (amountMax) conditions.push(lte(sql`CAST(${transactionsTable.amount} AS DECIMAL)`, parseFloat(amountMax)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [aggRows, rows] = await Promise.all([
      db
        .select({
          depositVolume: sql<string>`COALESCE(SUM(CASE WHEN ${transactionsTable.type} = 'deposit' THEN CAST(${transactionsTable.amount} AS DECIMAL) ELSE 0 END), 0)`,
          withdrawalVolume: sql<string>`COALESCE(SUM(CASE WHEN ${transactionsTable.type} = 'withdrawal' THEN CAST(${transactionsTable.amount} AS DECIMAL) ELSE 0 END), 0)`,
          successCount: sql<number>`CAST(COUNT(CASE WHEN ${transactionsTable.status} = 'success' THEN 1 END) AS INTEGER)`,
          failedCount: sql<number>`CAST(COUNT(CASE WHEN ${transactionsTable.status} = 'failed' THEN 1 END) AS INTEGER)`,
          pendingCount: sql<number>`CAST(COUNT(CASE WHEN ${transactionsTable.status} = 'pending' THEN 1 END) AS INTEGER)`,
          totalFees: sql<string>`COALESCE(SUM(
            (SELECT COALESCE(ABS(SUM(CAST(le.amount AS DECIMAL))), 0)
             FROM ledger_entries le
             WHERE le.reference_type = 'transaction'
               AND le.reference_id = ${transactionsTable.id}
               AND le.type = 'fee')
          ), 0)`,
        })
        .from(transactionsTable)
        .where(where),
      db
        .select({
          transaction: transactionsTable,
          merchantName: merchantsTable.businessName,
          connectionProvider: merchantConnectionsTable.provider,
          fee: sql<string>`COALESCE((
            SELECT ABS(SUM(CAST(le.amount AS DECIMAL)))
            FROM ${ledgerEntriesTable} le
            WHERE le.reference_type = 'transaction'
              AND le.reference_id = ${transactionsTable.id}
              AND le.type = 'fee'
          ), 0)`,
          settlementStatus: sql<string>`COALESCE((
            SELECT s.status
            FROM ${settlementsTable} s
            WHERE s.merchant_id = ${transactionsTable.merchantId}
              AND s.period_from IS NOT NULL
              AND s.period_to IS NOT NULL
              AND s.period_from <= ${transactionsTable.createdAt}::date
              AND s.period_to >= ${transactionsTable.createdAt}::date
              AND s.status IN ('paid', 'approved', 'processing')
            ORDER BY s.created_at DESC
            LIMIT 1
          ), 'unsettled')`,
        })
        .from(transactionsTable)
        .leftJoin(merchantsTable, eq(transactionsTable.merchantId, merchantsTable.id))
        .leftJoin(merchantConnectionsTable, eq(transactionsTable.connectionId, merchantConnectionsTable.id))
        .where(where)
        .limit(10000)
        .orderBy(sql`${transactionsTable.createdAt} DESC`),
    ]);

    const agg = aggRows[0];

    res.json({
      data: rows.map((r) => ({
        ...r.transaction,
        amount: Number(r.transaction.amount),
        merchantName: r.merchantName ?? null,
        connectionProvider: r.connectionProvider ?? null,
        fee: Number(r.fee ?? 0),
        settlementStatus: r.settlementStatus ?? "unsettled",
      })),
      stats: {
        depositVolume: Number(agg?.depositVolume ?? 0),
        withdrawalVolume: Number(agg?.withdrawalVolume ?? 0),
        successCount: Number(agg?.successCount ?? 0),
        failedCount: Number(agg?.failedCount ?? 0),
        pendingCount: Number(agg?.pendingCount ?? 0),
        totalFees: Number(agg?.totalFees ?? 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
