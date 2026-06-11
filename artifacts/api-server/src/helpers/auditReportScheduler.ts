import cron, { type ScheduledTask } from "node-cron";
import { randomUUID } from "node:crypto";
import { db, scheduledAuditReportsTable, scheduledAuditReportLogsTable, auditLogsTable, usersTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendMail } from "./mailer";
import { createBulkNotifications } from "./notifications";

const MAX_RETRY_ATTEMPTS = 3;

const RETRY_DELAYS_MS = [
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
];

let scheduledTask: ScheduledTask | null = null;
let retryTask: ScheduledTask | null = null;

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

export function getRetryDelayMs(retryAttempt: number): number {
  return RETRY_DELAYS_MS[retryAttempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
}

async function notifyAdminsOfAutoPause(schedule: typeof scheduledAuditReportsTable.$inferSelect): Promise<void> {
  try {
    const admins = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)));

    if (admins.length > 0) {
      const freqLabel = schedule.frequency.charAt(0).toUpperCase() + schedule.frequency.slice(1);
      await createBulkNotifications(admins.map(admin => ({
        userId: admin.id,
        type: "scheduled_report_auto_paused" as const,
        title: "Scheduled Report Auto-Paused",
        body: `The ${freqLabel} scheduled report to ${schedule.recipientEmail} was automatically paused after ${schedule.autoPauseAfterFailures} consecutive delivery failures. Re-enable it after fixing the email address.`,
        metadata: { scheduleId: schedule.id, frequency: schedule.frequency, recipientEmail: schedule.recipientEmail, consecutiveFailures: schedule.autoPauseAfterFailures },
      })));
      logger.info({ scheduleId: schedule.id, adminCount: admins.length }, "Admin notifications sent for scheduled report auto-pause");
    }
  } catch (notifyErr) {
    logger.error({ err: notifyErr, scheduleId: schedule.id }, "Failed to send admin notifications for scheduled report auto-pause");
  }
}

export async function sendScheduledReport(
  schedule: typeof scheduledAuditReportsTable.$inferSelect,
  isRetry = false,
  retryAttempt = 0,
): Promise<boolean> {
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

  let deliveryCycleId: string;
  if (!isRetry) {
    deliveryCycleId = randomUUID();
  } else {
    const [latestLog] = await db
      .select({ deliveryCycleId: scheduledAuditReportLogsTable.deliveryCycleId })
      .from(scheduledAuditReportLogsTable)
      .where(eq(scheduledAuditReportLogsTable.scheduleId, schedule.id))
      .orderBy(desc(scheduledAuditReportLogsTable.sentAt))
      .limit(1);
    deliveryCycleId = latestLog?.deliveryCycleId ?? randomUUID();
  }

  await db.insert(scheduledAuditReportLogsTable).values({
    scheduleId: schedule.id,
    sentAt,
    rowCount: rows.length,
    success: sent,
    errorMessage,
    isRetry,
    retryAttempt,
    deliveryCycleId,
  });

  if (sent) {
    await db
      .update(scheduledAuditReportsTable)
      .set({ lastSentAt: sentAt, consecutiveFailures: 0, updatedAt: new Date() })
      .where(eq(scheduledAuditReportsTable.id, schedule.id));
    logger.info({ scheduleId: schedule.id, recipientEmail: schedule.recipientEmail, rowCount: rows.length, isRetry, retryAttempt }, "Scheduled audit report sent");

    if (isRetry && retryAttempt > 0) {
      try {
        const admins = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)));

        if (admins.length > 0) {
          const totalAttempts = retryAttempt + 1;
          const freqLabel = schedule.frequency.charAt(0).toUpperCase() + schedule.frequency.slice(1);
          await createBulkNotifications(admins.map(admin => ({
            userId: admin.id,
            type: "scheduled_report_retry_success" as const,
            title: "Scheduled Report Delivered After Retry",
            body: `The ${freqLabel} scheduled report to ${schedule.recipientEmail} was successfully delivered after ${totalAttempts} attempt${totalAttempts !== 1 ? "s" : ""}.`,
            metadata: { scheduleId: schedule.id, frequency: schedule.frequency, recipientEmail: schedule.recipientEmail, totalAttempts, retryAttempt },
          })));
          logger.info({ scheduleId: schedule.id, adminCount: admins.length, retryAttempt }, "Admin notifications sent for scheduled report retry success");
        }
      } catch (notifyErr) {
        logger.error({ err: notifyErr, scheduleId: schedule.id }, "Failed to send admin notifications for scheduled report retry success");
      }
    }
  } else {
    logger.warn({ scheduleId: schedule.id, errorMessage, isRetry, retryAttempt }, "Scheduled audit report send failed");

    const newConsecutiveFailures = schedule.consecutiveFailures + 1;
    const shouldAutoPause = newConsecutiveFailures >= schedule.autoPauseAfterFailures;

    if (shouldAutoPause) {
      await db
        .update(scheduledAuditReportsTable)
        .set({ consecutiveFailures: newConsecutiveFailures, isActive: false, updatedAt: new Date() })
        .where(eq(scheduledAuditReportsTable.id, schedule.id));
      logger.warn(
        { scheduleId: schedule.id, consecutiveFailures: newConsecutiveFailures, autoPauseAfterFailures: schedule.autoPauseAfterFailures },
        "Scheduled audit report auto-paused after repeated delivery failures",
      );
      await notifyAdminsOfAutoPause({ ...schedule, consecutiveFailures: newConsecutiveFailures });
    } else {
      await db
        .update(scheduledAuditReportsTable)
        .set({ consecutiveFailures: newConsecutiveFailures, updatedAt: new Date() })
        .where(eq(scheduledAuditReportsTable.id, schedule.id));
    }

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

    for (const schedule of active) {
      if (isDue(schedule.frequency, schedule.lastSentAt)) {
        await sendScheduledReport(schedule).catch(err => {
          logger.error({ err, scheduleId: schedule.id }, "Failed to send scheduled audit report");
        });
      }
    }
  } catch (err) {
    logger.error({ err }, "Audit report scheduler run failed");
  }
}

