import { Router } from "express";
import { db, auditLogsTable, scheduledAuditReportsTable, scheduledAuditReportLogsTable, credentialEventsTable, merchantsTable, usersTable, notificationsTable } from "@workspace/db";
import { eq, ilike, and, count, sql, or, gte, lte, desc, getTableColumns, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { sendScheduledReport, buildEmailHtml, getDateRange, getRetryDelayMs } from "../helpers/auditReportScheduler";
import { sendMail } from "../helpers/mailer";

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

const INACTIVE_DAYS = 90;

interface SecurityComplianceRow {
  merchant_id: number;
  business_name: string;
  email: string;
  last_exported_at: string | null;
  last_login_at: string | null;
  last_dormant_alert_at: string | null;
}

router.get("/security-compliance", async (req, res) => {
  if (!ensureAdmin(req, res)) return;

  const { status } = req.query as Record<string, string>;

  const scResult = await db.execute(sql`
    SELECT
      m.id AS merchant_id,
      m.business_name,
      m.email,
      (
        SELECT MAX(al.created_at)
        FROM audit_logs al
        WHERE al.action = 'security_activity_exported'
          AND al.target_id = m.id
      ) AS last_exported_at,
      (
        SELECT MAX(u.last_login_at)
        FROM users u
        WHERE u.merchant_id = m.id
          AND u.role = 'merchant'
      ) AS last_login_at,
      (
        SELECT MAX(n.created_at)
        FROM notifications n
        WHERE n.type = 'merchant_dormant'
          AND (n.metadata->>'merchantId')::int = m.id
      ) AS last_dormant_alert_at
    FROM merchants m
    ORDER BY m.business_name
  `);
  const rows = scResult.rows as unknown as SecurityComplianceRow[];

  const inactiveCutoff = new Date();
  inactiveCutoff.setDate(inactiveCutoff.getDate() - INACTIVE_DAYS);

  const mapped = rows.map(r => {
    const lastLoginAt = r.last_login_at ? new Date(r.last_login_at).toISOString() : null;
    const isInactive = !r.last_login_at || new Date(r.last_login_at) < inactiveCutoff;
    return {
      merchantId: r.merchant_id,
      businessName: r.business_name,
      email: r.email,
      lastExportedAt: r.last_exported_at ? new Date(r.last_exported_at).toISOString() : null,
      lastLoginAt,
      status: r.last_exported_at ? "exported" : "never",
      isInactive,
      lastDormantAlertAt: r.last_dormant_alert_at ? new Date(r.last_dormant_alert_at).toISOString() : null,
    };
  });

  const filtered =
    status === "exported" ? mapped.filter(r => r.status === "exported") :
    status === "never"    ? mapped.filter(r => r.status === "never") :
    status === "inactive" ? mapped.filter(r => r.isInactive) :
    mapped;

  const exportedCount  = mapped.filter(r => r.status === "exported").length;
  const neverCount     = mapped.filter(r => r.status === "never").length;
  const inactiveCount  = mapped.filter(r => r.isInactive).length;

  res.json({
    data: filtered,
    totalMerchants: mapped.length,
    exportedCount,
    neverCount,
    inactiveCount,
  });
});

router.post("/security-compliance/remind", async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const user = (req as any).user;

  const { merchantIds } = (req.body ?? {}) as { merchantIds?: number[] };

  const allRows = await db
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

  const neverExported = allRows.filter(r => r.lastExportedAt == null);

  let targets = neverExported;
  if (Array.isArray(merchantIds) && merchantIds.length > 0) {
    const ids = new Set(merchantIds);
    targets = neverExported.filter(r => ids.has(r.merchantId));
  }

  let sent = 0;
  let emailsDispatched = 0;
  const skipped = allRows.length - targets.length;

  for (const merchant of targets) {
    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "security_review_reminded",
      targetType: "merchant",
      targetId: merchant.merchantId,
      details: JSON.stringify({
        businessName: merchant.businessName,
        email: merchant.email,
      }),
      ipAddress: req.ip ?? null,
    });
    sent++;

    const emailOk = await sendMail({
      to: merchant.email,
      subject: "Action Required: Review Your Security Activity on RasoKart",
      html: buildSecurityReminderHtml(merchant.businessName),
    });
    if (emailOk) emailsDispatched++;
  }

  res.json({ sent, skipped, emailsDispatched });
});

