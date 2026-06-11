import { Router } from "express";
import { db, auditLogsTable, scheduledAuditReportsTable, scheduledAuditReportLogsTable, credentialEventsTable, merchantsTable } from "@workspace/db";
import { eq, ilike, and, count, sql, or, gte, lte, desc, getTableColumns } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { sendScheduledReport, buildEmailHtml, getDateRange, getRetryDelayMs } from "../helpers/auditReportScheduler";

const MAX_RETRY_ATTEMPTS = 3;

const router = Router();
router.use(requireAuth);

function ensureAdmin(req: any, res: any): boolean {
  if ((req as any).user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

router.get("/security-compliance", async (req, res) => {
  if (!ensureAdmin(req, res)) return;

  const { status } = req.query as Record<string, string>;

  const rows = await db
    .select({
      merchantId: merchantsTable.id,
      businessName: merchantsTable.businessName,
      email: merchantsTable.email,
      lastExportedAt: sql<string | null>`(
        SELECT MAX(${auditLogsTable.createdAt})
        FROM ${auditLogsTable}
        WHERE ${auditLogsTable.action} = 'security_activity_exported'
          AND ${auditLogsTable.targetId} = ${merchantsTable.id}
      )`,
    })
    .from(merchantsTable)
    .orderBy(merchantsTable.businessName);

  const mapped = rows.map(r => ({
    merchantId: r.merchantId,
    businessName: r.businessName,
    email: r.email,
    lastExportedAt: r.lastExportedAt ? new Date(r.lastExportedAt).toISOString() : null,
    status: r.lastExportedAt ? "exported" : "never",
  }));

  const filtered =
    status === "exported" ? mapped.filter(r => r.status === "exported") :
    status === "never"    ? mapped.filter(r => r.status === "never") :
    mapped;

  const exportedCount = mapped.filter(r => r.status === "exported").length;
  const neverCount    = mapped.filter(r => r.status === "never").length;

  res.json({
    data: filtered,
    totalMerchants: mapped.length,
    exportedCount,
    neverCount,
  });
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

  const { page = "1", limit = "20", action, targetType, search, dateFrom, dateTo, merchantId, settingKey } = req.query as Record<string, string>;
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
  if (settingKey) {
    if (action === "setting_updated") {
      conditions.push(sql`${auditLogsTable.details}::jsonb->>'key' = ${settingKey}`);
    } else if (action === "system_config_updated") {
      conditions.push(sql`${auditLogsTable.details}::jsonb->>'section' = ${settingKey}`);
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

router.get("/my-activity", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "merchant" || !user.merchantId) {
    res.status(403).json({ error: "Only merchants can access this endpoint" });
    return;
  }

  const { page = "1", limit = "20", dateFrom, dateTo } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions: any[] = [eq(auditLogsTable.targetId, user.merchantId)];
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

  const where = and(...conditions);
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

router.get("/my-activity/export", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "merchant" || !user.merchantId) {
    res.status(403).json({ error: "Only merchants can access this endpoint" });
    return;
  }

  const rows = await db
    .select()
    .from(auditLogsTable)
    .where(eq(auditLogsTable.targetId, user.merchantId))
    .orderBy(sql`${auditLogsTable.createdAt} DESC`);

  function escapeCsv(val: string | null | undefined): string {
    if (val == null) return "";
    const s = String(val);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  const header = ["ID", "Action", "Target Type", "Target ID", "IP Address", "Timestamp"];
  const csvRows = rows.map(r => [
    escapeCsv(String(r.id)),
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
    action: "security_activity_exported",
    targetType: "merchant",
    targetId: user.merchantId,
    details: JSON.stringify({ rowCount: rows.length, merchantId: user.merchantId }),
    ipAddress: req.ip ?? null,
  });

  const filename = `security-activity-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
});

router.get("/credential-events", async (req, res) => {
  if (!ensureAdmin(req, res)) return;

  const { page = "1", limit = "20", dateFrom, dateTo, merchantId, eventType } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions: any[] = [];
  if (eventType && eventType !== "all") conditions.push(eq(credentialEventsTable.eventType, eventType));
  if (dateFrom) {
    const from = new Date(dateFrom);
    from.setUTCHours(0, 0, 0, 0);
    if (!isNaN(from.getTime())) conditions.push(gte(credentialEventsTable.createdAt, from));
  }
  if (dateTo) {
    const to = new Date(dateTo);
    to.setUTCHours(23, 59, 59, 999);
    if (!isNaN(to.getTime())) conditions.push(lte(credentialEventsTable.createdAt, to));
  }
  if (merchantId) {
    const merchantIdNum = parseInt(merchantId);
    if (!isNaN(merchantIdNum)) conditions.push(eq(credentialEventsTable.merchantId, merchantIdNum));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(credentialEventsTable).where(where);

  const rows = await db
    .select({
      id: credentialEventsTable.id,
      merchantId: credentialEventsTable.merchantId,
      eventType: credentialEventsTable.eventType,
      actorId: credentialEventsTable.actorId,
      actorEmail: credentialEventsTable.actorEmail,
      keyPrefix: credentialEventsTable.keyPrefix,
      ipAddress: credentialEventsTable.ipAddress,
      createdAt: credentialEventsTable.createdAt,
      merchantBusinessName: merchantsTable.businessName,
      merchantEmail: merchantsTable.email,
    })
    .from(credentialEventsTable)
    .leftJoin(merchantsTable, eq(credentialEventsTable.merchantId, merchantsTable.id))
    .where(where)
    .limit(limitNum)
    .offset(offset)
    .orderBy(desc(credentialEventsTable.createdAt));

  res.json({
    data: rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })),
    total,
    page: pageNum,
    limit: limitNum,
  });
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
    failureAcknowledgedByEmail: s.failureAcknowledgedByEmail ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    consecutiveFailures: s.consecutiveFailures,
    autoPauseAfterFailures: s.autoPauseAfterFailures,
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
      lastRetryAttempt: sql<number | null>`(
        SELECT retry_attempt FROM ${scheduledAuditReportLogsTable}
        WHERE schedule_id = ${scheduledAuditReportsTable.id}
        ORDER BY sent_at DESC
        LIMIT 1
      )`,
      lastSentAtFromLog: sql<string | null>`(
        SELECT sent_at FROM ${scheduledAuditReportLogsTable}
        WHERE schedule_id = ${scheduledAuditReportsTable.id}
        ORDER BY sent_at DESC
        LIMIT 1
      )`,
      sendCount: sql<number>`(
        SELECT COUNT(*) FROM ${scheduledAuditReportLogsTable}
        WHERE schedule_id = ${scheduledAuditReportsTable.id}
      )`,
      successCount: sql<number>`(
        SELECT COUNT(*) FROM ${scheduledAuditReportLogsTable}
        WHERE schedule_id = ${scheduledAuditReportsTable.id}
        AND success = true
      )`,
    })
    .from(scheduledAuditReportsTable)
    .orderBy(scheduledAuditReportsTable.createdAt);

  res.json({
    data: rows.map(r => {
      const currentRetryAttempt = r.lastRetryAttempt != null ? Number(r.lastRetryAttempt) : 0;
      const nextAttempt = currentRetryAttempt + 1;
      let retryInProgress = false;
      let nextRetryAt: string | null = null;
      if (r.lastSuccess === false && r.lastSentAtFromLog && nextAttempt <= MAX_RETRY_ATTEMPTS) {
        const lastFailedAt = new Date(r.lastSentAtFromLog).getTime();
        const delayMs = getRetryDelayMs(currentRetryAttempt);
        retryInProgress = Date.now() < lastFailedAt + delayMs;
        if (retryInProgress) {
          nextRetryAt = new Date(lastFailedAt + delayMs).toISOString();
        }
      }
      const retriesExhausted = r.lastSuccess === false && currentRetryAttempt >= MAX_RETRY_ATTEMPTS;
      return {
        ...serializeSchedule(r),
        lastSendStatus: deriveLastSendStatus(r.lastSuccess),
        lastErrorMessage: r.lastErrorMessage ?? null,
        sendCount: Number(r.sendCount),
        successCount: Number(r.successCount),
        currentRetryAttempt,
        maxRetryAttempts: MAX_RETRY_ATTEMPTS,
        retryInProgress,
        nextRetryAt,
        retriesExhausted,
      };
    }),
  });
});

router.get("/schedules/logs", async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const limitNum = Math.min(200, Math.max(1, parseInt((req.query as Record<string, string>)['limit'] ?? "50") || 50));

  const logs = await db
    .select({
      ...getTableColumns(scheduledAuditReportLogsTable),
      scheduleEmail: scheduledAuditReportsTable.recipientEmail,
      scheduleFrequency: scheduledAuditReportsTable.frequency,
    })
    .from(scheduledAuditReportLogsTable)
    .innerJoin(scheduledAuditReportsTable, eq(scheduledAuditReportLogsTable.scheduleId, scheduledAuditReportsTable.id))
    .orderBy(desc(scheduledAuditReportLogsTable.sentAt))
    .limit(limitNum);

  res.json({
    data: logs.map(l => ({
      ...l,
      sentAt: l.sentAt.toISOString(),
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

  res.status(201).json({ ...serializeSchedule(schedule), sendCount: 0, successCount: 0, retryInProgress: false, currentRetryAttempt: 0, maxRetryAttempts: MAX_RETRY_ATTEMPTS, nextRetryAt: null, retriesExhausted: false });
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
      lastSendStatus: deriveLastSendStatus(r.lastSuccess),
      sendCount: 0,
      successCount: 0,
      retryInProgress: false,
      currentRetryAttempt: 0,
      maxRetryAttempts: MAX_RETRY_ATTEMPTS,
      nextRetryAt: null,
      retriesExhausted: false,
    })),
  });
});

router.patch("/schedules/:id", async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const id = parseInt(req.params['id'] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const user = (req as any).user;
  const { frequency, recipientEmail, isActive, acknowledgeFailure } = req.body;
  const updates: Partial<{
    frequency: string;
    recipientEmail: string;
    isActive: boolean;
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
  if (acknowledgeFailure === true) {
    updates.failureAcknowledgedAt = new Date();
    updates.failureAcknowledgedByEmail = user.email;
  }

  const [updated] = await db
    .update(scheduledAuditReportsTable)
    .set(updates)
    .where(eq(scheduledAuditReportsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Schedule not found" }); return; }

  const [{ sendCount, successCount }] = await db
    .select({
      sendCount: sql<number>`COUNT(*)`,
      successCount: sql<number>`COUNT(*) FILTER (WHERE success = true)`,
    })
    .from(scheduledAuditReportLogsTable)
    .where(eq(scheduledAuditReportLogsTable.scheduleId, id));

  const [lastLog] = await db
    .select({
      success: scheduledAuditReportLogsTable.success,
    })
    .from(scheduledAuditReportLogsTable)
    .where(eq(scheduledAuditReportLogsTable.scheduleId, id))
    .orderBy(desc(scheduledAuditReportLogsTable.sentAt))
    .limit(1);

  res.json({
    ...serializeSchedule(updated),
    lastSendStatus: deriveLastSendStatus(lastLog?.success ?? null),
    sendCount: Number(sendCount),
    successCount: Number(successCount),
    currentRetryAttempt: 0,
    maxRetryAttempts: MAX_RETRY_ATTEMPTS,
    retryInProgress: false,
    nextRetryAt: null,
    retriesExhausted: false,
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

  const [latestLog] = await db
    .select()
    .from(scheduledAuditReportLogsTable)
    .where(eq(scheduledAuditReportLogsTable.scheduleId, id))
    .orderBy(desc(scheduledAuditReportLogsTable.sentAt))
    .limit(1);

  const isRetry = latestLog != null && !latestLog.success;
  const retryAttempt = isRetry ? latestLog.retryAttempt + 1 : 0;

  try {
    await sendScheduledReport(schedule, isRetry, retryAttempt);
  } catch {
    res.status(502).json({ error: "Email delivery failed. Check mailer configuration." });
    return;
  }

  const [updated] = await db
    .select()
    .from(scheduledAuditReportsTable)
    .where(eq(scheduledAuditReportsTable.id, id));

  res.json({ ...serializeSchedule(updated!), retryInProgress: false, currentRetryAttempt: 0 });
});

export default router;
