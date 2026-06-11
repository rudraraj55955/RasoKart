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

function anonymiseEmail(email: string): string {
  const atIdx = email.indexOf("@");
  if (atIdx < 0) return "****";
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx);
  const visible = local.length > 0 ? local[0] : "";
  return `${visible}${"*".repeat(Math.max(3, local.length - 1))}${domain}`;
}

router.get("/my-activity", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "merchant") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (!user.merchantId) {
    res.json({ data: [], total: 0, page: 1, limit: 20 });
    return;
  }

  const { page = "1", limit = "20", action, dateFrom, dateTo, since } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions: any[] = [eq(auditLogsTable.targetId, user.merchantId)];
  if (action && action !== "all") conditions.push(eq(auditLogsTable.action, action));
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
  if (since) {
    const sinceDate = new Date(since);
    if (!isNaN(sinceDate.getTime())) {
      conditions.push(gte(auditLogsTable.createdAt, sinceDate));
    }
  }
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);

  const [{ total }] = await db.select({ total: count() }).from(auditLogsTable).where(where);

  const rows = await db
    .select()
    .from(auditLogsTable)
    .where(where)
    .limit(limitNum)
    .offset(offset)
    .orderBy(desc(auditLogsTable.createdAt));

  res.json({
    data: rows.map(r => ({
      id: r.id,
      action: r.action,
      adminEmail: anonymiseEmail(r.adminEmail),
      targetType: r.targetType,
      details: r.details,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    page: pageNum,
    limit: limitNum,
  });
});

router.get("/my-activity/export", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "merchant") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (!user.merchantId) {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="security-activity-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send("ID,Action,Admin,Target Type,Timestamp\n");
    return;
  }

  const { action, dateFrom, dateTo } = req.query as Record<string, string>;

  const conditions: any[] = [eq(auditLogsTable.targetId, user.merchantId)];
  if (action && action !== "all") conditions.push(eq(auditLogsTable.action, action));
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
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);

  const rows = await db
    .select()
    .from(auditLogsTable)
    .where(where)
    .orderBy(desc(auditLogsTable.createdAt));

  function escapeCsv(val: string | null | undefined): string {
    if (val == null) return "";
    const s = String(val);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  const header = ["ID", "Action", "Admin", "Target Type", "Timestamp"];
  const csvRows = rows.map(r => [
    escapeCsv(String(r.id)),
    escapeCsv(r.action),
    escapeCsv(anonymiseEmail(r.adminEmail)),
    escapeCsv(r.targetType),
    escapeCsv(r.createdAt.toISOString()),
  ].join(","));

  const csv = [header.join(","), ...csvRows].join("\n");

  const filename = `security-activity-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
});

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

  const { page = "1", limit = "20", action, targetType, search, dateFrom, dateTo, merchantId, detailsSuccess } = req.query as Record<string, string>;
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
  if (detailsSuccess === "true") {
    conditions.push(sql`${auditLogsTable.details}::jsonb->>'success' = 'true'`);
  } else if (detailsSuccess === "false") {
    conditions.push(sql`${auditLogsTable.details}::jsonb->>'success' = 'false'`);
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

router.delete("/test-email-history", async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const deleted = await db
    .delete(auditLogsTable)
    .where(eq(auditLogsTable.action, "test_email_sent"))
    .returning({ id: auditLogsTable.id });
  res.json({ deleted: deleted.length });
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
    failureAcknowledgedAt: s.failureAcknowledgedAt ? s.failureAcknowledgedAt.toISOString() : null,
    autoPausedAt: s.autoPausedAt ? s.autoPausedAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function deriveLastSendStatus(
  lastSuccess: boolean | null,
  lastLogSentAt: Date | null,
  failureAcknowledgedAt: Date | null,
): "ok" | "failed" | "none" {
  if (lastSuccess === null) return "none";
  if (lastSuccess) return "ok";
  // Last send failed — check if it was acknowledged after the failure
  if (failureAcknowledgedAt && lastLogSentAt && failureAcknowledgedAt >= lastLogSentAt) return "ok";
  return "failed";
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
      lastLogSentAt: sql<Date | null>`(
        SELECT sent_at FROM ${scheduledAuditReportLogsTable}
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
      sendCount: sql<number>`(
        SELECT COUNT(*) FROM ${scheduledAuditReportLogsTable}
        WHERE schedule_id = ${scheduledAuditReportsTable.id}
      )`,
    })
    .from(scheduledAuditReportsTable)
    .orderBy(scheduledAuditReportsTable.createdAt);

  res.json({
    data: rows.map(r => ({
      ...serializeSchedule(r),
      lastSendStatus: deriveLastSendStatus(
        r.lastSuccess,
        r.lastLogSentAt ? new Date(r.lastLogSentAt) : null,
        r.failureAcknowledgedAt,
      ),
      lastErrorMessage: r.lastErrorMessage ?? null,
      sendCount: Number(r.sendCount),
    })),
  });
});

