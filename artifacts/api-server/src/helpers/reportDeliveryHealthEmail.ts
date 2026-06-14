/**
 * Weekly report delivery health digest.
 *
 * Runs every Monday morning at 08:00 UTC. Queries report_delivery_logs for
 * the past 7 days, computes per-merchant success/failure counts, highlights
 * auto-paused schedules, and emails a digest to all active admin users who
 * have opted in to report failure alert emails.
 *
 * The digest is sent regardless of overall health — a "clean" digest with
 * 100% success rate is still useful for admins to confirm all is well. When
 * SMTP is not configured the job logs a warning and exits silently.
 */

import cron from "node-cron";
import { db, reportDeliveryLogsTable, reportSchedulesTable, merchantsTable, usersTable } from "@workspace/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendMail } from "./mailer";

const APP_DOMAIN = process.env["APP_DOMAIN"] ?? "https://rasokart.com";

interface MerchantHealthRow {
  merchantId: number;
  businessName: string;
  successCount: number;
  failureCount: number;
  autoPauseCount: number;
  failureRate: number;
  scheduleActive: boolean | null;
}

interface DigestStats {
  totalDeliveries: number;
  totalSuccesses: number;
  totalFailures: number;
  autoPausedSchedules: number;
  overallFailureRate: number;
  merchantsWithFailures: number;
}

async function getAdminDigestEmails(): Promise<{ email: string; id: number }[]> {
  const rows = await db
    .select({ email: usersTable.email, id: usersTable.id })
    .from(usersTable)
    .where(and(
      eq(usersTable.role, "admin"),
      eq(usersTable.isActive, true),
      eq(usersTable.weeklyDeliveryDigestEmails, true),
    ));
  return rows;
}