export async function runAutoRetries(): Promise<void> {
  try {
    const active = await db
      .select()
      .from(scheduledAuditReportsTable)
      .where(eq(scheduledAuditReportsTable.isActive, true));

    for (const schedule of active) {
      const [latestLog] = await db
        .select()
        .from(scheduledAuditReportLogsTable)
        .where(eq(scheduledAuditReportLogsTable.scheduleId, schedule.id))
        .orderBy(desc(scheduledAuditReportLogsTable.sentAt))
        .limit(1);

      if (!latestLog || latestLog.success) continue;

      const nextAttempt = latestLog.retryAttempt + 1;
      if (nextAttempt > MAX_RETRY_ATTEMPTS) {
        logger.info(
          { scheduleId: schedule.id, retryAttempt: latestLog.retryAttempt },
          "Scheduled audit report reached max retry attempts — no further automatic retries",
        );
        continue;
      }

      const delayMs = getRetryDelayMs(latestLog.retryAttempt);
      const eligibleAfter = new Date(latestLog.sentAt.getTime() + delayMs);

      if (new Date() < eligibleAfter) continue;

      logger.info(
        { scheduleId: schedule.id, nextAttempt, delayMs },
        "Auto-retrying failed scheduled audit report",
      );

      await sendScheduledReport(schedule, true, nextAttempt).catch(err => {
        logger.error({ err, scheduleId: schedule.id, nextAttempt }, "Auto-retry of scheduled audit report also failed");
      });
    }
  } catch (err) {
    logger.error({ err }, "Audit report auto-retry run failed");
  }
}

export function initAuditReportScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
  if (retryTask) {
    retryTask.stop();
    retryTask = null;
  }

  scheduledTask = cron.schedule("0 * * * *", runDueReports);
  logger.info("Audit report scheduler registered (runs every hour)");

  retryTask = cron.schedule("*/5 * * * *", runAutoRetries);
  logger.info("Audit report auto-retry scheduler registered (runs every 5 minutes)");
}
