/**
 * Delivery success-rate alert scheduler.
 *
 * Runs every 6 hours and examines every active merchant report schedule.
 * For each schedule that has had at least MIN_DELIVERIES attempts in the
 * rolling 7-day window, it computes the success rate.  When the rate drops
 * below the configurable threshold (system_settings key
 * "delivery_success_rate_alert_threshold", default 50 %) one in-app
 * notification is created per active admin user.
 *
 * De-duplication is enforced atomically at the DB level via the partial unique
 * index `notifications_delivery_rate_alert_dedup_idx`.  The dedup key is
 * "rate_alert_<scheduleId>_<YYYY-MM-DD>" (today's UTC date), giving a ~24 h
 * cool-down window.  onConflictDoNothing() makes concurrent runs (startup
 * sweep + cron) safe.
 *
 * An optional email is also sent to all active admin email addresses when the
 * threshold is breached for the first time on a given calendar day.
 */

import cron from "node-cron";
import {
  db,
  reportDeliveryLogsTable,
  reportSchedulesTable,
  merchantsTable,
  usersTable,
  notificationsTable,
  systemSettingsTable,
} from "@workspace/db";
import { eq, and, gte, inArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendMail } from "./mailer";

const APP_DOMAIN = process.env["APP_DOMAIN"] ?? "https://rasokart.com";

const DEFAULT_THRESHOLD_PCT = 50;
const MIN_DELIVERIES = 2;

export interface DeliveryRateAlertScanResult {
  schedulesChecked: number;
  belowThreshold: number;
  notificationsInserted: number;
  adminCount: number;
}

async function getThreshold(): Promise<number> {
  try {
    const [row] = await db
      .select({ value: systemSettingsTable.value })
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, "delivery_success_rate_alert_threshold"))
      .limit(1);
    if (!row?.value) return DEFAULT_THRESHOLD_PCT;
    const parsed = parseInt(row.value, 10);
    return isNaN(parsed) ? DEFAULT_THRESHOLD_PCT : Math.max(0, Math.min(100, parsed));
  } catch {
    return DEFAULT_THRESHOLD_PCT;
  }
}

async function getAdminUsers(): Promise<{ id: number; email: string }[]> {
  return db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)));
}

interface ScheduleRateRow {
  scheduleId: number;
  merchantId: number;
  businessName: string;
  frequency: string;
  successCount: number;
  totalCount: number;
  successRatePct: number;
}

async function computeScheduleRates(): Promise<ScheduleRateRow[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      scheduleId: reportSchedulesTable.id,
      merchantId: reportSchedulesTable.merchantId,
      businessName: merchantsTable.businessName,
      frequency: reportSchedulesTable.frequency,
      successCount: sql<number>`CAST(COUNT(CASE WHEN ${reportDeliveryLogsTable.success} = true AND ${reportDeliveryLogsTable.isAutoPause} = false THEN 1 END) AS INTEGER)`,
      totalCount: sql<number>`CAST(COUNT(CASE WHEN ${reportDeliveryLogsTable.isAutoPause} = false THEN 1 END) AS INTEGER)`,
    })
    .from(reportSchedulesTable)
    .innerJoin(merchantsTable, eq(reportSchedulesTable.merchantId, merchantsTable.id))
    .innerJoin(reportDeliveryLogsTable, eq(reportDeliveryLogsTable.scheduleId, reportSchedulesTable.id))
    .where(
      and(
        eq(reportSchedulesTable.isActive, true),
        gte(reportDeliveryLogsTable.attemptedAt, sevenDaysAgo),
      ),
    )
    .groupBy(
      reportSchedulesTable.id,
      reportSchedulesTable.merchantId,
      merchantsTable.businessName,
      reportSchedulesTable.frequency,
    );

  return rows
    .map(r => ({
      scheduleId: r.scheduleId,
      merchantId: r.merchantId,
      businessName: r.businessName,
      frequency: r.frequency,
      successCount: Number(r.successCount),
      totalCount: Number(r.totalCount),
      successRatePct: Number(r.totalCount) > 0
        ? (Number(r.successCount) / Number(r.totalCount)) * 100
        : 0,
    }))
    .filter(r => r.totalCount >= MIN_DELIVERIES);
}