router.get("/schedules/logs", async (req, res) => {
  if (!ensureAdmin(req, res)) return;

  const q = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(q['page'] ?? "1") || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(q['limit'] ?? "20") || 20));
  const offset = (pageNum - 1) * limitNum;
  const { scheduleId, status, triggerType, dateFrom, dateTo } = q;

  const scheduleIdNum = scheduleId ? parseInt(scheduleId) : null;

  const baseConditions: any[] = [];
  if (scheduleIdNum != null && !isNaN(scheduleIdNum)) {
    baseConditions.push(eq(scheduledAuditReportLogsTable.scheduleId, scheduleIdNum));
  }
  if (dateFrom) {
    const from = new Date(dateFrom);
    from.setUTCHours(0, 0, 0, 0);
    if (!isNaN(from.getTime())) baseConditions.push(gte(scheduledAuditReportLogsTable.sentAt, from));
  }
  if (dateTo) {
    const to = new Date(dateTo);
    to.setUTCHours(23, 59, 59, 999);
    if (!isNaN(to.getTime())) baseConditions.push(lte(scheduledAuditReportLogsTable.sentAt, to));
  }

  const baseWhere = baseConditions.length > 0 ? and(...baseConditions) : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(scheduledAuditReportLogsTable)
    .where(baseWhere);

  const [{ failureCount }] = await db
    .select({ failureCount: count() })
    .from(scheduledAuditReportLogsTable)
    .where(baseConditions.length > 0
      ? and(...baseConditions, eq(scheduledAuditReportLogsTable.success, false))
      : eq(scheduledAuditReportLogsTable.success, false));

  const dataConditions: any[] = [...baseConditions];
  if (status === "success") dataConditions.push(eq(scheduledAuditReportLogsTable.success, true));
  else if (status === "failed") dataConditions.push(eq(scheduledAuditReportLogsTable.success, false));
  if (triggerType === "manual") dataConditions.push(eq(scheduledAuditReportLogsTable.triggerType, "manual"));
  else if (triggerType === "scheduled") dataConditions.push(eq(scheduledAuditReportLogsTable.triggerType, "scheduled"));
  const dataWhere = dataConditions.length > 0 ? and(...dataConditions) : undefined;

  const [{ filteredTotal }] = await db
    .select({ filteredTotal: count() })
    .from(scheduledAuditReportLogsTable)
    .where(dataWhere);

  const logs = await db
    .select({
      id: scheduledAuditReportLogsTable.id,
      scheduleId: scheduledAuditReportLogsTable.scheduleId,
      sentAt: scheduledAuditReportLogsTable.sentAt,
      rowCount: scheduledAuditReportLogsTable.rowCount,
      success: scheduledAuditReportLogsTable.success,
      errorMessage: scheduledAuditReportLogsTable.errorMessage,
      isRetry: scheduledAuditReportLogsTable.isRetry,
      triggerType: scheduledAuditReportLogsTable.triggerType,
      scheduleFrequency: scheduledAuditReportsTable.frequency,
      scheduleRecipient: scheduledAuditReportsTable.recipientEmail,
    })
    .from(scheduledAuditReportLogsTable)
    .innerJoin(scheduledAuditReportsTable, eq(scheduledAuditReportLogsTable.scheduleId, scheduledAuditReportsTable.id))
    .where(dataWhere)
    .orderBy(desc(scheduledAuditReportLogsTable.sentAt))
    .limit(limitNum)
    .offset(offset);

  res.json({
    data: logs.map(l => ({ ...l, sentAt: l.sentAt.toISOString() })),
    total,
    failureCount,
    filteredTotal,
    page: pageNum,
  });
});

