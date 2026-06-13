import { Router } from "express";
import { db, transactionsTable, merchantsTable, merchantConnectionsTable, ledgerEntriesTable, settlementsTable, reportSchedulesTable, reportDeliveryLogsTable } from "@workspace/db";
import { eq, and, sql, gte, lte, or, inArray, isNotNull, isNull, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { sendMerchantReport } from "../helpers/merchantReportScheduler";

const router = Router();
router.use(requireAuth);

// GET /api/reports/transactions
// Returns all matching transactions (no pagination, up to 10,000 rows) with aggregate stats.
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

// GET /api/reports/settlements
// Returns all matching settlements (no pagination, up to 10,000 rows) with aggregate stats.
// Merchant: auto-scoped. Admin: optionally scoped by merchantId.
router.get("/settlements", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { status, settlementId, merchantId, dateFrom, dateTo } = req.query as Record<string, string>;

    const conditions = [];
    if (user.role !== "admin") {
      conditions.push(eq(settlementsTable.merchantId, user.merchantId!));
    } else if (merchantId) {
      conditions.push(eq(settlementsTable.merchantId, parseInt(merchantId as string)));
    }
    if (status && status !== "all") conditions.push(eq(settlementsTable.status, status));
    if (settlementId) conditions.push(eq(settlementsTable.id, parseInt(settlementId as string)));
    if (dateFrom) conditions.push(gte(settlementsTable.createdAt, new Date(dateFrom)));
    if (dateTo) {
      const endOfDay = new Date(dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      conditions.push(lte(settlementsTable.createdAt, endOfDay));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [aggRows, rows] = await Promise.all([
      db
        .select({
          totalAmount: sql<string>`COALESCE(SUM(CAST(${settlementsTable.amount} AS DECIMAL)), 0)`,
          paidAmount: sql<string>`COALESCE(SUM(CASE WHEN ${settlementsTable.status} = 'paid' THEN CAST(${settlementsTable.amount} AS DECIMAL) ELSE 0 END), 0)`,
          pendingAmount: sql<string>`COALESCE(SUM(CASE WHEN ${settlementsTable.status} IN ('pending', 'processing', 'approved') THEN CAST(${settlementsTable.amount} AS DECIMAL) ELSE 0 END), 0)`,
          rejectedAmount: sql<string>`COALESCE(SUM(CASE WHEN ${settlementsTable.status} IN ('rejected', 'cancelled') THEN CAST(${settlementsTable.amount} AS DECIMAL) ELSE 0 END), 0)`,
          paidCount: sql<number>`CAST(COUNT(CASE WHEN ${settlementsTable.status} = 'paid' THEN 1 END) AS INTEGER)`,
          pendingCount: sql<number>`CAST(COUNT(CASE WHEN ${settlementsTable.status} = 'pending' THEN 1 END) AS INTEGER)`,
          processingCount: sql<number>`CAST(COUNT(CASE WHEN ${settlementsTable.status} IN ('processing', 'approved') THEN 1 END) AS INTEGER)`,
          rejectedCount: sql<number>`CAST(COUNT(CASE WHEN ${settlementsTable.status} IN ('rejected', 'cancelled') THEN 1 END) AS INTEGER)`,
          totalCount: sql<number>`CAST(COUNT(*) AS INTEGER)`,
        })
        .from(settlementsTable)
        .where(where),
      db
        .select({
          settlement: settlementsTable,
          merchantName: merchantsTable.businessName,
        })
        .from(settlementsTable)
        .leftJoin(merchantsTable, eq(settlementsTable.merchantId, merchantsTable.id))
        .where(where)
        .limit(10000)
        .orderBy(sql`${settlementsTable.createdAt} DESC`),
    ]);

    const agg = aggRows[0];

    res.json({
      data: rows.map((r) => {
        const amount = Number(r.settlement.amount);
        const requestedAmount = r.settlement.requestedAmount != null ? Number(r.settlement.requestedAmount) : null;
        const fees = requestedAmount != null ? Math.max(requestedAmount - amount, 0) : 0;
        return {
          ...r.settlement,
          amount,
          requestedAmount,
          fees,
          merchantName: r.merchantName ?? null,
        };
      }),
      stats: {
        totalAmount: Number(agg?.totalAmount ?? 0),
        paidAmount: Number(agg?.paidAmount ?? 0),
        pendingAmount: Number(agg?.pendingAmount ?? 0),
        rejectedAmount: Number(agg?.rejectedAmount ?? 0),
        paidCount: Number(agg?.paidCount ?? 0),
        pendingCount: Number(agg?.pendingCount ?? 0),
        processingCount: Number(agg?.processingCount ?? 0),
        rejectedCount: Number(agg?.rejectedCount ?? 0),
        totalCount: Number(agg?.totalCount ?? 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/transactions/count
// Returns a lightweight count of matching transactions (no data rows).
router.get("/transactions/count", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { type, status, merchantId, dateFrom, dateTo, connectionProvider, source } = req.query as Record<string, string>;

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

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [row] = await db
      .select({ count: sql<number>`CAST(COUNT(*) AS INTEGER)` })
      .from(transactionsTable)
      .where(where);

    res.json({ count: Number(row?.count ?? 0) });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/settlements/count
// Returns a lightweight count of matching settlements (no data rows).
router.get("/settlements/count", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { status, merchantId, dateFrom, dateTo } = req.query as Record<string, string>;

    const conditions = [];
    if (user.role !== "admin") {
      conditions.push(eq(settlementsTable.merchantId, user.merchantId!));
    } else if (merchantId) {
      conditions.push(eq(settlementsTable.merchantId, parseInt(merchantId as string)));
    }
    if (status && status !== "all") conditions.push(eq(settlementsTable.status, status));
    if (dateFrom) conditions.push(gte(settlementsTable.createdAt, new Date(dateFrom)));
    if (dateTo) {
      const endOfDay = new Date(dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      conditions.push(lte(settlementsTable.createdAt, endOfDay));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [row] = await db
      .select({ count: sql<number>`CAST(COUNT(*) AS INTEGER)` })
      .from(settlementsTable)
      .where(where);

    res.json({ count: Number(row?.count ?? 0) });
  } catch (err) {
    next(err);
  }
});

// ─── Merchant: own schedule ───────────────────────────────────────────────────

// GET /api/reports/schedule — merchant: get own schedule
router.get("/schedule", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const [row] = await db
      .select()
      .from(reportSchedulesTable)
      .where(eq(reportSchedulesTable.merchantId, user.merchantId!))
      .limit(1);

    res.json({ schedule: row ?? null });
  } catch (err) {
    next(err);
  }
});

// PUT /api/reports/schedule — merchant: upsert own schedule
router.put("/schedule", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const { frequency, format, isActive, dayOfWeek, dayOfMonth } = req.body as {
      frequency?: string;
      format?: string;
      isActive?: boolean;
      dayOfWeek?: number;
      dayOfMonth?: number;
    };

    if (frequency && !["weekly", "monthly"].includes(frequency)) {
      res.status(400).json({ error: "frequency must be 'weekly' or 'monthly'" });
      return;
    }
    if (format && !["xlsx", "pdf"].includes(format)) {
      res.status(400).json({ error: "format must be 'xlsx' or 'pdf'" });
      return;
    }
    if (dayOfWeek !== undefined && (typeof dayOfWeek !== "number" || dayOfWeek < 0 || dayOfWeek > 6)) {
      res.status(400).json({ error: "dayOfWeek must be 0–6" });
      return;
    }
    if (dayOfMonth !== undefined && (typeof dayOfMonth !== "number" || dayOfMonth < 1 || dayOfMonth > 28)) {
      res.status(400).json({ error: "dayOfMonth must be 1–28" });
      return;
    }

    const schedule = await upsertSchedule(user.merchantId!, { frequency, format, isActive, dayOfWeek, dayOfMonth });
    res.json({ schedule });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/reports/schedule/reenable — merchant: re-enable a paused schedule
router.patch("/schedule/reenable", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const [existing] = await db
      .select()
      .from(reportSchedulesTable)
      .where(eq(reportSchedulesTable.merchantId, user.merchantId!))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "No schedule configured" });
      return;
    }

    const [updated] = await db
      .update(reportSchedulesTable)
      .set({ isActive: true, consecutiveFailures: 0, updatedAt: new Date() })
      .where(eq(reportSchedulesTable.merchantId, user.merchantId!))
      .returning();

    res.json({ schedule: updated });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/reports/schedule — merchant: remove own schedule
router.delete("/schedule", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    await db
      .delete(reportSchedulesTable)
      .where(eq(reportSchedulesTable.merchantId, user.merchantId!));

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/schedule/history — merchant: get own delivery log
router.get("/schedule/history", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const rawLimit = parseInt((req.query["limit"] as string) ?? "20");
    const limit = isNaN(rawLimit) ? 20 : Math.min(Math.max(rawLimit, 1), 100);

    const logs = await db
      .select()
      .from(reportDeliveryLogsTable)
      .where(eq(reportDeliveryLogsTable.merchantId, user.merchantId!))
      .orderBy(desc(reportDeliveryLogsTable.attemptedAt))
      .limit(limit);

    res.json({ logs });
  } catch (err) {
    next(err);
  }
});

// POST /api/reports/schedule/send-now — merchant: trigger immediate send
router.post("/schedule/send-now", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const [scheduleRow] = await db
      .select()
      .from(reportSchedulesTable)
      .where(eq(reportSchedulesTable.merchantId, user.merchantId!))
      .limit(1);

    if (!scheduleRow) {
      res.status(404).json({ error: "No schedule configured. Save a schedule first." });
      return;
    }

    const [merchantRow] = await db
      .select({ email: merchantsTable.email, businessName: merchantsTable.businessName })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, user.merchantId!))
      .limit(1);

    if (!merchantRow) {
      res.status(404).json({ error: "Merchant not found" });
      return;
    }

    const sent = await sendMerchantReport(scheduleRow, merchantRow.email, merchantRow.businessName);

    if (!sent) {
      res.status(502).json({ error: "Failed to send report — check SMTP configuration" });
      return;
    }

    res.json({ ok: true, to: merchantRow.email });
  } catch (err) {
    next(err);
  }
});

// ─── Admin: manage any merchant's schedule ────────────────────────────────────

// GET /api/reports/schedules — admin: list all merchants' schedules
router.get("/schedules", requireAdmin, async (req, res, next) => {
  try {
    const rows = await db
      .select({
        schedule: reportSchedulesTable,
        businessName: merchantsTable.businessName,
        email: merchantsTable.email,
      })
      .from(reportSchedulesTable)
      .innerJoin(merchantsTable, eq(reportSchedulesTable.merchantId, merchantsTable.id))
      .orderBy(merchantsTable.businessName);

    res.json({
      schedules: rows.map(r => ({
        ...r.schedule,
        businessName: r.businessName,
        merchantEmail: r.email,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/schedules/:merchantId — admin: get a specific merchant's schedule
router.get("/schedules/:merchantId", requireAdmin, async (req, res, next) => {
  try {
    const mid = parseInt(req.params['merchantId'] as string);
    if (isNaN(mid)) {
      res.status(400).json({ error: "Invalid merchantId" });
      return;
    }

    const [row] = await db
      .select()
      .from(reportSchedulesTable)
      .where(eq(reportSchedulesTable.merchantId, mid))
      .limit(1);

    res.json({ schedule: row ?? null });
  } catch (err) {
    next(err);
  }
});

// PUT /api/reports/schedules/:merchantId — admin: create/update a merchant's schedule
router.put("/schedules/:merchantId", requireAdmin, async (req, res, next) => {
  try {
    const mid = parseInt(req.params['merchantId'] as string);
    if (isNaN(mid)) {
      res.status(400).json({ error: "Invalid merchantId" });
      return;
    }

    const { frequency, format, isActive, dayOfWeek, dayOfMonth } = req.body as {
      frequency?: string;
      format?: string;
      isActive?: boolean;
      dayOfWeek?: number;
      dayOfMonth?: number;
    };

    if (frequency && !["weekly", "monthly"].includes(frequency)) {
      res.status(400).json({ error: "frequency must be 'weekly' or 'monthly'" });
      return;
    }
    if (format && !["xlsx", "pdf"].includes(format)) {
      res.status(400).json({ error: "format must be 'xlsx' or 'pdf'" });
      return;
    }
    if (dayOfWeek !== undefined && (typeof dayOfWeek !== "number" || dayOfWeek < 0 || dayOfWeek > 6)) {
      res.status(400).json({ error: "dayOfWeek must be 0–6" });
      return;
    }
    if (dayOfMonth !== undefined && (typeof dayOfMonth !== "number" || dayOfMonth < 1 || dayOfMonth > 28)) {
      res.status(400).json({ error: "dayOfMonth must be 1–28" });
      return;
    }

    // Verify merchant exists
    const [merchant] = await db
      .select({ id: merchantsTable.id })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, mid))
      .limit(1);
    if (!merchant) {
      res.status(404).json({ error: "Merchant not found" });
      return;
    }

    const schedule = await upsertSchedule(mid, { frequency, format, isActive, dayOfWeek, dayOfMonth });
    res.json({ schedule });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/reports/schedules/:merchantId — admin: remove a merchant's schedule
router.delete("/schedules/:merchantId", requireAdmin, async (req, res, next) => {
  try {
    const mid = parseInt(req.params['merchantId'] as string);
    if (isNaN(mid)) {
      res.status(400).json({ error: "Invalid merchantId" });
      return;
    }

    await db
      .delete(reportSchedulesTable)
      .where(eq(reportSchedulesTable.merchantId, mid));

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/reports/schedules/:merchantId/send-now — admin: trigger immediate send for a merchant
router.post("/schedules/:merchantId/send-now", requireAdmin, async (req, res, next) => {
  try {
    const mid = parseInt(req.params['merchantId'] as string);
    if (isNaN(mid)) {
      res.status(400).json({ error: "Invalid merchantId" });
      return;
    }

    const [scheduleRow] = await db
      .select()
      .from(reportSchedulesTable)
      .where(eq(reportSchedulesTable.merchantId, mid))
      .limit(1);

    if (!scheduleRow) {
      res.status(404).json({ error: "No schedule configured for this merchant" });
      return;
    }

    const [merchantRow] = await db
      .select({ email: merchantsTable.email, businessName: merchantsTable.businessName })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, mid))
      .limit(1);

    if (!merchantRow) {
      res.status(404).json({ error: "Merchant not found" });
      return;
    }

    const sent = await sendMerchantReport(scheduleRow, merchantRow.email, merchantRow.businessName);

    if (!sent) {
      res.status(502).json({ error: "Failed to send report — check SMTP configuration" });
      return;
    }

    res.json({ ok: true, to: merchantRow.email });
  } catch (err) {
    next(err);
  }
});

// ─── Shared helper ────────────────────────────────────────────────────────────

async function upsertSchedule(
  merchantId: number,
  patch: { frequency?: string; format?: string; isActive?: boolean; dayOfWeek?: number; dayOfMonth?: number },
): Promise<typeof reportSchedulesTable.$inferSelect> {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(reportSchedulesTable)
    .where(eq(reportSchedulesTable.merchantId, merchantId))
    .limit(1);

  // Determine effective frequency for normalization
  const effectiveFrequency = patch.frequency ?? existing?.frequency ?? "weekly";

  if (existing) {
    // When frequency is set to weekly, clear dayOfMonth (and vice versa) to keep records consistent
    const dayWeekValue = patch.dayOfWeek !== undefined
      ? patch.dayOfWeek
      : effectiveFrequency === "weekly" ? existing.dayOfWeek : null;
    const dayMonthValue = patch.dayOfMonth !== undefined
      ? patch.dayOfMonth
      : effectiveFrequency === "monthly" ? existing.dayOfMonth : null;

    const [updated] = await db
      .update(reportSchedulesTable)
      .set({
        ...(patch.frequency !== undefined ? { frequency: patch.frequency } : {}),
        ...(patch.format !== undefined ? { format: patch.format } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        dayOfWeek: effectiveFrequency === "weekly" ? dayWeekValue : null,
        dayOfMonth: effectiveFrequency === "monthly" ? dayMonthValue : null,
        updatedAt: now,
      })
      .where(eq(reportSchedulesTable.merchantId, merchantId))
      .returning();
    return updated!;
  }

  const [inserted] = await db
    .insert(reportSchedulesTable)
    .values({
      merchantId,
      frequency: effectiveFrequency,
      format: patch.format ?? "xlsx",
      isActive: patch.isActive ?? true,
      dayOfWeek: effectiveFrequency === "weekly" ? (patch.dayOfWeek ?? null) : null,
      dayOfMonth: effectiveFrequency === "monthly" ? (patch.dayOfMonth ?? null) : null,
      updatedAt: now,
    })
    .returning();
  return inserted!;
}

export default router;
