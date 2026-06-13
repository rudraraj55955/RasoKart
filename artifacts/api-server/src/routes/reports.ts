import { Router } from "express";
import { db, transactionsTable, merchantsTable, merchantConnectionsTable, ledgerEntriesTable, settlementsTable, reportSchedulesTable, reportDeliveryLogsTable, auditLogsTable, usersTable } from "@workspace/db";
import { eq, and, sql, gte, lte, or, inArray, isNotNull, isNull, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { sendMerchantReport } from "../helpers/merchantReportScheduler";
import { createNotification } from "../helpers/notifications";
import { sendReportScheduleUpdatedEmail, buildReportScheduleUpdatedHtml } from "../helpers/reportScheduleEmail";

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

    // Capture existing state before upsert so we can detect re-activation
    const [existingBefore] = await db
      .select()
      .from(reportSchedulesTable)
      .where(eq(reportSchedulesTable.merchantId, user.merchantId!))
      .limit(1);

    const schedule = await upsertSchedule(user.merchantId!, { frequency, format, isActive, dayOfWeek, dayOfMonth });

    // If this PUT explicitly re-activates a previously-inactive schedule, log it
    if (isActive === true && existingBefore && !existingBefore.isActive) {
      await db.insert(reportDeliveryLogsTable).values({
        scheduleId: schedule.id,
        merchantId: user.merchantId!,
        success: true,
        isAutoPause: false,
        outcome: "re-enabled",
      });
    }

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

    await db.insert(reportDeliveryLogsTable).values({
      scheduleId: existing.id,
      merchantId: user.merchantId!,
      success: true,
      isAutoPause: false,
      outcome: "re-enabled",
    });

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
    const formatFilter = (req.query["format"] as string | undefined) ?? null;
    const dateFrom = (req.query["dateFrom"] as string | undefined) ?? null;
    const dateTo = (req.query["dateTo"] as string | undefined) ?? null;

    const conditions = [eq(reportDeliveryLogsTable.merchantId, user.merchantId!)];
    if (formatFilter === "xlsx" || formatFilter === "pdf") {
      conditions.push(eq(reportDeliveryLogsTable.format, formatFilter));
    }
    if (dateFrom) {
      conditions.push(gte(reportDeliveryLogsTable.attemptedAt, new Date(dateFrom)));
    }
    if (dateTo) {
      const endOfDay = new Date(dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      conditions.push(lte(reportDeliveryLogsTable.attemptedAt, endOfDay));
    }

    const logs = await db
      .select()
      .from(reportDeliveryLogsTable)
      .where(and(...conditions))
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

    const sent = await sendMerchantReport(scheduleRow, merchantRow.email, merchantRow.businessName, "manual");

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

// GET /api/reports/schedules/delivery-history — admin: consolidated delivery log across all merchants
router.get("/schedules/delivery-history", requireAdmin, async (req, res, next) => {
  try {
    const { merchantId, dateFrom, dateTo, success, triggeredBy } = req.query as Record<string, string>;

    const rawLimit = parseInt((req.query["limit"] as string) ?? "100");
    const limit = isNaN(rawLimit) ? 100 : Math.min(Math.max(rawLimit, 1), 200);

    const conditions = [];
    if (merchantId) conditions.push(eq(reportDeliveryLogsTable.merchantId, parseInt(merchantId as string)));
    if (dateFrom) conditions.push(gte(reportDeliveryLogsTable.attemptedAt, new Date(dateFrom)));
    if (dateTo) {
      const endOfDay = new Date(dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      conditions.push(lte(reportDeliveryLogsTable.attemptedAt, endOfDay));
    }
    if (success === "true") conditions.push(eq(reportDeliveryLogsTable.success, true));
    if (success === "false") conditions.push(eq(reportDeliveryLogsTable.success, false));
    if (triggeredBy && ["manual", "bulk", "scheduler"].includes(triggeredBy)) {
      conditions.push(eq(reportDeliveryLogsTable.triggeredBy, triggeredBy));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const logs = await db
      .select({
        log: reportDeliveryLogsTable,
        businessName: merchantsTable.businessName,
        merchantEmail: merchantsTable.email,
      })
      .from(reportDeliveryLogsTable)
      .leftJoin(merchantsTable, eq(reportDeliveryLogsTable.merchantId, merchantsTable.id))
      .where(where)
      .orderBy(desc(reportDeliveryLogsTable.attemptedAt))
      .limit(limit);

    res.json({
      logs: logs.map((r) => ({
        ...r.log,
        businessName: r.businessName ?? null,
        merchantEmail: r.merchantEmail ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

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

    // Batch-fetch recent failure logs for auto-paused schedules (non-zero consecutiveFailures)
    const pausedMerchantIds = rows
      .filter(r => !r.schedule.isActive && r.schedule.consecutiveFailures > 0)
      .map(r => r.schedule.merchantId);

    const recentFailuresByMerchant: Record<number, (typeof reportDeliveryLogsTable.$inferSelect)[]> = {};

    if (pausedMerchantIds.length > 0) {
      const failureLogs = await db
        .select()
        .from(reportDeliveryLogsTable)
        .where(and(
          inArray(reportDeliveryLogsTable.merchantId, pausedMerchantIds),
          eq(reportDeliveryLogsTable.success, false),
        ))
        .orderBy(desc(reportDeliveryLogsTable.attemptedAt))
        .limit(pausedMerchantIds.length * 3);

      for (const log of failureLogs) {
        if (!recentFailuresByMerchant[log.merchantId]) recentFailuresByMerchant[log.merchantId] = [];
        if (recentFailuresByMerchant[log.merchantId].length < 3) {
          recentFailuresByMerchant[log.merchantId].push(log);
        }
      }
    }

    res.json({
      schedules: rows.map(r => ({
        ...r.schedule,
        businessName: r.businessName,
        merchantEmail: r.email,
        recentFailures: recentFailuresByMerchant[r.schedule.merchantId] ?? [],
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/reports/schedules/send-all-overdue — admin: send reports to all overdue active schedules
router.post("/schedules/send-all-overdue", requireAdmin, async (req, res, next) => {
  try {
    const now = new Date();
    const { merchantIds } = req.body as { merchantIds?: number[] };

    // Validate merchantIds if provided
    if (merchantIds !== undefined && (!Array.isArray(merchantIds) || merchantIds.some((id) => typeof id !== "number"))) {
      res.status(400).json({ error: "merchantIds must be an array of integers" });
      return;
    }

    const rows = await db
      .select({
        schedule: reportSchedulesTable,
        email: merchantsTable.email,
        businessName: merchantsTable.businessName,
      })
      .from(reportSchedulesTable)
      .innerJoin(merchantsTable, eq(reportSchedulesTable.merchantId, merchantsTable.id))
      .where(eq(reportSchedulesTable.isActive, true));

    // When merchantIds is provided, restrict to that explicit set; otherwise target all active
    const candidates = merchantIds && merchantIds.length > 0
      ? rows.filter((r) => merchantIds.includes(r.schedule.merchantId))
      : rows;

    // Filter to only schedules where next due is in the past (overdue)
    const overdue = candidates.filter((r) => {
      if (!r.schedule.lastSentAt) return false;
      const last = new Date(r.schedule.lastSentAt);
      const freqDays = r.schedule.frequency === "monthly" ? 28 : r.schedule.frequency === "daily" ? 1 : 7;
      const nextDue = new Date(last.getTime() + freqDays * 24 * 60 * 60 * 1000);
      return nextDue < now;
    });

    let sent = 0;
    let failed = 0;
    const failures: { merchantId: number; merchantName: string; email: string; reason: string }[] = [];

    for (const row of overdue) {
      try {
        const ok = await sendMerchantReport(row.schedule, row.email, row.businessName, "bulk");
        if (ok) {
          sent++;
        } else {
          failed++;
          failures.push({
            merchantId: row.schedule.merchantId,
            merchantName: row.businessName,
            email: row.email,
            reason: "Report delivery failed — SMTP or attachment error",
          });
        }
      } catch (err) {
        failed++;
        failures.push({
          merchantId: row.schedule.merchantId,
          merchantName: row.businessName,
          email: row.email,
          reason: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    res.json({ sent, failed, total: overdue.length, failures });
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

    const { frequency, format, isActive, dayOfWeek, dayOfMonth, nextRunAt } = req.body as {
      frequency?: string;
      format?: string;
      isActive?: boolean;
      dayOfWeek?: number;
      dayOfMonth?: number;
      nextRunAt?: string | null;
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
    if (nextRunAt !== undefined && nextRunAt !== null) {
      const parsed = new Date(nextRunAt);
      if (isNaN(parsed.getTime())) {
        res.status(400).json({ error: "nextRunAt must be a valid ISO 8601 timestamp or null" });
        return;
      }
    }

    // Verify merchant exists and fetch contact details for notifications
    const [merchant] = await db
      .select({ id: merchantsTable.id, email: merchantsTable.email, businessName: merchantsTable.businessName })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, mid))
      .limit(1);
    if (!merchant) {
      res.status(404).json({ error: "Merchant not found" });
      return;
    }

    const schedule = await upsertSchedule(mid, { frequency, format, isActive, dayOfWeek, dayOfMonth, nextRunAt });

    // Write audit log and notify merchant whenever an admin explicitly sets or clears nextRunAt
    if (nextRunAt !== undefined) {
      const admin = (req as any).user;
      await db.insert(auditLogsTable).values({
        adminId: admin.id,
        adminEmail: admin.email,
        action: nextRunAt === null ? "report_schedule_override_cleared" : "report_schedule_override_set",
        targetType: "report_schedule",
        targetId: mid,
        details: JSON.stringify({
          merchantId: mid,
          nextRunAt: nextRunAt ?? null,
          frequency: schedule.frequency,
          format: schedule.format,
        }),
        ipAddress: req.ip ?? null,
      });
      const [u] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.merchantId, mid)).limit(1);
      if (u) {
        const body = nextRunAt === null
          ? "An admin has reverted your report schedule next run date to its normal cadence."
          : `An admin has updated your report schedule. Your next report will be sent on ${new Date(nextRunAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} IST.`;
        createNotification({
          userId: u.id,
          type: "report_schedule_next_run_updated",
          title: "Report Schedule Updated",
          body,
          metadata: { nextRunAt: nextRunAt ?? null },
        }).catch(() => {});
      }
      // Send email to merchant alongside the in-app notification (respects opt-out preference)
      sendReportScheduleUpdatedEmail({
        merchantId: merchant.id,
        to: merchant.email,
        businessName: merchant.businessName,
        nextRunAt: nextRunAt ?? null,
      }).catch(() => {});
    }

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

    const [merchant] = await db
      .select({ businessName: merchantsTable.businessName })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, mid))
      .limit(1);

    await db
      .delete(reportSchedulesTable)
      .where(eq(reportSchedulesTable.merchantId, mid));

    const admin = (req as any).user;
    await db.insert(auditLogsTable).values({
      adminId: admin.id,
      adminEmail: admin.email,
      action: "report_schedule_deleted",
      targetType: "merchant",
      targetId: mid,
      details: JSON.stringify({
        merchantId: mid,
        businessName: merchant?.businessName ?? null,
      }),
      ipAddress: req.ip ?? null,
    });

    const [u] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.merchantId, mid)).limit(1);
    if (u) {
      createNotification({
        userId: u.id,
        type: "report_schedule_deleted",
        title: "Report Schedule Removed",
        body: "An admin has removed your scheduled report. You will no longer receive automated reports unless a new schedule is set up.",
        metadata: { merchantId: mid },
      }).catch(() => {});
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/schedules/:merchantId/email-preview — admin: preview the schedule-update email (no email sent)
router.get("/schedules/:merchantId/email-preview", requireAdmin, async (req, res, next) => {
  try {
    const mid = parseInt(req.params['merchantId'] as string);
    if (isNaN(mid)) {
      res.status(400).json({ error: "Invalid merchantId" });
      return;
    }

    const [merchant] = await db
      .select({ id: merchantsTable.id, businessName: merchantsTable.businessName })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, mid))
      .limit(1);
    if (!merchant) {
      res.status(404).json({ error: "Merchant not found" });
      return;
    }

    const rawNextRunAt = (req.query["nextRunAt"] as string | undefined) ?? null;
    const nextRunAt = rawNextRunAt && rawNextRunAt.trim() !== "" ? rawNextRunAt : null;

    const formattedDate = nextRunAt
      ? new Date(nextRunAt).toLocaleString("en-IN", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Asia/Kolkata",
        })
      : null;

    const subject = nextRunAt === null
      ? "[RasoKart] Your report schedule has been reverted to normal cadence"
      : `[RasoKart] Your next report is scheduled for ${formattedDate} IST`;

    const html = buildReportScheduleUpdatedHtml({ businessName: merchant.businessName, nextRunAt, formattedDate });

    res.json({ html, subject });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/schedules/:merchantId/history — admin: get delivery history for a merchant's schedule
router.get("/schedules/:merchantId/history", requireAdmin, async (req, res, next) => {
  try {
    const mid = parseInt(req.params['merchantId'] as string);
    if (isNaN(mid)) {
      res.status(400).json({ error: "Invalid merchantId" });
      return;
    }

    const rawLimit = parseInt((req.query["limit"] as string) ?? "20");
    const limit = isNaN(rawLimit) ? 20 : Math.min(Math.max(rawLimit, 1), 100);

    const logs = await db
      .select()
      .from(reportDeliveryLogsTable)
      .where(eq(reportDeliveryLogsTable.merchantId, mid))
      .orderBy(desc(reportDeliveryLogsTable.attemptedAt))
      .limit(limit);

    res.json({ logs });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/reports/schedules/:merchantId/reenable — admin: re-enable a merchant's auto-paused schedule
router.patch("/schedules/:merchantId/reenable", requireAdmin, async (req, res, next) => {
  try {
    const mid = parseInt(req.params['merchantId'] as string);
    if (isNaN(mid)) {
      res.status(400).json({ error: "Invalid merchantId" });
      return;
    }

    const [existing] = await db
      .select()
      .from(reportSchedulesTable)
      .where(eq(reportSchedulesTable.merchantId, mid))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "No schedule configured for this merchant" });
      return;
    }

    const [updated] = await db
      .update(reportSchedulesTable)
      .set({ isActive: true, consecutiveFailures: 0, updatedAt: new Date() })
      .where(eq(reportSchedulesTable.merchantId, mid))
      .returning();

    const admin = (req as any).user;
    await db.insert(auditLogsTable).values({
      adminId: admin.id,
      adminEmail: admin.email,
      action: "report_schedule_reenabled",
      targetType: "merchant",
      targetId: mid,
      details: JSON.stringify({
        merchantId: mid,
        previousConsecutiveFailures: existing.consecutiveFailures,
        consecutiveFailuresReset: 0,
        frequency: existing.frequency,
        format: existing.format,
      }),
      ipAddress: req.ip ?? null,
    });

    const [u] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.merchantId, mid)).limit(1);
    if (u) {
      createNotification({
        userId: u.id,
        type: "report_schedule_reenabled",
        title: "Report Schedule Re-enabled",
        body: "Your report schedule has been re-enabled by an admin. Future reports will resume on the normal cadence.",
        metadata: {},
      }).catch(() => {});
    }

    res.json({ schedule: updated });
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

    const sent = await sendMerchantReport(scheduleRow, merchantRow.email, merchantRow.businessName, "manual");

    if (!sent) {
      res.status(502).json({ error: "Failed to send report — check SMTP configuration" });
      return;
    }

    const admin = (req as any).user;
    await db.insert(auditLogsTable).values({
      adminId: admin.id,
      adminEmail: admin.email,
      action: "report_manual_send",
      targetType: "merchant",
      targetId: mid,
      details: JSON.stringify({
        merchantId: mid,
        businessName: merchantRow.businessName,
        sentTo: merchantRow.email,
        frequency: scheduleRow.frequency,
        format: scheduleRow.format,
      }),
      ipAddress: req.ip ?? null,
    });

    const [u] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.merchantId, mid)).limit(1);
    if (u) {
      const frequencyLabel = scheduleRow.frequency === "monthly" ? "monthly" : "weekly";
      createNotification({
        userId: u.id,
        type: "report_manual_send",
        title: "Report Manually Sent by Admin",
        body: `An admin manually sent your ${frequencyLabel} report. Check your inbox at ${merchantRow.email}.`,
        metadata: { merchantId: mid, frequency: scheduleRow.frequency, sentTo: merchantRow.email },
      }).catch(() => {});
    }

    res.json({ ok: true, to: merchantRow.email });
  } catch (err) {
    next(err);
  }
});

// ─── Shared helper ────────────────────────────────────────────────────────────

async function upsertSchedule(
  merchantId: number,
  patch: { frequency?: string; format?: string; isActive?: boolean; dayOfWeek?: number; dayOfMonth?: number; nextRunAt?: string | null },
): Promise<typeof reportSchedulesTable.$inferSelect> {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(reportSchedulesTable)
    .where(eq(reportSchedulesTable.merchantId, merchantId))
    .limit(1);

  // Determine effective frequency for normalization
  const effectiveFrequency = patch.frequency ?? existing?.frequency ?? "weekly";

  // Resolve nextRunAt: explicit null clears it, a string sets it, undefined leaves it unchanged
  const nextRunAtValue = patch.nextRunAt !== undefined
    ? (patch.nextRunAt === null ? null : new Date(patch.nextRunAt))
    : undefined;

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
        // Reset failure counter whenever the schedule is being re-enabled
        ...(patch.isActive === true ? { consecutiveFailures: 0 } : {}),
        dayOfWeek: effectiveFrequency === "weekly" ? dayWeekValue : null,
        dayOfMonth: effectiveFrequency === "monthly" ? dayMonthValue : null,
        ...(nextRunAtValue !== undefined ? { nextRunAt: nextRunAtValue } : {}),
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
      nextRunAt: nextRunAtValue ?? null,
      updatedAt: now,
    })
    .returning();
  return inserted!;
}

export default router;