router.get("/schedules/:id/logs", async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const id = parseInt(req.params['id'] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const q = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(q['page'] ?? "1") || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(q['limit'] ?? "20") || 20));
  const offset = (pageNum - 1) * limitNum;
  const { status, triggerType, dateFrom, dateTo } = q;

  const [schedule] = await db
    .select({ id: scheduledAuditReportsTable.id })
    .from(scheduledAuditReportsTable)
    .where(eq(scheduledAuditReportsTable.id, id));

  if (!schedule) { res.status(404).json({ error: "Schedule not found" }); return; }

  // Date-range conditions (applied to both summary counts and data rows)
  const dateConditions: any[] = [eq(scheduledAuditReportLogsTable.scheduleId, id)];
  if (dateFrom) {
    const from = new Date(dateFrom);
    from.setUTCHours(0, 0, 0, 0);
    if (!isNaN(from.getTime())) dateConditions.push(gte(scheduledAuditReportLogsTable.sentAt, from));
  }
  if (dateTo) {
    const to = new Date(dateTo);
    to.setUTCHours(23, 59, 59, 999);
    if (!isNaN(to.getTime())) dateConditions.push(lte(scheduledAuditReportLogsTable.sentAt, to));
  }
  const dateWhere = and(...dateConditions);

  // Summary counts: always over the date window only (ignoring status filter)
  // so the banner "X of Y sends failed" always reflects the full picture for the period.
  const [{ total }] = await db
    .select({ total: count() })
    .from(scheduledAuditReportLogsTable)
    .where(dateWhere);

  const [{ failureCount }] = await db
    .select({ failureCount: count() })
    .from(scheduledAuditReportLogsTable)
    .where(and(...dateConditions, eq(scheduledAuditReportLogsTable.success, false)));

  // Data rows: apply status and triggerType filters on top of date conditions
  const dataConditions: any[] = [...dateConditions];
  if (status === "success") dataConditions.push(eq(scheduledAuditReportLogsTable.success, true));
  else if (status === "failed") dataConditions.push(eq(scheduledAuditReportLogsTable.success, false));
  if (triggerType === "manual") dataConditions.push(eq(scheduledAuditReportLogsTable.triggerType, "manual"));
  else if (triggerType === "scheduled") dataConditions.push(eq(scheduledAuditReportLogsTable.triggerType, "scheduled"));
  const dataWhere = and(...dataConditions);

  const [{ filteredTotal }] = await db
    .select({ filteredTotal: count() })
    .from(scheduledAuditReportLogsTable)
    .where(dataWhere);

  const logs = await db
    .select()
    .from(scheduledAuditReportLogsTable)
    .where(dataWhere)
    .orderBy(desc(scheduledAuditReportLogsTable.sentAt))
    .limit(limitNum)
    .offset(offset);

  res.json({
    data: logs.map(l => ({
      ...l,
      sentAt: l.sentAt.toISOString(),
    })),
    total,
    failureCount,
    filteredTotal,
    page: pageNum,
  });
});

router.post("/schedules", async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { frequency, recipientEmail, maxRetryAttempts } = req.body;

  if (!frequency || !["daily", "weekly", "monthly"].includes(frequency)) {
    res.status(400).json({ error: "frequency must be daily, weekly, or monthly" });
    return;
  }
  if (!recipientEmail || typeof recipientEmail !== "string") {
    res.status(400).json({ error: "recipientEmail is required" });
    return;
  }
  const parsedMaxRetry = maxRetryAttempts !== undefined ? parseInt(String(maxRetryAttempts)) : 3;
  if (isNaN(parsedMaxRetry) || parsedMaxRetry < 0 || parsedMaxRetry > 10) {
    res.status(400).json({ error: "maxRetryAttempts must be an integer between 0 and 10" });
    return;
  }
  const { retryBackoffMinutes, autoPauseAfterFailures } = req.body;
  const parsedBackoff = retryBackoffMinutes !== undefined ? parseInt(String(retryBackoffMinutes)) : 60;
  if (isNaN(parsedBackoff) || parsedBackoff < 1 || parsedBackoff > 1440) {
    res.status(400).json({ error: "retryBackoffMinutes must be an integer between 1 and 1440" });
    return;
  }
  const parsedAutoPause = autoPauseAfterFailures !== undefined ? parseInt(String(autoPauseAfterFailures)) : 3;
  if (isNaN(parsedAutoPause) || parsedAutoPause < 0 || parsedAutoPause > 100) {
    res.status(400).json({ error: "autoPauseAfterFailures must be an integer between 0 and 100" });
    return;
  }

  const [schedule] = await db.insert(scheduledAuditReportsTable).values({
    frequency,
    recipientEmail: recipientEmail.trim(),
    isActive: true,
    maxRetryAttempts: parsedMaxRetry,
    retryBackoffMinutes: parsedBackoff,
    autoPauseAfterFailures: parsedAutoPause,
  }).returning();

  res.status(201).json({ ...serializeSchedule(schedule), sendCount: 0 });
});

