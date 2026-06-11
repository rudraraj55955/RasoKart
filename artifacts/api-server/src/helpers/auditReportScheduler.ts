import cron, { type ScheduledTask } from "node-cron";
import { db, scheduledAuditReportsTable, scheduledAuditReportLogsTable, auditLogsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendMail } from "./mailer";

let scheduledTask: ScheduledTask | null = null;

function escapeCsv(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildAuditCsv(rows: typeof auditLogsTable.$inferSelect[]): string {
  const header = ["ID", "Admin Email", "Admin ID", "Action", "Target Type", "Target ID", "IP Address", "Timestamp"];
  const csvRows = rows.map(r => [
    escapeCsv(r.id),
    escapeCsv(r.adminEmail),
    escapeCsv(r.adminId),
    escapeCsv(r.action),
    escapeCsv(r.targetType),
    escapeCsv(r.targetId),
    escapeCsv(r.ipAddress),
    escapeCsv(r.createdAt.toISOString()),
  ].join(","));
  return [header.join(","), ...csvRows].join("\n");
}

export function buildEmailHtml(frequency: string, dateFrom: Date, dateTo: Date, rowCount: number): string {
  const periodLabel = frequency === "daily"
    ? `Daily — Last 24 hours (${dateFrom.toISOString().slice(0, 16).replace("T", " ")} UTC to ${dateTo.toISOString().slice(0, 16).replace("T", " ")} UTC)`
    : frequency === "weekly"
    ? `Weekly — Last 7 days (${dateFrom.toISOString().slice(0, 10)} to ${dateTo.toISOString().slice(0, 10)})`
    : `Monthly — Last 30 days (${dateFrom.toISOString().slice(0, 10)} to ${dateTo.toISOString().slice(0, 10)})`;

  const appDomain = process.env["APP_DOMAIN"] ?? "https://rasokart.com";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #6d28d9; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Audit Log Report</h1>
      <p style="margin: 4px 0 0; color: #ddd6fe; font-size: 13px;">${periodLabel}</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 14px;">
        Your scheduled audit log report is attached as a CSV file.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 50%;">Report Period</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${periodLabel}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Frequency</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; text-transform: capitalize;">${frequency}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Total Events</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600; color: #a78bfa;">${rowCount.toLocaleString()}</td>
        </tr>
      </table>
      <p style="margin: 0 0 16px; color: #71717a; font-size: 12px;">
        The full audit log for this period is attached as a CSV file. Log in to the 
        <a href="${appDomain}/admin/audit-logs" style="color: #818cf8;">Admin Console</a> 
        for real-time review and filtering.
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This is an automated scheduled report from RasoKart. To stop receiving these reports, an admin can cancel the schedule in the Audit Logs page.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export function getDateRange(frequency: string): { dateFrom: Date; dateTo: Date } {
  const now = new Date();
  const dateTo = new Date(now);

  const msPerHour = 60 * 60 * 1000;
  const hoursBack = frequency === "daily" ? 24 : frequency === "weekly" ? 7 * 24 : 30 * 24;
  const dateFrom = new Date(now.getTime() - hoursBack * msPerHour);

  return { dateFrom, dateTo };
}

function isDue(frequency: string, lastSentAt: Date | null): boolean {
  if (!lastSentAt) return true;

  const now = new Date();
  const lastSent = new Date(lastSentAt);

  if (frequency === "daily") {
    const diffHours = (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60);
    return diffHours >= 23;
  } else if (frequency === "weekly") {
    const diffDays = (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays >= 6.9;
  } else {
    const diffDays = (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays >= 28;
  }
}

export async function sendScheduledReport(schedule: typeof scheduledAuditReportsTable.$inferSelect, isRetry = false): Promise<boolean> {
  const { dateFrom, dateTo } = getDateRange(schedule.frequency);
  const sentAt = new Date();

  let rows: typeof auditLogsTable.$inferSelect[] = [];
  let sent = false;
  let errorMessage: string | null = null;

  try {
    rows = await db
      .select()
      .from(auditLogsTable)
      .where(
        and(
          sql`${auditLogsTable.createdAt} >= ${dateFrom}`,
          sql`${auditLogsTable.createdAt} <= ${dateTo}`,
        )
      )
      .orderBy(sql`${auditLogsTable.createdAt} DESC`);

    const csv = buildAuditCsv(rows);
    const html = buildEmailHtml(schedule.frequency, dateFrom, dateTo, rows.length);

    const periodStr = `${dateFrom.toISOString().slice(0, 10)}-to-${dateTo.toISOString().slice(0, 10)}`;
    const filename = `audit-logs-${schedule.frequency}-${periodStr}.csv`;
    const subject = `[RasoKart] Audit Log Report — ${schedule.frequency.charAt(0).toUpperCase() + schedule.frequency.slice(1)} (${dateFrom.toISOString().slice(0, 10)} to ${dateTo.toISOString().slice(0, 10)})`;

    sent = await sendMail({
      to: schedule.recipientEmail,
      subject,
      html,
      attachments: [{ filename, content: csv, contentType: "text/csv" }],
    });

    if (!sent) {
      errorMessage = "Mail transport returned false — email not delivered";
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  await db.insert(scheduledAuditReportLogsTable).values({
    scheduleId: schedule.id,
    sentAt,
    rowCount: rows.length,
    success: sent,
    errorMessage,
    isRetry,
  });

  if (sent) {
    await db
      .update(scheduledAuditReportsTable)
      .set({ lastSentAt: sentAt, updatedAt: new Date() })
      .where(eq(scheduledAuditReportsTable.id, schedule.id));
    logger.info({ scheduleId: schedule.id, recipientEmail: schedule.recipientEmail, rowCount: rows.length, isRetry }, "Scheduled audit report sent");
  } else {
    logger.warn({ scheduleId: schedule.id, errorMessage, isRetry }, "Scheduled audit report send failed");
    throw new Error(errorMessage ?? "Send failed");
  }
  return sent;
}

async function runDueReports(): Promise<void> {
  try {
    const active = await db
      .select()
      .from(scheduledAuditReportsTable)
      .where(eq(scheduledAuditReportsTable.isActive, true));

    const sentInThisRun = new Set<number>();

    for (const schedule of active) {
      if (isDue(schedule.frequency, schedule.lastSentAt)) {
        sentInThisRun.add(schedule.id);
        await sendScheduledReport(schedule).catch(err => {
          logger.error({ err, scheduleId: schedule.id }, "Failed to send scheduled audit report");
        });
      }
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    for (const schedule of active) {
      if (sentInThisRun.has(schedule.id)) continue;

      const [latestLog] = await db
        .select()
        .from(scheduledAuditReportLogsTable)
        .where(eq(scheduledAuditReportLogsTable.scheduleId, schedule.id))
        .orderBy(desc(scheduledAuditReportLogsTable.sentAt))
        .limit(1);

      if (latestLog && !latestLog.success && latestLog.sentAt >= twoHoursAgo) {
        logger.info({ scheduleId: schedule.id }, "Retrying recently-failed scheduled audit report");
        await sendScheduledReport(schedule, true).catch(err => {
          logger.error({ err, scheduleId: schedule.id }, "Retry of scheduled audit report also failed");
        });
      }
    }
  } catch (err) {
    logger.error({ err }, "Audit report scheduler run failed");
  }
}

export function initAuditReportScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
  scheduledTask = cron.schedule("0 * * * *", runDueReports);
  logger.info("Audit report scheduler registered (runs every hour)");
}