function buildAlertEmailHtml(
  belowThreshold: ScheduleRateRow[],
  threshold: number,
): string {
  const adminUrl = `${APP_DOMAIN}/admin/reports`;

  const rows = belowThreshold.map((s, i) => {
    const bg = i % 2 === 0 ? "" : ' style="background:#111;"';
    const ratePct = s.successRatePct.toFixed(1);
    const freqLabel = s.frequency.charAt(0).toUpperCase() + s.frequency.slice(1);
    const merchantLink = `${APP_DOMAIN}/admin/merchants/${s.merchantId}`;
    return `
    <tr${bg}>
      <td style="padding:10px 14px;border:1px solid #2a2a2a;font-size:13px;">
        <a href="${merchantLink}" style="color:#818cf8;text-decoration:none;">${escHtml(s.businessName)}</a>
      </td>
      <td style="padding:10px 14px;border:1px solid #2a2a2a;font-size:13px;text-align:center;">${freqLabel}</td>
      <td style="padding:10px 14px;border:1px solid #2a2a2a;font-size:13px;text-align:center;color:#f87171;font-weight:600;">${ratePct}%</td>
      <td style="padding:10px 14px;border:1px solid #2a2a2a;font-size:13px;text-align:center;">${s.successCount} / ${s.totalCount}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#0f0f0f;color:#e5e5e5;margin:0;padding:24px;">
  <div style="max-width:700px;margin:0 auto;background:#1a1a1a;border-radius:8px;overflow:hidden;border:1px solid #2a2a2a;">
    <div style="background:#7f1d1d;padding:20px 24px;">
      <h1 style="margin:0;font-size:20px;color:#fff;">⚠️ Report Delivery Success Rate Alert</h1>
      <p style="margin:4px 0 0;color:#fca5a5;font-size:13px;">
        ${belowThreshold.length} schedule${belowThreshold.length !== 1 ? "s have" : " has"} a 7-day delivery success rate below ${threshold}%
      </p>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px;color:#a1a1aa;font-size:14px;">
        The following report schedules have experienced delivery failures in the past 7 days and are below the configured alert threshold of <strong style="color:#e5e5e5;">${threshold}%</strong>.
        Check SMTP settings and re-enable any paused schedules from the Reports page.
      </p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <thead>
          <tr style="background:#111;">
            <th style="padding:10px 14px;border:1px solid #2a2a2a;color:#a1a1aa;font-size:12px;text-align:left;font-weight:600;">Merchant</th>
            <th style="padding:10px 14px;border:1px solid #2a2a2a;color:#a1a1aa;font-size:12px;text-align:center;font-weight:600;">Frequency</th>
            <th style="padding:10px 14px;border:1px solid #2a2a2a;color:#a1a1aa;font-size:12px;text-align:center;font-weight:600;">7-Day Success Rate</th>
            <th style="padding:10px 14px;border:1px solid #2a2a2a;color:#a1a1aa;font-size:12px;text-align:center;font-weight:600;">Sent / Attempted</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="text-align:center;margin-bottom:20px;">
        <a href="${adminUrl}"
           style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:14px;font-weight:600;">
          Open Reports Dashboard
        </a>
      </div>
      <p style="margin:0;color:#71717a;font-size:12px;text-align:center;">
        Generated: ${new Date().toUTCString()}
      </p>
    </div>
    <div style="padding:14px 24px;background:#111;border-top:1px solid #2a2a2a;">
      <p style="margin:0;color:#52525b;font-size:11px;">
        This alert is sent by RasoKart when a report schedule's 7-day delivery success rate drops below ${threshold}%.
        The threshold can be adjusted in Admin → Settings → System Settings.
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

/**
 * Core scan: compute 7-day delivery success rates for all active schedules.
 * For each schedule below the threshold, notify all active admins (in-app +
 * email).  Duplicate alerts within the same calendar day are suppressed by the
 * dedup index.
 */
export async function runDeliverySuccessRateAlertScan(): Promise<DeliveryRateAlertScanResult> {
  const [threshold, adminUsers, scheduleRates] = await Promise.all([
    getThreshold(),
    getAdminUsers(),
    computeScheduleRates(),
  ]);

  if (adminUsers.length === 0) {
    logger.info("Delivery success-rate alert scan: no active admin users — skipping");
    return { schedulesChecked: scheduleRates.length, belowThreshold: 0, notificationsInserted: 0, adminCount: 0 };
  }

  const belowThreshold = scheduleRates.filter(s => s.successRatePct < threshold);

  if (belowThreshold.length === 0) {
    logger.info(
      { schedulesChecked: scheduleRates.length, thresholdPct: threshold },
      "Delivery success-rate alert scan: all schedules are above threshold",
    );
    return { schedulesChecked: scheduleRates.length, belowThreshold: 0, notificationsInserted: 0, adminCount: adminUsers.length };
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  let totalInserted = 0;

  for (const schedule of belowThreshold) {
    const dedupeKey = `rate_alert_${schedule.scheduleId}_${todayStr}`;
    const ratePct = schedule.successRatePct.toFixed(1);
    const freqLabel = schedule.frequency.charAt(0).toUpperCase() + schedule.frequency.slice(1);

    const notificationRows = adminUsers.map(admin => ({
      userId: admin.id,
      type: "report_delivery_low_success_rate" as const,
      title: "Low Report Delivery Success Rate",
      body: `${schedule.businessName}'s ${freqLabel.toLowerCase()} report schedule has a 7-day delivery success rate of ${ratePct}%, below the ${threshold}% alert threshold (${schedule.successCount} of ${schedule.totalCount} deliveries succeeded). Check SMTP settings and review the schedule on the Reports page.`,
      metadata: {
        scheduleId: schedule.scheduleId,
        merchantId: schedule.merchantId,
        businessName: schedule.businessName,
        frequency: schedule.frequency,
        successRatePct: Number(ratePct),
        successCount: schedule.successCount,
        totalCount: schedule.totalCount,
        thresholdPct: threshold,
        dedupeKey,
        target: `/admin/merchants/${schedule.merchantId}`,
      },
    }));

    const inserted = await db
      .insert(notificationsTable)
      .values(notificationRows)
      .onConflictDoNothing()
      .returning({ id: notificationsTable.id });

    const insertedCount = inserted.length;
    totalInserted += insertedCount;

    if (insertedCount > 0) {
      logger.warn(
        {
          scheduleId: schedule.scheduleId,
          merchantId: schedule.merchantId,
          businessName: schedule.businessName,
          successRatePct: ratePct,
          successCount: schedule.successCount,
          totalCount: schedule.totalCount,
          thresholdPct: threshold,
          adminsNotified: insertedCount,
          dedupeKey,
        },
        "Delivery success-rate alert: notified admins",
      );
    }
  }

  if (totalInserted > 0) {
    const adminEmails = adminUsers.map(a => a.email).filter(Boolean);
    if (adminEmails.length > 0) {
      const subject = `[RasoKart] ⚠️ Report Delivery Alert — ${belowThreshold.length} schedule${belowThreshold.length !== 1 ? "s" : ""} below ${threshold}% success rate`;
      const html = buildAlertEmailHtml(belowThreshold, threshold);

      await Promise.allSettled(
        adminEmails.map(email =>
          sendMail({ to: email, subject, html }).catch(err => {
            logger.error({ err, email }, "Delivery success-rate alert email failed");
          }),
        ),
      );
    }
  }

  logger.info(
    {
      schedulesChecked: scheduleRates.length,
      belowThreshold: belowThreshold.length,
      notificationsInserted: totalInserted,
      adminCount: adminUsers.length,
      thresholdPct: threshold,
    },
    "Delivery success-rate alert scan complete",
  );

  return {
    schedulesChecked: scheduleRates.length,
    belowThreshold: belowThreshold.length,
    notificationsInserted: totalInserted,
    adminCount: adminUsers.length,
  };
}

export function initDeliverySuccessRateAlertScheduler(): void {
  cron.schedule("0 */6 * * *", async () => {
    try {
      await runDeliverySuccessRateAlertScan();
    } catch (err) {
      logger.error({ err }, "Delivery success-rate alert scheduler failed");
    }
  });

  logger.info("Delivery success-rate alert scheduler initialized (every 6 hours)");
}