router.patch("/schedules/bulk-toggle", async (req, res) => {
  if (!ensureAdmin(req, res)) return;

  const { isActive, ids } = req.body;
  if (typeof isActive !== "boolean") {
    res.status(400).json({ error: "isActive must be a boolean" });
    return;
  }

  // Optional: restrict update to a specific subset of schedule IDs
  let whereClause: ReturnType<typeof eq> | undefined;
  if (ids !== undefined) {
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "ids must be a non-empty array of integers when provided" });
      return;
    }
    const parsedIds: number[] = [];
    for (const raw of ids) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        res.status(400).json({ error: `ids contains an invalid value: ${raw}` });
        return;
      }
      parsedIds.push(n);
    }
    whereClause = sql`${scheduledAuditReportsTable.id} IN (${sql.join(parsedIds.map((id: number) => sql`${id}`), sql`, `)})` as any;
  }

  const updated = whereClause
    ? await db.update(scheduledAuditReportsTable).set({ isActive, updatedAt: new Date() }).where(whereClause).returning()
    : await db.update(scheduledAuditReportsTable).set({ isActive, updatedAt: new Date() }).returning();

  const scheduleColumns = getTableColumns(scheduledAuditReportsTable);
  const rows = await db
    .select({
      ...scheduleColumns,
      lastSuccess: sql<boolean | null>`(
        SELECT success FROM ${scheduledAuditReportLogsTable}
        WHERE schedule_id = ${scheduledAuditReportsTable.id}
        ORDER BY sent_at DESC LIMIT 1
      )`,
    })
    .from(scheduledAuditReportsTable)
    .where(
      updated.length > 0
        ? sql`${scheduledAuditReportsTable.id} IN (${sql.join(updated.map(u => sql`${u.id}`), sql`, `)})`
        : sql`FALSE`
    );

  res.json({
    data: rows.map(r => ({
      ...serializeSchedule(r),
      lastSendStatus: deriveLastSendStatus(
        r.lastSuccess,
        null,
        r.failureAcknowledgedAt,
      ),
      sendCount: 0,
    })),
  });
});

router.patch("/schedules/:id", async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const id = parseInt(req.params['id'] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { frequency, recipientEmail, isActive, maxRetryAttempts, acknowledgeFailure } = req.body;
  const updates: Partial<{
    frequency: string;
    recipientEmail: string;
    isActive: boolean;
    maxRetryAttempts: number;
    retryBackoffMinutes: number;
    autoPauseAfterFailures: number;
    failureAcknowledgedAt: Date | null;
    failureAcknowledgedByEmail: string | null;
    updatedAt: Date;
  }> = {
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
  if (maxRetryAttempts !== undefined) {
    const parsed = parseInt(String(maxRetryAttempts));
    if (isNaN(parsed) || parsed < 0 || parsed > 10) {
      res.status(400).json({ error: "maxRetryAttempts must be an integer between 0 and 10" });
      return;
    }
    updates.maxRetryAttempts = parsed;
  }
  const { retryBackoffMinutes, autoPauseAfterFailures } = req.body;
  if (retryBackoffMinutes !== undefined) {
    const parsed = parseInt(String(retryBackoffMinutes));
    if (isNaN(parsed) || parsed < 1 || parsed > 1440) {
      res.status(400).json({ error: "retryBackoffMinutes must be an integer between 1 and 1440" });
      return;
    }
    updates.retryBackoffMinutes = parsed;
  }
  if (autoPauseAfterFailures !== undefined) {
    const parsed = parseInt(String(autoPauseAfterFailures));
    if (isNaN(parsed) || parsed < 0 || parsed > 100) {
      res.status(400).json({ error: "autoPauseAfterFailures must be an integer between 0 and 100" });
      return;
    }
    updates.autoPauseAfterFailures = parsed;
  }
  if (acknowledgeFailure === true) {
    updates.failureAcknowledgedAt = new Date();
    updates.failureAcknowledgedByEmail = (req as any).user.email;
  }

  const [updated] = await db
    .update(scheduledAuditReportsTable)
    .set(updates)
    .where(eq(scheduledAuditReportsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Schedule not found" }); return; }

  const [{ sendCount }] = await db
    .select({ sendCount: sql<number>`COUNT(*)` })
    .from(scheduledAuditReportLogsTable)
    .where(eq(scheduledAuditReportLogsTable.scheduleId, id));

  const [lastLog] = await db
    .select({ success: scheduledAuditReportLogsTable.success, sentAt: scheduledAuditReportLogsTable.sentAt })
    .from(scheduledAuditReportLogsTable)
    .where(eq(scheduledAuditReportLogsTable.scheduleId, id))
    .orderBy(desc(scheduledAuditReportLogsTable.sentAt))
    .limit(1);

  res.json({
    ...serializeSchedule(updated),
    lastSendStatus: deriveLastSendStatus(
      lastLog?.success ?? null,
      lastLog?.sentAt ?? null,
      updated.failureAcknowledgedAt,
    ),
    sendCount: Number(sendCount),
  });
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

  const sent = await sendScheduledReport(schedule, 0, "manual");
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