function buildSecurityReminderHtml(businessName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Security Activity Review Reminder</title>
  <style>
    body { margin: 0; padding: 0; background: #0a0a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #e2e8f0; }
    .wrapper { max-width: 560px; margin: 0 auto; padding: 40px 20px; }
    .card { background: #12121a; border: 1px solid #1e1e2e; border-radius: 12px; padding: 32px; }
    .logo { font-size: 20px; font-weight: 700; color: #7c3aed; margin-bottom: 28px; letter-spacing: -0.3px; }
    .icon-wrap { display: flex; align-items: center; justify-content: center; width: 52px; height: 52px; background: rgba(245,158,11,0.12); border: 1px solid rgba(245,158,11,0.3); border-radius: 12px; margin-bottom: 20px; }
    h1 { font-size: 20px; font-weight: 700; color: #f8fafc; margin: 0 0 12px; }
    p { font-size: 14px; line-height: 1.65; color: #94a3b8; margin: 0 0 16px; }
    .highlight { color: #e2e8f0; font-weight: 500; }
    .btn { display: inline-block; background: #7c3aed; color: #fff !important; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; margin: 8px 0 24px; }
    .steps { background: rgba(255,255,255,0.03); border: 1px solid #1e1e2e; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px; }
    .steps p { margin: 0 0 6px; font-size: 13px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .steps ol { margin: 0; padding-left: 18px; }
    .steps li { font-size: 13px; color: #94a3b8; line-height: 1.6; margin-bottom: 2px; }
    .footer { margin-top: 28px; font-size: 12px; color: #475569; text-align: center; }
    .divider { border: none; border-top: 1px solid #1e1e2e; margin: 24px 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="logo">RasoKart</div>
      <div class="icon-wrap">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </div>
      <h1>Review Your Security Activity</h1>
      <p>Hi <span class="highlight">${escapeHtml(businessName)}</span>,</p>
      <p>Our records show that your account's security activity log has <strong style="color:#f59e0b">never been reviewed or exported</strong>. Reviewing your security activity helps you spot any unauthorised access or unexpected changes to your account.</p>
      <a href="https://rasokart.com/merchant/security-activity" class="btn">Review Security Activity →</a>
      <div class="steps">
        <p>How to review</p>
        <ol>
          <li>Log in to your RasoKart merchant dashboard</li>
          <li>Navigate to <strong style="color:#e2e8f0">Security Activity</strong> in the sidebar</li>
          <li>Review the listed events and export a copy for your records</li>
        </ol>
      </div>
      <hr class="divider" />
      <p style="font-size:13px;color:#475569;margin:0">If you have already reviewed your security log, you can safely ignore this message. If you believe you received this in error, please contact our support team.</p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} RasoKart &mdash; Payment Gateway Platform
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Keep in sync with ROTATED_FIELD_LABELS in credential-history-dialog.tsx
const ROTATED_FIELD_LABELS: Record<string, string> = {
  clientIdUpdated: "Client ID",
  clientSecretUpdated: "Client Secret",
  webhookSecretUpdated: "Webhook Secret",
  apiKeyUpdated: "API Key",
  fundsourceIdUpdated: "Fundsource ID",
};

// Keep in sync with SETTING_LABELS in credential-history-dialog.tsx
const SETTING_LABELS: Record<string, string> = {
  enabled: "Enabled",
  env: "Environment",
  baseUrl: "Base URL",
  apiVersion: "API Version",
  upiEnabled: "UPI",
  qrEnabled: "QR Codes",
  paymentLinksEnabled: "Payment Links",
  merchantPayinEnabled: "Merchant Payin",
  merchantEnabled: "Merchant Access",
  adminApprovalRequired: "Admin Approval Required",
  isEnabled: "Enabled",
  environment: "Environment",
  displayNamePublic: "Display Name",
  productType: "Product Type",
  webhookUrl: "Webhook URL",
  notes: "Notes",
};

const SKIP_KEYS = new Set(["providerKey", "updatedByEmail", "section", "key"]);

// Only these action types have details JSON shapes that map cleanly to
// SETTING_LABELS / ROTATED_FIELD_LABELS. Every other action (csv_export,
// plan_assigned, merchant_created, etc.) must produce an empty Changes cell
// rather than raw key:value noise or the raw JSON string.
const SUPPORTED_CHANGE_SUMMARY_ACTIONS = new Set([
  "system_config_updated",
  "provider_integration_updated",
]);

function formatCsvValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "On" : "Off";
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function isFromTo(v: unknown): v is { from: unknown; to: unknown } {
  return typeof v === "object" && v !== null && "from" in v && "to" in v;
}

/**
 * Produces a human-readable plain-text "Changes" string from an audit log
 * details JSON blob — mirrors the ChangeSummary component in
 * credential-history-dialog.tsx so the CSV column matches the on-screen view.
 *
 * Examples:
 *   "Client Secret rotated; Environment: sandbox → production"
 *   "API Key rotated; Enabled: Off → On"
 */
function buildChangeSummaryText(details: string | null, action?: string): string {
  if (!details) return "";
  if (action !== undefined && !SUPPORTED_CHANGE_SUMMARY_ACTIONS.has(action)) return "";
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(details) as Record<string, unknown>;
  } catch {
    return details;
  }

  const parts: string[] = [];

  for (const [key, value] of Object.entries(parsed)) {
    if (SKIP_KEYS.has(key)) continue;

    // Boolean "*Updated" flags (built-in gateways)
    if (key in ROTATED_FIELD_LABELS) {
      if (value === true) parts.push(`${ROTATED_FIELD_LABELS[key]} rotated`);
      continue;
    }

    // "*Encrypted" fields from provider_integration_updated
    if (key.endsWith("Encrypted") && value === "[redacted]") {
      const baseName = key.replace(/Encrypted$/, "");
      const labelMap: Record<string, string> = {
        apiKey: "API Key",
        apiSecret: "API Secret",
        webhookSecret: "Webhook Secret",
      };
      parts.push(`${labelMap[baseName] ?? baseName} rotated`);
      continue;
    }

    const label = SETTING_LABELS[key] ?? key;
    if (isFromTo(value)) {
      parts.push(`${label}: ${formatCsvValue(value.from)} → ${formatCsvValue(value.to)}`);
    } else {
      parts.push(`${label}: ${formatCsvValue(value)}`);
    }
  }

  return parts.join("; ");
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

  const { page = "1", limit = "20", action, targetType, search, dateFrom, dateTo, merchantId, settingKey, performedBy, actorEmail } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions: any[] = [];
  if (action && action !== "all") conditions.push(eq(auditLogsTable.action, action));
  if (targetType && targetType !== "all") conditions.push(eq(auditLogsTable.targetType, targetType));
  if (actorEmail && actorEmail.trim() !== "") {
    conditions.push(ilike(auditLogsTable.adminEmail, `%${actorEmail.trim()}%`));
  }
  if (performedBy === "system") {
    conditions.push(
      or(
        eq(auditLogsTable.adminEmail, "system"),
        eq(auditLogsTable.adminId, 0),
      )!
    );
  } else if (performedBy === "admin") {
    conditions.push(
      and(
        sql`${auditLogsTable.adminEmail} != 'system'`,
        sql`${auditLogsTable.adminId} != 0`,
      )!
    );
  }
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
    } else if (action === "provider_integration_updated") {
      conditions.push(sql`${auditLogsTable.details}::jsonb->>'providerKey' = ${settingKey}`);
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

  const { action, targetType, search, dateFrom, dateTo, performedBy, actorEmail, merchantId, settingKey } = req.query as Record<string, string>;

  const conditions: any[] = [];
  if (action && action !== "all") conditions.push(eq(auditLogsTable.action, action));
  if (targetType && targetType !== "all") conditions.push(eq(auditLogsTable.targetType, targetType));
  if (actorEmail && actorEmail.trim() !== "") {
    conditions.push(ilike(auditLogsTable.adminEmail, `%${actorEmail.trim()}%`));
  }
  if (performedBy === "system") {
    conditions.push(
      or(
        eq(auditLogsTable.adminEmail, "system"),
        eq(auditLogsTable.adminId, 0),
      )!
    );
  } else if (performedBy === "admin") {
    conditions.push(
      and(
        sql`${auditLogsTable.adminEmail} != 'system'`,
        sql`${auditLogsTable.adminId} != 0`,
      )!
    );
  }
  if (search) {
    conditions.push(
      or(
        ilike(auditLogsTable.adminEmail, `%${search}%`),
        ilike(auditLogsTable.action, `%${search}%`),
        ilike(auditLogsTable.targetType, `%${search}%`),
      )!
    );
  }
  let validatedFrom: Date | null = null;
  let validatedTo: Date | null = null;
  if (dateFrom) {
    const from = new Date(dateFrom);
    from.setUTCHours(0, 0, 0, 0);
    if (!isNaN(from.getTime())) {
      conditions.push(gte(auditLogsTable.createdAt, from));
      validatedFrom = from;
    }
  }
  if (dateTo) {
    const to = new Date(dateTo);
    to.setUTCHours(23, 59, 59, 999);
    if (!isNaN(to.getTime())) {
      conditions.push(lte(auditLogsTable.createdAt, to));
      validatedTo = to;
    }
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
    } else if (action === "provider_integration_updated") {
      conditions.push(sql`${auditLogsTable.details}::jsonb->>'providerKey' = ${settingKey}`);
    }
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

  const header = ["ID", "Actor Email", "Admin ID", "Action", "Target Type", "Target ID", "IP Address", "Timestamp", "Changes"];
  const csvRows = rows.map(r => [
    escapeCsv(String(r.id)),
    escapeCsv(r.adminEmail),
    escapeCsv(String(r.adminId)),
    escapeCsv(r.action),
    escapeCsv(r.targetType),
    escapeCsv(r.targetId != null ? String(r.targetId) : null),
    escapeCsv(r.ipAddress),
    escapeCsv(r.createdAt.toISOString()),
    escapeCsv(buildChangeSummaryText(r.details, r.action)),
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
      filters: { action: action ?? null, targetType: targetType ?? null, search: search ?? null, dateFrom: dateFrom ?? null, dateTo: dateTo ?? null, performedBy: performedBy ?? null, actorEmail: actorEmail ?? null, merchantId: merchantId ?? null },
    }),
    ipAddress: req.ip ?? null,
  });

  // Build filename using the already-validated Date objects — never re-parse the raw string.
  const today = new Date().toISOString().slice(0, 10);
  let filename: string;
  if (validatedFrom || validatedTo) {
    const from = validatedFrom ? validatedFrom.toISOString().slice(0, 10) : "start";
    const to   = validatedTo   ? validatedTo.toISOString().slice(0, 10)   : today;
    filename = `audit-logs-${from}-to-${to}.csv`;
  } else {
    filename = `audit-logs-${today}.csv`;
  }
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

  const baseCondition = or(
    eq(auditLogsTable.targetId, user.merchantId),
    and(
      eq(auditLogsTable.action, "notification_preferences_updated"),
      eq(auditLogsTable.adminId, user.id),
    ),
  )!;

  const conditions: any[] = [baseCondition];
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

  const exportCondition = or(
    eq(auditLogsTable.targetId, user.merchantId),
    and(
      eq(auditLogsTable.action, "notification_preferences_updated"),
      eq(auditLogsTable.adminId, user.id),
    ),
  )!;

  const rows = await db
    .select()
    .from(auditLogsTable)
    .where(exportCondition)
    .orderBy(sql`${auditLogsTable.createdAt} DESC`);

  function escapeCsv(val: string | null | undefined): string {
    if (val == null) return "";
    const s = String(val);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  function formatDetails(action: string, details: string | null): string {
    if (action !== "notification_preferences_updated" || !details) return "";
    try {
      const parsed = JSON.parse(details) as { changes?: { field: string; oldValue: boolean; newValue: boolean }[] };
      if (!Array.isArray(parsed.changes) || parsed.changes.length === 0) return "";
      return parsed.changes
        .map(c => `${c.field}: ${c.oldValue ? "On" : "Off"} → ${c.newValue ? "On" : "Off"}`)
        .join("; ");
    } catch {
      return "";
    }
  }

  const header = ["ID", "Action", "Target Type", "Target ID", "IP Address", "Timestamp", "Details"];
  const csvRows = rows.map(r => [
    escapeCsv(String(r.id)),
    escapeCsv(r.action),
    escapeCsv(r.targetType),
    escapeCsv(r.targetId != null ? String(r.targetId) : null),
    escapeCsv(r.ipAddress),
    escapeCsv(r.createdAt.toISOString()),
    escapeCsv(formatDetails(r.action, r.details)),
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

  const { page = "1", limit = "20", dateFrom, dateTo, merchantId, eventType, actorEmail, ipAddress } = req.query as Record<string, string>;
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
  if (actorEmail && actorEmail.trim() !== "") {
    conditions.push(ilike(credentialEventsTable.actorEmail, `%${actorEmail.trim()}%`));
  }
  if (ipAddress && ipAddress.trim() !== "") {
    conditions.push(ilike(credentialEventsTable.ipAddress, `${ipAddress.trim()}%`));
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
      lastSuccessWasManualRetry: sql<boolean | null>`(
        SELECT is_manual_retry FROM ${scheduledAuditReportLogsTable}
        WHERE schedule_id = ${scheduledAuditReportsTable.id}
        AND success = true
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
      const lastSendStatus = deriveLastSendStatus(r.lastSuccess);
      const lastDeliveryAttempts = lastSendStatus === "none" ? 0 : currentRetryAttempt + 1;
      return {
        ...serializeSchedule(r),
        lastSendStatus,
        lastErrorMessage: r.lastErrorMessage ?? null,
        sendCount: Number(r.sendCount),
        successCount: Number(r.successCount),
        currentRetryAttempt,
        maxRetryAttempts: MAX_RETRY_ATTEMPTS,
        retryInProgress,
        nextRetryAt,
        retriesExhausted,
        lastDeliveryAttempts,
        lastSuccessWasManualRetry: r.lastSuccessWasManualRetry === true,
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

  if (acknowledgeFailure === true) {
    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "audit_schedule_failure_acknowledged",
      targetType: "report_schedule",
      targetId: id,
      details: JSON.stringify({
        scheduleId: id,
        recipientEmail: updated.recipientEmail,
      }),
    });
  }

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

// DELETE /api/audit-logs/test-email-history
// Removes all audit log entries with action = 'test_email_sent'.
router.delete("/test-email-history", async (req, res) => {
  if (!ensureAdmin(req, res)) return;

  const result = await db
    .delete(auditLogsTable)
    .where(eq(auditLogsTable.action, "test_email_sent"))
    .returning({ id: auditLogsTable.id });

  res.json({ deleted: result.length });
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
    await sendScheduledReport(schedule, isRetry, retryAttempt, true);
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
