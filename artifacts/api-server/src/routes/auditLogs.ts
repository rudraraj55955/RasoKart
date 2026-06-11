import { Router } from "express";
import { db, auditLogsTable, scheduledAuditReportsTable, scheduledAuditReportLogsTable } from "@workspace/db";
import { eq, ilike, and, count, sql, or, gte, lte, desc, getTableColumns } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { sendScheduledReport, buildEmailHtml, getDateRange } from "../helpers/auditReportScheduler";

const router = Router();
router.use(requireAuth);

function ensureAdmin(req: any, res: any): boolean {
  if ((req as any).user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

router.get("/stats", async (req, res) => {
  if (!ensureAdmin(req, res)) return;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [{ total }] = await db
    .select({ total: count() })
    .from(auditLogsTable)
    .where(
      and(
        eq(auditLogsTable.action, "csv_export"),
        gte(auditLogsTable.createdAt, thirtyDaysAgo),
      ),
    );

  res.json({ csvExportsLast30Days: total });
});

router.get("/", async (req, res) => {
  if (!ensureAdmin(req, res)) return;

  const { page = "1", limit = "20", action, targetType, search, dateFrom, dateTo, merchantId } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions: any[] = [];
  if (action && action !== "all") conditions.push(eq(auditLogsTable.action, action));
  if (targetType && targetType !== "all") conditions.push(eq(auditLogsTable.targetType, targetType));
  if (search) {
    conditions.push(
      or(
        ilike(auditLogsTable.adminEmail, `%${search}%`),
        ilike(auditLogsTable.action, `%${search}%`),
        ilike(auditLogsTable.targetType, `%${search}%`),
      )!
    );
  }
  if (dateFrom) {
    const from = new Date(dateFrom);
    from.setUTCHours(0, 0, 0, 0);
    if (!isNaN(from.getTime())) conditions.push(gte(auditLogsTable.createdAt, from));
  }
  if (dateTo) {
    const to = new Date(dateTo);
    to.setUTCHours(23, 59, 59, 999);
    if (!isNaN(to.getTime())) conditions.push(lte(auditLogsTable.createdAt, to));
  }
  if (merchantId) {
    const merchantIdNum = parseInt(merchantId);
    if (!isNaN(merchantIdNum)) {
      conditions.push(
        or(
          eq(auditLogsTable.targetId, merchantIdNum),
          sql`${auditLogsTable.details}::jsonb -> 'merchantIds' @> ${JSON.stringify([merchantIdNum])}::jsonb`,
        )!
      );
    }
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(auditLogsTable).where(where);

  const rows = await db
    .select()
    .from(auditLogsTable)
    .where(where)
    .limit(limitNum)
    .offset(offset)
    .orderBy(sql`${auditLogsTable.createdAt} DESC`);

  res.json({
    data: rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })),
    total,
    page: pageNum,
    limit: limitNum,
  });
});

router.get("/export", async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const user = (req as any).user;

  const { action, targetType, search, dateFrom, dateTo } = req.query as Record<string, string>;

  const conditions: any[] = [];
  if (action && action !== "all") conditions.push(eq(auditLogsTable.action, action));
  if (targetType && targetType !== "all") conditions.push(eq(auditLogsTable.targetType, targetType));
  if (search) {
    conditions.push(
      or(
        ilike(auditLogsTable.adminEmail, `%${search}%`),
        ilike(auditLogsTable.action, `%${search}%`),
        ilike(auditLogsTable.targetType, `%${search}%`),
      )!
    );
  }
  if (dateFrom) {
    const from = new Date(dateFrom);
    from.setUTCHours(0, 0, 0, 0);
    if (!isNaN(from.getTime())) conditions.push(gte(auditLogsTable.createdAt, from));
  }
  if (dateTo) {
    const to = new Date(dateTo);
    to.setUTCHours(23, 59, 59, 999);
    if (!isNaN(to.getTime())) conditions.push(lte(auditLogsTable.createdAt, to));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(auditLogsTable)
    .where(where)
    .orderBy(sql`${auditLogsTable.createdAt} DESC`);

  function escapeCsv(val: string | null | undefined): string {
    if (val == null) return "";
    const s = String(val);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  const header = ["ID", "Admin Email", "Admin ID", "Action", "Target Type", "Target ID", "IP Address", "Timestamp"];
  const csvRows = rows.map(r => [
    escapeCsv(String(r.id)),
    escapeCsv(r.adminEmail),
    escapeCsv(String(r.adminId)),
    escapeCsv(r.action),
    escapeCsv(r.targetType),
    escapeCsv(r.targetId != null ? String(r.targetId) : null),
    escapeCsv(r.ipAddress),
    escapeCsv(r.createdAt.toISOString()),
  ].join(","));

  const csv = [header.join(","), ...csvRows].join("\n");

  await db.insert(auditLogsTable).values({
    adminId: user.id,
    adminEmail: user.email,
    action: "csv_export",
    targetType: "audit_logs",
    targetId: null,
    details: JSON.stringify({
      rowCount: rows.length,
      filters: { action: action ?? null, targetType: targetType ?? null, search: search ?? null, dateFrom: dateFrom ?? null, dateTo: dateTo ?? null },
    }),
    ipAddress: req.ip ?? null,
  });

  const filename = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
});

router.post("/", async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const user = (req as any).user;
  const { action, targetType, targetId, details } = req.body;

  if (!action || !targetType) {
    res.status(400).json({ error: "action and targetType are required" });
    return;
  }

  const [log] = await db.insert(auditLogsTable).values({
    adminId: user.id,
    adminEmail: user.email,
    action,
    targetType,
    targetId: targetId ?? null,
    details: details ?? null,
    ipAddress: req.ip ?? null,
  }).returning();

  res.status(201).json({ ...log, createdAt: log.createdAt.toISOString() });
});