export async function buildHealthData(from: Date, to?: Date): Promise<{ merchants: MerchantHealthRow[]; stats: DigestStats }> {
  const dateConditions = to
    ? and(gte(reportDeliveryLogsTable.attemptedAt, from), lte(reportDeliveryLogsTable.attemptedAt, to))
    : gte(reportDeliveryLogsTable.attemptedAt, from);

  const logsWithMerchant = await db
    .select({
      merchantId: reportDeliveryLogsTable.merchantId,
      businessName: merchantsTable.businessName,
      successCount: sql<number>`CAST(COUNT(CASE WHEN ${reportDeliveryLogsTable.success} = true AND ${reportDeliveryLogsTable.isAutoPause} = false THEN 1 END) AS INTEGER)`,
      failureCount: sql<number>`CAST(COUNT(CASE WHEN ${reportDeliveryLogsTable.success} = false AND ${reportDeliveryLogsTable.isAutoPause} = false THEN 1 END) AS INTEGER)`,
      autoPauseCount: sql<number>`CAST(COUNT(CASE WHEN ${reportDeliveryLogsTable.isAutoPause} = true THEN 1 END) AS INTEGER)`,
    })
    .from(reportDeliveryLogsTable)
    .innerJoin(merchantsTable, eq(reportDeliveryLogsTable.merchantId, merchantsTable.id))
    .where(dateConditions)
    .groupBy(reportDeliveryLogsTable.merchantId, merchantsTable.businessName);

  const scheduleStatusMap = new Map<number, boolean>();
  if (logsWithMerchant.length > 0) {
    const merchantIds = logsWithMerchant.map(r => r.merchantId);
    const scheduleRows = await db
      .select({ merchantId: reportSchedulesTable.merchantId, isActive: reportSchedulesTable.isActive })
      .from(reportSchedulesTable)
      .where(sql`${reportSchedulesTable.merchantId} = ANY(ARRAY[${sql.join(merchantIds.map(id => sql`${id}`), sql`, `)}]::integer[])`);
    for (const row of scheduleRows) {
      scheduleStatusMap.set(row.merchantId, row.isActive);
    }
  }

  let totalDeliveries = 0;
  let totalSuccesses = 0;
  let totalFailures = 0;
  let autoPausedSchedules = 0;
  let merchantsWithFailures = 0;

  const merchants: MerchantHealthRow[] = logsWithMerchant.map(row => {
    const successCount = Number(row.successCount);
    const failureCount = Number(row.failureCount);
    const autoPauseCount = Number(row.autoPauseCount);
    const total = successCount + failureCount;
    const failureRate = total > 0 ? failureCount / total : 0;
    const scheduleActive = scheduleStatusMap.get(row.merchantId) ?? null;

    totalDeliveries += total;
    totalSuccesses += successCount;
    totalFailures += failureCount;
    if (autoPauseCount > 0) autoPausedSchedules++;
    if (failureCount > 0) merchantsWithFailures++;

    return {
      merchantId: row.merchantId,
      businessName: row.businessName,
      successCount,
      failureCount,
      autoPauseCount,
      failureRate,
      scheduleActive,
    };
  });

  merchants.sort((a, b) => b.failureCount - a.failureCount || b.failureRate - a.failureRate);

  const overallFailureRate = totalDeliveries > 0 ? totalFailures / totalDeliveries : 0;

  return {
    merchants,
    stats: {
      totalDeliveries,
      totalSuccesses,
      totalFailures,
      autoPausedSchedules,
      overallFailureRate,
      merchantsWithFailures,
    },
  };
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function healthColor(failureRate: number): string {
  if (failureRate === 0) return "#4ade80";
  if (failureRate < 0.2) return "#facc15";
  return "#f87171";
}

function buildDigestHtml(
  merchants: MerchantHealthRow[],
  stats: DigestStats,
  periodFrom: Date,
  periodTo: Date,
): string {
  const periodLabel = `${periodFrom.toISOString().slice(0, 10)} to ${periodTo.toISOString().slice(0, 10)}`;
  const generatedAt = new Date().toUTCString();
  const reportsUrl = `${APP_DOMAIN}/admin/reports`;
  const smtpSettingsUrl = `${APP_DOMAIN}/admin/settings`;

  const overallColor = healthColor(stats.overallFailureRate);
  const healthLabel =
    stats.overallFailureRate === 0
      ? "✅ Healthy"
      : stats.overallFailureRate < 0.2
        ? "⚠️ Degraded"
        : "🔴 Unhealthy";

  const merchantRows = merchants.length === 0
    ? `<tr><td colspan="6" style="padding: 14px; text-align: center; color: #52525b; font-size: 13px;">No delivery activity in the past 7 days.</td></tr>`
    : merchants.map((m, i) => {
        const bg = i % 2 === 0 ? "" : ' style="background: #111;"';
        const rate = healthColor(m.failureRate);
        const pauseBadge = m.autoPauseCount > 0
          ? ` <span style="display: inline-block; background: #7f1d1d; color: #fca5a5; font-size: 10px; padding: 1px 6px; border-radius: 3px; margin-left: 4px;">AUTO-PAUSED</span>`
          : "";
        const scheduleStatus = m.scheduleActive === false
          ? `<span style="color: #fb923c; font-size: 12px;">Paused</span>`
          : m.scheduleActive === true
            ? `<span style="color: #4ade80; font-size: 12px;">Active</span>`
            : `<span style="color: #52525b; font-size: 12px;">—</span>`;
        const merchantLink = `${APP_DOMAIN}/admin/merchants/${m.merchantId}`;

        return `
      <tr${bg}>
        <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">
          <a href="${merchantLink}" style="color: #818cf8; text-decoration: none;">${escHtml(m.businessName)}</a>${pauseBadge}
        </td>
        <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; text-align: center; color: #4ade80; font-weight: 600;">${m.successCount}</td>
        <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; text-align: center; color: ${m.failureCount > 0 ? "#f87171" : "#4ade80"}; font-weight: 600;">${m.failureCount}</td>
        <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; text-align: center; color: ${rate}; font-weight: 600;">${pct(m.failureRate)}</td>
        <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; text-align: center;">${scheduleStatus}</td>
        <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; text-align: center;">
          ${m.autoPauseCount > 0 ? `<span style="color: #f87171; font-weight: 600;">${m.autoPauseCount}</span>` : `<span style="color: #52525b;">0</span>`}
        </td>
      </tr>`;
      }).join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 760px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">

    <div style="background: #4c1d95; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Weekly Delivery Health Digest</h1>
      <p style="margin: 4px 0 0; color: #ddd6fe; font-size: 13px;">Period: ${periodLabel}</p>
    </div>

    <div style="padding: 24px;">

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 42%;">Overall Health</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: ${overallColor}; font-weight: 700;">${healthLabel} (${pct(stats.overallFailureRate)} failure rate)</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Total Deliveries</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${stats.totalDeliveries.toLocaleString("en-IN")}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Successful</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #4ade80; font-weight: 600;">${stats.totalSuccesses.toLocaleString("en-IN")}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Failed</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: ${stats.totalFailures > 0 ? "#f87171" : "#4ade80"}; font-weight: 600;">${stats.totalFailures.toLocaleString("en-IN")}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Auto-Paused Schedules</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: ${stats.autoPausedSchedules > 0 ? "#fb923c" : "#4ade80"}; font-weight: 600;">${stats.autoPausedSchedules}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Merchants with Failures</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: ${stats.merchantsWithFailures > 0 ? "#fb923c" : "#4ade80"}; font-weight: 600;">${stats.merchantsWithFailures}</td>
        </tr>
      </table>

      <h2 style="margin: 0 0 12px; font-size: 15px; color: #e5e5e5; font-weight: 600;">Per-Merchant Breakdown</h2>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <thead>
          <tr style="background: #111;">
            <th style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 12px; text-align: left; font-weight: 600;">Merchant</th>
            <th style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 12px; text-align: center; font-weight: 600;">✓ Sent</th>
            <th style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 12px; text-align: center; font-weight: 600;">✗ Failed</th>
            <th style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 12px; text-align: center; font-weight: 600;">Fail Rate</th>
            <th style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 12px; text-align: center; font-weight: 600;">Schedule</th>
            <th style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 12px; text-align: center; font-weight: 600;">Auto-Pauses</th>
          </tr>
        </thead>
        <tbody>
          ${merchantRows}
        </tbody>
      </table>

      ${stats.autoPausedSchedules > 0 ? `
      <div style="background: #431407; border: 1px solid #7c2d12; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0; color: #fb923c; font-size: 13px; font-weight: 600;">⚠️ ${stats.autoPausedSchedules} schedule${stats.autoPausedSchedules !== 1 ? "s were" : " was"} auto-paused due to repeated delivery failures.</p>
        <p style="margin: 6px 0 0; color: #a1a1aa; font-size: 12px;">This typically indicates an SMTP misconfiguration. Check <a href="${smtpSettingsUrl}" style="color: #818cf8;">SMTP Settings</a>, then re-enable the affected schedules from the <a href="${reportsUrl}" style="color: #818cf8;">Reports page</a>.</p>
      </div>` : ""}

      ${stats.overallFailureRate >= 0.2 ? `
      <div style="background: #1c1917; border: 1px solid #44403c; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0; color: #f87171; font-size: 13px; font-weight: 600;">🔴 Overall failure rate is above 20% — SMTP delivery may be impaired.</p>
        <p style="margin: 6px 0 0; color: #a1a1aa; font-size: 12px;">Review <a href="${smtpSettingsUrl}" style="color: #818cf8;">SMTP Settings</a> and delivery logs in the <a href="${reportsUrl}" style="color: #818cf8;">Admin Reports page</a>.</p>
      </div>` : ""}

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${reportsUrl}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          Open Reports Dashboard
        </a>
      </div>

      <p style="margin: 0; color: #71717a; font-size: 12px; text-align: center;">
        Generated: ${generatedAt}
      </p>
    </div>

    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This weekly digest is sent every Monday by RasoKart. To stop receiving it, disable Weekly Delivery Digest Emails in your Admin notification preferences.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface DeliveryHealthDigestResult {
  merchantsWithActivity: number;
  stats: DigestStats;
  adminsSent: number;
  adminsFailed: number;
}

export async function sendDeliveryHealthDigest(): Promise<DeliveryHealthDigestResult> {
  const periodTo = new Date();
  const periodFrom = new Date(periodTo.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [admins, { merchants, stats }] = await Promise.all([
    getAdminDigestEmails(),
    buildHealthData(periodFrom, periodTo),
  ]);

  if (admins.length === 0) {
    logger.info("Weekly delivery health digest: no admins opted in — skipping");
    return { merchantsWithActivity: merchants.length, stats, adminsSent: 0, adminsFailed: 0 };
  }

  const html = buildDigestHtml(merchants, stats, periodFrom, periodTo);
  const subject = `[RasoKart] Weekly Report Delivery Health — ${periodFrom.toISOString().slice(0, 10)} to ${periodTo.toISOString().slice(0, 10)} (${pct(stats.overallFailureRate)} failure rate)`;

  const results = await Promise.allSettled(
    admins.map(admin => sendMail({ to: admin.email, subject, html }))
  );

  const adminsSent = results.filter(r => r.status === "fulfilled" && r.value).length;
  const adminsFailed = results.length - adminsSent;

  logger.info(
    {
      periodFrom: periodFrom.toISOString(),
      periodTo: periodTo.toISOString(),
      merchantsWithActivity: merchants.length,
      totalDeliveries: stats.totalDeliveries,
      totalFailures: stats.totalFailures,
      autoPausedSchedules: stats.autoPausedSchedules,
      overallFailureRate: pct(stats.overallFailureRate),
      adminsSent,
      adminsFailed,
    },
    "Weekly delivery health digest sent",
  );

  return { merchantsWithActivity: merchants.length, stats, adminsSent, adminsFailed };
}

export function initDeliveryHealthDigestScheduler(): void {
  cron.schedule("0 8 * * 1", async () => {
    try {
      await sendDeliveryHealthDigest();
    } catch (err) {
      logger.error({ err }, "Weekly delivery health digest failed");
    }
  });

  logger.info("Weekly delivery health digest scheduler initialized (Mondays at 08:00 UTC)");
}
