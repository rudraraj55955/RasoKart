import { Router } from "express";
import { db, reconciliationRunsTable, reconciliationItemsTable, transactionsTable, settlementsTable, merchantsTable, usersTable, auditLogsTable, reconciliationEmailLogsTable } from "@workspace/db";
import { eq, and, gte, lte, inArray, sql, count, or, isNull, isNotNull, gt, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { runReconciliation } from "../helpers/reconcileEngine";
import { loadReconConfig } from "../helpers/reconScheduler";
import { sendReconciliationReportEmail, notifyAdminsOfUnmatchedItems } from "../helpers/reconcileEmail";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

function mapRun(r: typeof reconciliationRunsTable.$inferSelect) {
  return {
    ...r,
    matchedAmount: Number(r.matchedAmount),
    unmatchedAmount: Number(r.unmatchedAmount),
  };
}

// GET /api/reconciliation/scheduler-status
router.get("/scheduler-status", async (req, res, next) => {
  try {
    const config = await loadReconConfig();
    const { hour, minute } = config;

    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    const cronExpression = `${minute} ${hour} * * *`;

    const lastAutoRun = await db
      .select({ createdAt: reconciliationRunsTable.createdAt, status: reconciliationRunsTable.status })
      .from(reconciliationRunsTable)
      .where(eq(reconciliationRunsTable.triggeredBy, "auto"))
      .orderBy(sql`${reconciliationRunsTable.createdAt} DESC`)
      .limit(1);

    const lastAutoRunAt = lastAutoRun.length > 0 ? lastAutoRun[0]!.createdAt : null;
    const lastAutoRunStatus = lastAutoRun.length > 0 ? lastAutoRun[0]!.status : null;

    res.json({
      nextRunAt: next.toISOString(),
      cronExpression,
      hasEverRun: lastAutoRun.length > 0,
      lastAutoRunAt: lastAutoRunAt ? lastAutoRunAt.toISOString() : null,
      lastAutoRunStatus,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/reconciliation/run
router.post("/run", async (req, res, next) => {
  try {
    const { dateFrom, dateTo, merchantId } = req.body;
    const user = (req as any).user;

    if (!dateFrom || !dateTo) {
      res.status(400).json({ error: "dateFrom and dateTo are required (YYYY-MM-DD)" });
      return;
    }

    const fromDate = new Date(dateFrom + "T00:00:00.000Z");
    const toDate = new Date(dateTo + "T23:59:59.999Z");

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || fromDate > toDate) {
      res.status(400).json({ error: "Invalid date range" });
      return;
    }

    const parsedMerchantId = merchantId ? parseInt(merchantId) : null;

    const updated = await runReconciliation({
      dateFrom,
      dateTo,
      merchantId: parsedMerchantId,
      createdBy: user.id,
      triggeredBy: "manual",
    });

    res.status(201).json(mapRun(updated));
  } catch (err) {
    next(err);
  }
});

// GET /api/reconciliation/runs
router.get("/runs", async (req, res, next) => {
  try {
    const { page = "1", limit = "20", merchantId } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    if (merchantId) conditions.push(eq(reconciliationRunsTable.merchantId, parseInt(merchantId)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ total }] = await db.select({ total: count() }).from(reconciliationRunsTable).where(where);

    const rows = await db
      .select({
        run: reconciliationRunsTable,
        merchantName: merchantsTable.businessName,
        createdByEmail: usersTable.email,
      })
      .from(reconciliationRunsTable)
      .leftJoin(merchantsTable, eq(reconciliationRunsTable.merchantId, merchantsTable.id))
      .leftJoin(usersTable, eq(reconciliationRunsTable.createdBy, usersTable.id))
      .where(where)
      .orderBy(sql`${reconciliationRunsTable.createdAt} DESC`)
      .limit(limitNum)
      .offset(offset);

    const runIds = rows.map(r => r.run.id);
    let lastEmailByRun: Map<number, { sentAt: Date; status: string; recipients: string }> = new Map();

    if (runIds.length > 0) {
      const emailLogs = await db
        .select()
        .from(reconciliationEmailLogsTable)
        .where(inArray(reconciliationEmailLogsTable.runId, runIds))
        .orderBy(desc(reconciliationEmailLogsTable.sentAt));

      for (const log of emailLogs) {
        if (!lastEmailByRun.has(log.runId)) {
          lastEmailByRun.set(log.runId, {
            sentAt: log.sentAt,
            status: log.status,
            recipients: log.recipients,
          });
        }
      }
    }

    res.json({
      data: rows.map(r => ({
        ...mapRun(r.run),
        merchantName: r.merchantName ?? null,
        createdByEmail: r.createdByEmail ?? null,
        lastEmail: lastEmailByRun.get(r.run.id) ?? null,
      })),
      total,
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reconciliation/runs/:id/items
router.get("/runs/:id/items", async (req, res, next) => {
  try {
    const runId = parseInt(req.params['id'] as string);
    const { page = "1", limit = "50", status, merchantId } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const [run] = await db.select().from(reconciliationRunsTable).where(eq(reconciliationRunsTable.id, runId)).limit(1);
    if (!run) { res.status(404).json({ error: "Run not found" }); return; }

    const conditions = [eq(reconciliationItemsTable.runId, runId)];
    if (status && status !== "all") conditions.push(eq(reconciliationItemsTable.status, status));
    if (merchantId) conditions.push(eq(reconciliationItemsTable.merchantId, parseInt(merchantId)));

    const where = and(...conditions);

    const [{ total }] = await db.select({ total: count() }).from(reconciliationItemsTable).where(where);

    const items = await db
      .select({
        item: reconciliationItemsTable,
        txUtr: transactionsTable.utr,
        txAmount: transactionsTable.amount,
        txCreatedAt: transactionsTable.createdAt,
        merchantName: merchantsTable.businessName,
      })
      .from(reconciliationItemsTable)
      .leftJoin(transactionsTable, eq(reconciliationItemsTable.transactionId, transactionsTable.id))
      .leftJoin(merchantsTable, eq(reconciliationItemsTable.merchantId, merchantsTable.id))
      .where(where)
      .orderBy(sql`${reconciliationItemsTable.status} ASC, ${reconciliationItemsTable.id} ASC`)
      .limit(limitNum)
      .offset(offset);

    const settlementIds = items
      .map(i => i.item.settlementId)
      .filter((id): id is number => id !== null);

    const settlements = settlementIds.length > 0
      ? await db.select({ id: settlementsTable.id, referenceNumber: settlementsTable.referenceNumber, amount: settlementsTable.requestedAmount, status: settlementsTable.status })
          .from(settlementsTable)
          .where(inArray(settlementsTable.id, settlementIds))
      : [];

    const settlementMap = new Map(settlements.map(s => [s.id, s]));

    res.json({
      run: mapRun(run),
      data: items.map(({ item, txUtr, txAmount, txCreatedAt, merchantName }) => ({
        ...item,
        amount: Number(item.amount),
        merchantName: merchantName ?? null,
        transaction: item.transactionId ? { id: item.transactionId, utr: txUtr, amount: Number(txAmount), createdAt: txCreatedAt } : null,
        settlement: item.settlementId ? (settlementMap.get(item.settlementId) ?? null) : null,
      })),
      total,
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/reconciliation/items/:id/resolve
router.patch("/items/:id/resolve", async (req, res, next) => {
  try {
    const itemId = parseInt(req.params['id'] as string);
    const user = (req as any).user;
    const { resolutionType, linkedTransactionId, linkedSettlementId, resolutionNotes } = req.body;

    if (!resolutionType || !["linked_transaction", "linked_settlement", "excluded"].includes(resolutionType)) {
      res.status(400).json({ error: "resolutionType must be linked_transaction, linked_settlement, or excluded" });
      return;
    }

    if (resolutionType === "linked_transaction" && !linkedTransactionId) {
      res.status(400).json({ error: "linkedTransactionId is required for linked_transaction resolution" });
      return;
    }

    if (resolutionType === "linked_settlement" && !linkedSettlementId) {
      res.status(400).json({ error: "linkedSettlementId is required for linked_settlement resolution" });
      return;
    }

    const [item] = await db.select().from(reconciliationItemsTable).where(eq(reconciliationItemsTable.id, itemId)).limit(1);
    if (!item) { res.status(404).json({ error: "Item not found" }); return; }

    if (item.status === "matched") {
      res.status(400).json({ error: "Cannot resolve an already matched item" });
      return;
    }

    const updateValues: Partial<typeof reconciliationItemsTable.$inferInsert> = {
      status: "resolved",
      resolvedAt: new Date(),
      resolvedBy: user.id,
      resolvedByEmail: user.email,
      resolutionType,
      resolutionNotes: resolutionNotes ?? null,
    };

    if (resolutionType === "linked_transaction" && linkedTransactionId) {
      updateValues.transactionId = parseInt(linkedTransactionId);
    }
    if (resolutionType === "linked_settlement" && linkedSettlementId) {
      updateValues.settlementId = parseInt(linkedSettlementId);
    }

    const [updated] = await db
      .update(reconciliationItemsTable)
      .set(updateValues)
      .where(eq(reconciliationItemsTable.id, itemId))
      .returning();

    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "reconciliation_item_resolved",
      targetType: "reconciliation_item",
      targetId: itemId,
      details: JSON.stringify({
        runId: item.runId,
        resolutionType,
        linkedTransactionId: linkedTransactionId ?? null,
        linkedSettlementId: linkedSettlementId ?? null,
        resolutionNotes: resolutionNotes ?? null,
        previousStatus: item.status,
      }),
      ipAddress: (req as any).ip ?? null,
    });

    res.json({ ...updated, amount: Number(updated.amount) });
  } catch (err) {
    next(err);
  }
});

// POST /api/reconciliation/runs/:id/email-logs/resend
router.post("/runs/:id/email-logs/resend", async (req, res, next) => {
  try {
    const runId = parseInt(req.params['id'] as string);
    const user = (req as any).user;

    const [run] = await db.select().from(reconciliationRunsTable).where(eq(reconciliationRunsTable.id, runId)).limit(1);
    if (!run) { res.status(404).json({ error: "Run not found" }); return; }

    await sendReconciliationReportEmail(runId);

    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "reconciliation_report_email_resent",
      targetType: "reconciliation_run",
      targetId: runId,
      details: JSON.stringify({ runId }),
      ipAddress: (req as any).ip ?? null,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/reconciliation/runs/:id/email-logs/resend-alert
router.post("/runs/:id/email-logs/resend-alert", async (req, res, next) => {
  try {
    const runId = parseInt(req.params['id'] as string);
    const user = (req as any).user;

    const [run] = await db.select().from(reconciliationRunsTable).where(eq(reconciliationRunsTable.id, runId)).limit(1);
    if (!run) { res.status(404).json({ error: "Run not found" }); return; }

    const result = await notifyAdminsOfUnmatchedItems(runId);

    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "reconciliation_alert_email_resent",
      targetType: "reconciliation_run",
      targetId: runId,
      details: JSON.stringify({ runId, skipped: result.skipped, ...(result.skipped ? { reason: result.reason } : {}) }),
      ipAddress: (req as any).ip ?? null,
    });

    if (result.skipped) {
      res.json({ ok: true, skipped: true, reason: result.reason });
      return;
    }

    res.json({ ok: true, skipped: false });
  } catch (err) {
    next(err);
  }
});

// GET /api/reconciliation/runs/:id/email-logs
router.get("/runs/:id/email-logs", async (req, res, next) => {
  try {
    const runId = parseInt(req.params['id'] as string);

    const [run] = await db.select().from(reconciliationRunsTable).where(eq(reconciliationRunsTable.id, runId)).limit(1);
    if (!run) { res.status(404).json({ error: "Run not found" }); return; }

    const logs = await db
      .select()
      .from(reconciliationEmailLogsTable)
      .where(eq(reconciliationEmailLogsTable.runId, runId))
      .orderBy(desc(reconciliationEmailLogsTable.sentAt));

    res.json({ data: logs });
  } catch (err) {
    next(err);
  }
});

// GET /api/reconciliation/runs/:id/export.csv
// Streams the CSV in 500-row cursor-based batches so large runs never exhaust memory.
router.get("/runs/:id/export.csv", async (req, res, next) => {
  const BATCH_SIZE = 500;

  function escapeCsv(val: string | number | null | undefined): string {
    if (val === null || val === undefined) return "";
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  try {
    const runId = parseInt(req.params['id'] as string);
    const { status } = req.query as Record<string, string>;

    const [run] = await db.select().from(reconciliationRunsTable).where(eq(reconciliationRunsTable.id, runId)).limit(1);
    if (!run) { res.status(404).json({ error: "Run not found" }); return; }

    const filename = `reconciliation-run-${runId}${status && status !== "all" ? `-${status}` : ""}.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Transfer-Encoding", "chunked");

    const headers = ["Item ID", "Merchant", "Status", "Amount", "Transaction UTR", "Settlement Ref", "Matched At"];
    res.write(headers.join(",") + "\n");

    let cursor = 0;

    while (true) {
      const baseConditions = [
        eq(reconciliationItemsTable.runId, runId),
        gt(reconciliationItemsTable.id, cursor),
      ];

      if (status && status !== "all") {
        if (status === "unmatched") {
          baseConditions.push(
            or(
              eq(reconciliationItemsTable.status, "unmatched_deposit"),
              eq(reconciliationItemsTable.status, "unmatched_settlement"),
            )!
          );
        } else {
          baseConditions.push(eq(reconciliationItemsTable.status, status));
        }
      }

      const batch = await db
        .select({
          item: reconciliationItemsTable,
          txUtr: transactionsTable.utr,
          merchantName: merchantsTable.businessName,
        })
        .from(reconciliationItemsTable)
        .leftJoin(transactionsTable, eq(reconciliationItemsTable.transactionId, transactionsTable.id))
        .leftJoin(merchantsTable, eq(reconciliationItemsTable.merchantId, merchantsTable.id))
        .where(and(...baseConditions))
        .orderBy(reconciliationItemsTable.id)
        .limit(BATCH_SIZE);

      if (batch.length === 0) break;

      const settlementIds = batch
        .map(r => r.item.settlementId)
        .filter((id): id is number => id !== null);

      const settlements = settlementIds.length > 0
        ? await db
            .select({ id: settlementsTable.id, referenceNumber: settlementsTable.referenceNumber, status: settlementsTable.status })
            .from(settlementsTable)
            .where(inArray(settlementsTable.id, settlementIds))
        : [];

      const settlementMap = new Map(settlements.map(s => [s.id, s]));

      const lines = batch.map(({ item, txUtr, merchantName }) => {
        const settlement = item.settlementId ? (settlementMap.get(item.settlementId) ?? null) : null;
        return [
          escapeCsv(item.id),
          escapeCsv(merchantName ?? `Merchant #${item.merchantId}`),
          escapeCsv(item.status),
          escapeCsv(Number(item.amount).toFixed(2)),
          escapeCsv(txUtr ?? ""),
          escapeCsv(settlement?.referenceNumber ?? (settlement ? `#${settlement.id}` : "")),
          escapeCsv(item.matchedAt ? new Date(item.matchedAt).toISOString() : ""),
        ].join(",");
      });

      res.write(lines.join("\n") + "\n");

      cursor = batch[batch.length - 1]!.item.id;

      if (batch.length < BATCH_SIZE) break;
    }

    // Trailing email-log section — blank row + section header + one row per email send
    const emailLogs = await db
      .select()
      .from(reconciliationEmailLogsTable)
      .where(eq(reconciliationEmailLogsTable.runId, runId))
      .orderBy(reconciliationEmailLogsTable.sentAt);

    res.write("\n");
    const emailHeaders = ["Email Type", "Recipients", "Status", "Sent At", "Error"];
    res.write(emailHeaders.join(",") + "\n");

    for (const log of emailLogs) {
      const row = [
        escapeCsv(log.emailType),
        escapeCsv(log.recipients),
        escapeCsv(log.status),
        escapeCsv(new Date(log.sentAt).toISOString()),
        escapeCsv(log.errorMessage ?? ""),
      ].join(",");
      res.write(row + "\n");
    }

    res.end();
  } catch (err) {
    if (res.headersSent) {
      res.end();
    } else {
      next(err);
    }
  }
});

export default router;