function serializeSchedule(s: typeof scheduledAuditReportsTable.$inferSelect) {
  return {
    ...s,
    lastSentAt: s.lastSentAt ? s.lastSentAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function deriveLastSendStatus(lastSuccess: boolean | null): "ok" | "failed" | "none" {
  if (lastSuccess === null) return "none";
  return lastSuccess ? "ok" : "failed";
}

router.get("/schedules/preview", async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { frequency } = req.query as Record<string, string>;

  if (!frequency || !["daily", "weekly", "monthly"].includes(frequency)) {
    res.status(400).json({ error: "frequency must be daily, weekly, or monthly" });
    return;
  }

  const { dateFrom, dateTo } = getDateRange(frequency);
  const html = buildEmailHtml(frequency, dateFrom, dateTo, 0);
  res.json({ html });
});

router.get("/schedules", async (req, res) => {
  if (!ensureAdmin(req, res)) return;

  const scheduleColumns = getTableColumns(scheduledAuditReportsTable);
  const rows = await db
    .select({
      ...scheduleColumns,
      lastSuccess: sql<boolean | null>`(
        SELECT success FROM ${scheduledAuditReportLogsTable}
        WHERE schedule_id = ${scheduledAuditReportsTable.id}
        ORDER BY sent_at DESC
        LIMIT 1
      )`,
      lastErrorMessage: sql<string | null>`(
        SELECT error_message FROM ${scheduledAuditReportLogsTable}
        WHERE schedule_id = ${scheduledAuditReportsTable.id}
        ORDER BY sent_at DESC
        LIMIT 1
      )`,
    })
    .from(scheduledAuditReportsTable)
    .orderBy(scheduledAuditReportsTable.createdAt);

  res.json({
    data: rows.map(r => ({
      ...serializeSchedule(r),
      lastSendStatus: deriveLastSendStatus(r.lastSuccess),
      lastErrorMessage: r.lastErrorMessage ?? null,
    })),
  });
});

router.get("/schedules/:id/logs", async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const id = parseInt(req.params['id'] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const limitNum = Math.min(100, Math.max(1, parseInt((req.query as Record<string, string>)['limit'] ?? "20") || 20));

  const [schedule] = await db
    .select({ id: scheduledAuditReportsTable.id })
    .from(scheduledAuditReportsTable)
    .where(eq(scheduledAuditReportsTable.id, id));

  if (!schedule) { res.status(404).json({ error: "Schedule not found" }); return; }

  const logs = await db
    .select()
    .from(scheduledAuditReportLogsTable)
    .where(eq(scheduledAuditReportLogsTable.scheduleId, id))
    .orderBy(desc(scheduledAuditReportLogsTable.sentAt))
    .limit(limitNum);

  res.json({
    data: logs.map(l => ({
      ...l,
      sentAt: l.sentAt.toISOString(),
    })),
  });
});

router.post("/schedules", async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { frequency, recipientEmail } = req.body;

  if (!frequency || !["daily", "weekly", "monthly"].includes(frequency)) {
    res.status(400).json({ error: "frequency must be daily, weekly, or monthly" });
    return;
  }
  if (!recipientEmail || typeof recipientEmail !== "string") {
    res.status(400).json({ error: "recipientEmail is required" });
    return;
  }

  const [schedule] = await db.insert(scheduledAuditReportsTable).values({
    frequency,
    recipientEmail: recipientEmail.trim(),
    isActive: true,
  }).returning();

  res.status(201).json(serializeSchedule(schedule));
});

router.patch("/schedules/:id", async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const id = parseInt(req.params['id'] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { frequency, recipientEmail, isActive } = req.body;
  const updates: Partial<{ frequency: string; recipientEmail: string; isActive: boolean; updatedAt: Date }> = {
    updatedAt: new Date(),
  };

  if (frequency !== undefined) {
    if (!["daily", "weekly", "monthly"].includes(frequency)) {
      res.status(400).json({ error: "frequency must be daily, weekly, or monthly" });
      return;
    }
    updates.frequency = frequency;
  }
  if (recipientEmail !== undefined) updates.recipientEmail = (recipientEmail as string).trim();
  if (isActive !== undefined) updates.isActive = Boolean(isActive);

  const [updated] = await db
    .update(scheduledAuditReportsTable)
    .set(updates)
    .where(eq(scheduledAuditReportsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Schedule not found" }); return; }
  res.json(serializeSchedule(updated));
});

router.delete("/schedules/:id", async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const id = parseInt(req.params['id'] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [deleted] = await db
    .delete(scheduledAuditReportsTable)
    .where(eq(scheduledAuditReportsTable.id, id))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Schedule not found" }); return; }
  res.json({ success: true });
});

router.post("/schedules/:id/send", async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const id = parseInt(req.params['id'] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [schedule] = await db
    .select()
    .from(scheduledAuditReportsTable)
    .where(eq(scheduledAuditReportsTable.id, id));

  if (!schedule) { res.status(404).json({ error: "Schedule not found" }); return; }

  const sent = await sendScheduledReport(schedule);
  if (!sent) {
    res.status(502).json({ error: "Email delivery failed. Check mailer configuration." });
    return;
  }

  const [updated] = await db
    .select()
    .from(scheduledAuditReportsTable)
    .where(eq(scheduledAuditReportsTable.id, id));

  res.json(serializeSchedule(updated!));
});

export default router;
