import cron, { type ScheduledTask } from "node-cron";
import XLSX from "xlsx";
import PDFDocument from "pdfkit";
import { db, reportSchedulesTable, reportDeliveryLogsTable, transactionsTable, merchantsTable, merchantConnectionsTable, ledgerEntriesTable, settlementsTable, usersTable } from "@workspace/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendMail } from "./mailer";
import { createNotification, createBulkNotifications } from "./notifications";
import { notifyAdminsOfReportScheduleAutoPaused } from "./adminNotifyEmail";

let scheduledTask: ScheduledTask | null = null;

function fmt(amount: number): string {
  return amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getDateRange(frequency: string): { dateFrom: Date; dateTo: Date } {
  const now = new Date();
  const dateTo = new Date(now);
  const daysBack = frequency === "weekly" ? 7 : 30;
  const dateFrom = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  return { dateFrom, dateTo };
}

function isDue(schedule: typeof reportSchedulesTable.$inferSelect, lastSentAt: Date | null): boolean {
  const now = new Date();

  // Admin override: if nextRunAt is set and in the past, it's due regardless of cadence
  if (schedule.nextRunAt != null) {
    return now >= schedule.nextRunAt;
  }

  if (schedule.frequency === "weekly") {
    if (schedule.dayOfWeek != null) {
      // Must be the configured day of week (even for first-ever send)
      if (now.getDay() !== schedule.dayOfWeek) return false;
      if (!lastSentAt) return true;
      // Prevent double-sends within the same week
      const diffDays = (now.getTime() - lastSentAt.getTime()) / (1000 * 60 * 60 * 24);
      return diffDays >= 6;
    }
    // Rolling 7-day cadence
    if (!lastSentAt) return true;
    const diffDays = (now.getTime() - lastSentAt.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays >= 6.9;
  } else {
    if (schedule.dayOfMonth != null) {
      // Must be the configured day of month (even for first-ever send)
      if (now.getDate() !== schedule.dayOfMonth) return false;
      if (!lastSentAt) return true;
      // Prevent double-sends within the same month
      const diffDays = (now.getTime() - lastSentAt.getTime()) / (1000 * 60 * 60 * 24);
      return diffDays >= 27;
    }
    // Rolling 30-day cadence
    if (!lastSentAt) return true;
    const diffDays = (now.getTime() - lastSentAt.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays >= 28;
  }
}

type TxRow = {
  id: number;
  utr: string;
  referenceId: string | null;
  type: string;
  status: string;
  amount: number;
  fee: number;
  currency: string;
  settlementStatus: string;
  connectionProvider: string | null;
  qrCodeId: number | null;
  virtualAccountId: number | null;
  paymentLinkId: number | null;
  description: string | null;
  createdAt: Date;
};

type Stats = {
  depositVolume: number;
  withdrawalVolume: number;
  successCount: number;
  failedCount: number;
  pendingCount: number;
  totalFees: number;
};

async function fetchReportData(merchantId: number, dateFrom: Date, dateTo: Date): Promise<{ transactions: TxRow[]; stats: Stats }> {
  const conditions = [
    eq(transactionsTable.merchantId, merchantId),
    gte(transactionsTable.createdAt, dateFrom),
    lte(transactionsTable.createdAt, dateTo),
  ];
  const where = and(...conditions);

  const [aggRows, rows] = await Promise.all([
    db.select({
      depositVolume: sql<string>`COALESCE(SUM(CASE WHEN ${transactionsTable.type} = 'deposit' THEN CAST(${transactionsTable.amount} AS DECIMAL) ELSE 0 END), 0)`,
      withdrawalVolume: sql<string>`COALESCE(SUM(CASE WHEN ${transactionsTable.type} = 'withdrawal' THEN CAST(${transactionsTable.amount} AS DECIMAL) ELSE 0 END), 0)`,
      successCount: sql<number>`CAST(COUNT(CASE WHEN ${transactionsTable.status} = 'success' THEN 1 END) AS INTEGER)`,
      failedCount: sql<number>`CAST(COUNT(CASE WHEN ${transactionsTable.status} = 'failed' THEN 1 END) AS INTEGER)`,
      pendingCount: sql<number>`CAST(COUNT(CASE WHEN ${transactionsTable.status} = 'pending' THEN 1 END) AS INTEGER)`,
      totalFees: sql<string>`COALESCE(SUM((SELECT COALESCE(ABS(SUM(CAST(le.amount AS DECIMAL))), 0) FROM ledger_entries le WHERE le.reference_type = 'transaction' AND le.reference_id = ${transactionsTable.id} AND le.type = 'fee')), 0)`,
    }).from(transactionsTable).where(where),
    db.select({
      transaction: transactionsTable,
      connectionProvider: merchantConnectionsTable.provider,
      fee: sql<string>`COALESCE((SELECT ABS(SUM(CAST(le.amount AS DECIMAL))) FROM ${ledgerEntriesTable} le WHERE le.reference_type = 'transaction' AND le.reference_id = ${transactionsTable.id} AND le.type = 'fee'), 0)`,
      settlementStatus: sql<string>`COALESCE((SELECT s.status FROM ${settlementsTable} s WHERE s.merchant_id = ${transactionsTable.merchantId} AND s.period_from IS NOT NULL AND s.period_to IS NOT NULL AND s.period_from <= ${transactionsTable.createdAt}::date AND s.period_to >= ${transactionsTable.createdAt}::date AND s.status IN ('paid', 'approved', 'processing') ORDER BY s.created_at DESC LIMIT 1), 'unsettled')`,
    }).from(transactionsTable)
      .leftJoin(merchantConnectionsTable, eq(transactionsTable.connectionId, merchantConnectionsTable.id))
      .where(where)
      .limit(10000)
      .orderBy(sql`${transactionsTable.createdAt} DESC`),
  ]);

  const agg = aggRows[0];
  const stats: Stats = {
    depositVolume: Number(agg?.depositVolume ?? 0),
    withdrawalVolume: Number(agg?.withdrawalVolume ?? 0),
    successCount: Number(agg?.successCount ?? 0),
    failedCount: Number(agg?.failedCount ?? 0),
    pendingCount: Number(agg?.pendingCount ?? 0),
    totalFees: Number(agg?.totalFees ?? 0),
  };

  const transactions: TxRow[] = rows.map(r => ({
    id: r.transaction.id,
    utr: r.transaction.utr,
    referenceId: r.transaction.referenceId ?? null,
    type: r.transaction.type,
    status: r.transaction.status,
    amount: Number(r.transaction.amount),
    fee: Number(r.fee ?? 0),
    currency: r.transaction.currency,
    settlementStatus: r.settlementStatus ?? "unsettled",
    connectionProvider: r.connectionProvider ?? null,
    qrCodeId: r.transaction.qrCodeId ?? null,
    virtualAccountId: r.transaction.virtualAccountId ?? null,
    paymentLinkId: r.transaction.paymentLinkId ?? null,
    description: r.transaction.description ?? null,
    createdAt: r.transaction.createdAt,
  }));

  return { transactions, stats };
}

function buildXlsx(transactions: TxRow[], stats: Stats, dateFrom: Date, dateTo: Date, frequency: string): Buffer {
  const wb = XLSX.utils.book_new();

  const periodLabel = `${dateFrom.toISOString().slice(0, 10)} to ${dateTo.toISOString().slice(0, 10)}`;
  const generatedAt = new Date().toISOString().slice(0, 16).replace("T", " ");

  const summaryRows = [
    ["RasoKart — Transaction Report"],
    [`Generated: ${generatedAt} UTC`],
    [`Period: ${periodLabel}`],
    [`Frequency: ${frequency.charAt(0).toUpperCase() + frequency.slice(1)}`],
    [],
    ["Summary"],
    ["Total Transactions", transactions.length],
    ["Deposit Volume (₹)", stats.depositVolume],
    ["Withdrawal Volume (₹)", stats.withdrawalVolume],
    ["Total Fees (₹)", stats.totalFees],
    ["Successful", stats.successCount],
    ["Failed", stats.failedCount],
    ["Pending", stats.pendingCount],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
  ws1["!cols"] = [{ wch: 28 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Summary");

  const txRows = [
    ["Date", "UTR", "Reference ID", "Type", "Status", "Settlement Status", "Amount (₹)", "Fee (₹)", "Currency", "Source", "Provider", "Description"],
    ...transactions.map(t => {
      const src = t.qrCodeId ? "QR Code" : t.virtualAccountId ? "Virtual Account" : t.paymentLinkId ? "Payment Link" : "Direct";
      return [
        new Date(t.createdAt).toISOString().slice(0, 16).replace("T", " "),
        t.utr,
        t.referenceId ?? "",
        t.type,
        t.status,
        t.settlementStatus,
        t.amount,
        t.fee,
        t.currency,
        src,
        t.connectionProvider ?? "",
        t.description ?? "",
      ];
    }),
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(txRows);
  ws2["!cols"] = [{ wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Transactions");

  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

function buildPdf(transactions: TxRow[], stats: Stats, dateFrom: Date, dateTo: Date, frequency: string, businessName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4", layout: "landscape" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const periodLabel = `${dateFrom.toISOString().slice(0, 10)} to ${dateTo.toISOString().slice(0, 10)}`;
    const freqLabel = frequency.charAt(0).toUpperCase() + frequency.slice(1);

    doc.fontSize(18).font("Helvetica-Bold").text("RasoKart — Transaction Report", { align: "left" });
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica").fillColor("#666")
      .text(`Merchant: ${businessName}   |   Period: ${periodLabel}   |   Frequency: ${freqLabel}   |   Generated: ${new Date().toISOString().slice(0, 16)} UTC`);
    doc.moveDown(0.5);

    doc.fillColor("#000").fontSize(12).font("Helvetica-Bold").text("Summary");
    doc.moveDown(0.3);

    const summaryData: [string, string][] = [
      ["Total Transactions", transactions.length.toLocaleString("en-IN")],
      ["Deposit Volume", `₹${fmt(stats.depositVolume)}`],
      ["Withdrawal Volume", `₹${fmt(stats.withdrawalVolume)}`],
      ["Total Fees", `₹${fmt(stats.totalFees)}`],
      ["Successful", stats.successCount.toString()],
      ["Failed", stats.failedCount.toString()],
      ["Pending", stats.pendingCount.toString()],
    ];

    doc.fontSize(9).font("Helvetica");
    for (const [label, value] of summaryData) {
      doc.text(`${label}: ${value}`, { continued: false });
    }

    doc.moveDown(0.8);
    doc.fontSize(12).font("Helvetica-Bold").text("Transactions");
    doc.moveDown(0.3);

    const colWidths = [80, 110, 50, 50, 60, 65, 60, 40, 70];
    const headers = ["Date", "UTR", "Type", "Status", "Settlement", "Amount (₹)", "Fee (₹)", "Source", "Provider"];
    const pageWidth = doc.page.width - 80;
    let x = 40;

    doc.fontSize(8).font("Helvetica-Bold").fillColor("#333");
    for (let i = 0; i < headers.length; i++) {
      doc.text(headers[i]!, x, doc.y, { width: colWidths[i], lineBreak: false });
      x += colWidths[i]!;
    }
    doc.moveDown(0.2);

    const lineY = doc.y;
    doc.moveTo(40, lineY).lineTo(40 + pageWidth, lineY).stroke("#ccc");
    doc.moveDown(0.1);

    doc.fontSize(7).font("Helvetica").fillColor("#000");

    for (const t of transactions.slice(0, 500)) {
      if (doc.y > doc.page.height - 60) {
        doc.addPage();
        x = 40;
        doc.fontSize(8).font("Helvetica-Bold").fillColor("#333");
        for (let i = 0; i < headers.length; i++) {
          doc.text(headers[i]!, x, doc.y, { width: colWidths[i], lineBreak: false });
          x += colWidths[i]!;
        }
        doc.moveDown(0.2);
        doc.fontSize(7).font("Helvetica").fillColor("#000");
      }

      const src = t.qrCodeId ? "QR" : t.virtualAccountId ? "VA" : t.paymentLinkId ? "Link" : "Direct";
      const rowY = doc.y;
      x = 40;
      const rowData = [
        new Date(t.createdAt).toISOString().slice(0, 16).replace("T", " "),
        t.utr,
        t.type,
        t.status,
        t.settlementStatus,
        fmt(t.amount),
        fmt(t.fee),
        src,
        t.connectionProvider ?? "",
      ];

      for (let i = 0; i < rowData.length; i++) {
        doc.text(String(rowData[i]), x, rowY, { width: colWidths[i], lineBreak: false, ellipsis: true });
        x += colWidths[i]!;
      }
      doc.moveDown(0.35);
    }

    if (transactions.length > 500) {
      doc.moveDown(0.5).fontSize(8).fillColor("#666")
        .text(`... and ${(transactions.length - 500).toLocaleString("en-IN")} more transactions. Use the Excel format for the full dataset.`);
    }

    doc.end();
  });
}

function buildEmailHtml(
  businessName: string,
  frequency: string,
  format: string,
  dateFrom: Date,
  dateTo: Date,
  stats: Stats,
  txCount: number,
): string {
  const periodLabel = `${dateFrom.toISOString().slice(0, 10)} to ${dateTo.toISOString().slice(0, 10)}`;
  const freqLabel = frequency.charAt(0).toUpperCase() + frequency.slice(1);
  const appDomain = process.env["APP_DOMAIN"] ?? "https://rasokart.com";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 620px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #6d28d9; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — ${freqLabel} Transaction Report</h1>
      <p style="margin: 4px 0 0; color: #ddd6fe; font-size: 13px;">${periodLabel}</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #a1a1aa; font-size: 14px;">
        Hi <strong style="color:#e5e5e5">${businessName}</strong>, your ${freqLabel.toLowerCase()} transaction report is attached as ${format === "xlsx" ? "an Excel (.xlsx)" : "a PDF"} file.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 45%;">Period</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${periodLabel}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Total Transactions</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${txCount.toLocaleString("en-IN")}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Deposit Volume</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600; color: #34d399;">₹${fmt(stats.depositVolume)}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Withdrawal Volume</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600; color: #fb923c;">₹${fmt(stats.withdrawalVolume)}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Total Fees</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600; color: #a78bfa;">₹${fmt(stats.totalFees)}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Successful / Failed / Pending</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">
            <span style="color:#34d399">${stats.successCount}</span> /
            <span style="color:#f87171">${stats.failedCount}</span> /
            <span style="color:#fbbf24">${stats.pendingCount}</span>
          </td>
        </tr>
      </table>
      <p style="margin: 0 0 16px; color: #71717a; font-size: 12px;">
        Log in to <a href="${appDomain}/merchant/reports" style="color: #818cf8;">your reports page</a> to filter, explore, or adjust your schedule.
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This is an automated ${freqLabel.toLowerCase()} report from RasoKart. To stop receiving these reports, visit your Reports page and turn off the schedule.
      </p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Handles a delivery failure for a report schedule:
 * - Increments consecutiveFailures in the DB
 * - Auto-pauses the schedule when the threshold is reached
 * - Creates an in-app notification for the merchant's user
 * - Writes delivery log rows for the failure (and auto-pause if triggered)
 */
async function handleReportFailure(
  schedule: typeof reportSchedulesTable.$inferSelect,
  failureReason?: string,
): Promise<void> {
  const newConsecutiveFailures = schedule.consecutiveFailures + 1;
  const shouldAutoPause = newConsecutiveFailures >= schedule.autoPauseAfterFailures;

  if (shouldAutoPause) {
    await db.update(reportSchedulesTable)
      .set({ consecutiveFailures: newConsecutiveFailures, isActive: false, updatedAt: new Date() })
      .where(eq(reportSchedulesTable.id, schedule.id));
    logger.warn(
      { scheduleId: schedule.id, merchantId: schedule.merchantId, consecutiveFailures: newConsecutiveFailures, autoPauseAfterFailures: schedule.autoPauseAfterFailures },
      "Merchant report schedule auto-paused after repeated delivery failures",
    );
  } else {
    await db.update(reportSchedulesTable)
      .set({ consecutiveFailures: newConsecutiveFailures, updatedAt: new Date() })
      .where(eq(reportSchedulesTable.id, schedule.id));
  }

  await db.insert(reportDeliveryLogsTable).values({
    scheduleId: schedule.id,
    merchantId: schedule.merchantId,
    success: false,
    failureReason: failureReason ?? null,
    isAutoPause: false,
    frequency: schedule.frequency,
    format: schedule.format,
  });

  if (shouldAutoPause) {
    await db.insert(reportDeliveryLogsTable).values({
      scheduleId: schedule.id,
      merchantId: schedule.merchantId,
      success: false,
      failureReason: `Schedule auto-paused after ${newConsecutiveFailures} consecutive delivery failures.`,
      isAutoPause: true,
      frequency: schedule.frequency,
      format: schedule.format,
    });
  }

  const [merchantUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.merchantId, schedule.merchantId))
    .limit(1);

  const freqLabel = schedule.frequency.charAt(0).toUpperCase() + schedule.frequency.slice(1);
  const appDomain = process.env["APP_DOMAIN"] ?? "https://rasokart.com";
  const smtpSettingsUrl = `${appDomain}/admin/settings`;

  if (merchantUser) {
    if (shouldAutoPause) {
      await createNotification({
        userId: merchantUser.id,
        type: "scheduled_report_auto_paused",
        title: "Scheduled Report Auto-Paused",
        body: `Your ${freqLabel.toLowerCase()} transaction report schedule has been automatically paused after ${schedule.autoPauseAfterFailures} consecutive delivery failures. This is typically caused by an SMTP misconfiguration on the platform. Please contact your platform administrator to check the SMTP settings at ${smtpSettingsUrl}, then re-enable the schedule from your Reports page.`,
        metadata: { scheduleId: schedule.id, frequency: schedule.frequency, consecutiveFailures: newConsecutiveFailures, autoPauseAfterFailures: schedule.autoPauseAfterFailures, smtpSettingsUrl },
      });
    } else {
      await createNotification({
        userId: merchantUser.id,
        type: "scheduled_report_failure",
        title: "Scheduled Report Delivery Failed",
        body: `Your ${freqLabel.toLowerCase()} transaction report could not be delivered (attempt ${newConsecutiveFailures} of ${schedule.autoPauseAfterFailures}). This is typically caused by an SMTP misconfiguration — please contact your platform administrator to verify the SMTP settings at ${smtpSettingsUrl}. The schedule will be automatically paused after ${schedule.autoPauseAfterFailures} consecutive failures.`,
        metadata: { scheduleId: schedule.id, frequency: schedule.frequency, consecutiveFailures: newConsecutiveFailures, autoPauseAfterFailures: schedule.autoPauseAfterFailures, smtpSettingsUrl },
      });
    }
  }

  if (shouldAutoPause) {
    const [merchantInfo] = await db
      .select({ businessName: merchantsTable.businessName })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, schedule.merchantId))
      .limit(1);

    const merchantName = merchantInfo?.businessName ?? `Merchant #${schedule.merchantId}`;

    const adminUsers = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)));

    if (adminUsers.length > 0) {
      await createBulkNotifications(adminUsers.map((admin) => ({
        userId: admin.id,
        type: "report_schedule_auto_paused_admin" as const,
        title: "Report Schedule Auto-Paused",
        body: `${merchantName}'s ${freqLabel.toLowerCase()} report schedule was automatically paused after ${newConsecutiveFailures} consecutive delivery failures. This typically indicates an SMTP misconfiguration. Check SMTP settings and re-enable the schedule from the Reports page.`,
        metadata: {
          scheduleId: schedule.id,
          merchantId: schedule.merchantId,
          merchantName,
          frequency: schedule.frequency,
          consecutiveFailures: newConsecutiveFailures,
        },
      })));
    }

    await notifyAdminsOfReportScheduleAutoPaused({
      merchantId: schedule.merchantId,
      merchantName,
      frequency: schedule.frequency,
      consecutiveFailures: newConsecutiveFailures,
      autoPauseAfterFailures: schedule.autoPauseAfterFailures,
    });
  }
}

export async function sendMerchantReport(
  schedule: typeof reportSchedulesTable.$inferSelect,
  merchantEmail: string,
  businessName: string,
): Promise<boolean> {
  const { dateFrom, dateTo } = getDateRange(schedule.frequency);

  try {
    const { transactions, stats } = await fetchReportData(schedule.merchantId, dateFrom, dateTo);

    let attachment: { filename: string; content: Buffer; contentType: string };

    if (schedule.format === "pdf") {
      const pdfBuf = await buildPdf(transactions, stats, dateFrom, dateTo, schedule.frequency, businessName);
      const periodStr = `${dateFrom.toISOString().slice(0, 10)}-to-${dateTo.toISOString().slice(0, 10)}`;
      attachment = {
        filename: `rasokart-report-${schedule.frequency}-${periodStr}.pdf`,
        content: pdfBuf,
        contentType: "application/pdf",
      };
    } else {
      const xlsBuf = buildXlsx(transactions, stats, dateFrom, dateTo, schedule.frequency);
      const periodStr = `${dateFrom.toISOString().slice(0, 10)}-to-${dateTo.toISOString().slice(0, 10)}`;
      attachment = {
        filename: `rasokart-report-${schedule.frequency}-${periodStr}.xlsx`,
        content: xlsBuf,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    }

    const subject = `[RasoKart] ${schedule.frequency.charAt(0).toUpperCase() + schedule.frequency.slice(1)} Transaction Report — ${dateFrom.toISOString().slice(0, 10)} to ${dateTo.toISOString().slice(0, 10)}`;
    const html = buildEmailHtml(businessName, schedule.frequency, schedule.format, dateFrom, dateTo, stats, transactions.length);

    const sent = await sendMail({ to: merchantEmail, subject, html, attachments: [attachment] });

    if (sent) {
      await db.update(reportSchedulesTable)
        .set({ lastSentAt: new Date(), consecutiveFailures: 0, nextRunAt: null, updatedAt: new Date() })
        .where(eq(reportSchedulesTable.id, schedule.id));
      await db.insert(reportDeliveryLogsTable).values({
        scheduleId: schedule.id,
        merchantId: schedule.merchantId,
        success: true,
        failureReason: null,
        isAutoPause: false,
        frequency: schedule.frequency,
        format: schedule.format,
      });
      logger.info({ scheduleId: schedule.id, merchantId: schedule.merchantId, txCount: transactions.length }, "Merchant report emailed successfully");
    } else {
      logger.warn({ scheduleId: schedule.id, merchantId: schedule.merchantId }, "Failed to send merchant report email");
      await handleReportFailure(schedule, "Email delivery failed — SMTP returned an error.").catch(notifyErr => {
        logger.error({ err: notifyErr, scheduleId: schedule.id, merchantId: schedule.merchantId }, "Failed to handle merchant report failure");
      });
    }

    return sent;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ err, scheduleId: schedule.id, merchantId: schedule.merchantId }, "Error sending merchant report");
    await handleReportFailure(schedule, reason).catch(notifyErr => {
      logger.error({ err: notifyErr, scheduleId: schedule.id, merchantId: schedule.merchantId }, "Failed to handle merchant report failure after exception");
    });
    return false;
  }
}

async function runDueReports(): Promise<void> {
  try {
    // Join directly to merchants (canonical email source) — one row per schedule,
    // avoids duplicate sends when a merchant has multiple active users.
    const active = await db
      .select({
        schedule: reportSchedulesTable,
        email: merchantsTable.email,
        businessName: merchantsTable.businessName,
      })
      .from(reportSchedulesTable)
      .innerJoin(merchantsTable, eq(reportSchedulesTable.merchantId, merchantsTable.id))
      .where(eq(reportSchedulesTable.isActive, true));

    for (const row of active) {
      const { schedule, email, businessName } = row;
      if (!email || !businessName) continue;
      // Re-fetch to get the latest consecutiveFailures, autoPauseAfterFailures, lastSentAt, and nextRunAt
      // after previous iterations may have updated them
      const [fresh] = await db
        .select({
          lastSentAt: reportSchedulesTable.lastSentAt,
          consecutiveFailures: reportSchedulesTable.consecutiveFailures,
          autoPauseAfterFailures: reportSchedulesTable.autoPauseAfterFailures,
          nextRunAt: reportSchedulesTable.nextRunAt,
        })
        .from(reportSchedulesTable)
        .where(eq(reportSchedulesTable.id, schedule.id))
        .limit(1);
      // Merge fresh nextRunAt into schedule before isDue check
      const scheduleForDueCheck = fresh
        ? { ...schedule, nextRunAt: fresh.nextRunAt }
        : schedule;
      if (!isDue(scheduleForDueCheck, fresh?.lastSentAt ?? schedule.lastSentAt)) continue;

      const freshSchedule = fresh
        ? { ...schedule, consecutiveFailures: fresh.consecutiveFailures, autoPauseAfterFailures: fresh.autoPauseAfterFailures, nextRunAt: fresh.nextRunAt }
        : schedule;

      await sendMerchantReport(freshSchedule, email, businessName).catch(err => {
        logger.error({ err, scheduleId: schedule.id }, "Merchant report scheduler send failed");
      });
    }
  } catch (err) {
    logger.error({ err }, "Merchant report scheduler run failed");
  }
}

export function initMerchantReportScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
  scheduledTask = cron.schedule("0 * * * *", runDueReports);
  logger.info("Merchant report scheduler registered (runs every hour)");
}
