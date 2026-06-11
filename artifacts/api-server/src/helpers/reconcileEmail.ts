import { db, reconciliationRunsTable, reconciliationItemsTable, transactionsTable, settlementsTable, merchantsTable, systemSettingsTable, usersTable, reconciliationEmailLogsTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendMail } from "./mailer";
import { createBulkNotifications } from "./notifications";

function escapeCsv(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function buildRunCsv(runId: number): Promise<string> {
  const items = await db
    .select({
      item: reconciliationItemsTable,
      txUtr: transactionsTable.utr,
      merchantName: merchantsTable.businessName,
    })
    .from(reconciliationItemsTable)
    .leftJoin(transactionsTable, eq(reconciliationItemsTable.transactionId, transactionsTable.id))
    .leftJoin(merchantsTable, eq(reconciliationItemsTable.merchantId, merchantsTable.id))
    .where(eq(reconciliationItemsTable.runId, runId))
    .orderBy(sql`${reconciliationItemsTable.status} ASC, ${reconciliationItemsTable.id} ASC`);

  const settlementIds = items
    .map(i => i.item.settlementId)
    .filter((id): id is number => id !== null);

  const settlements = settlementIds.length > 0
    ? await db
        .select({ id: settlementsTable.id, referenceNumber: settlementsTable.referenceNumber })
        .from(settlementsTable)
        .where(inArray(settlementsTable.id, settlementIds))
    : [];

  const settlementMap = new Map(settlements.map(s => [s.id, s]));

  const headers = ["Item ID", "Merchant", "Status", "Amount", "Transaction UTR", "Settlement Ref", "Matched At"];
  const rows = items.map(({ item, txUtr, merchantName }) => {
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

  return [headers.join(","), ...rows].join("\n");
}

function formatAmount(val: string | number | null | undefined): string {
  const n = Number(val ?? 0);
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function buildSampleCsv(): string {
  const headers = ["Item ID", "Merchant", "Status", "Amount", "Transaction UTR", "Settlement Ref", "Matched At"];
  const now = new Date();
  const fmt = (d: Date) => d.toISOString();
  const rows = [
    [1, "Acme Retail Pvt Ltd",    "matched",   "48500.00", "UTR2024061100001", "REF-20240611-001", fmt(new Date(now.getTime() - 3 * 86400_000))],
    [2, "BlueStar Traders",       "matched",   "29750.00", "UTR2024061100002", "REF-20240611-002", fmt(new Date(now.getTime() - 2 * 86400_000))],
    [3, "NovaPay Solutions",      "matched",   "91200.00", "UTR2024061100003", "REF-20240611-003", fmt(new Date(now.getTime() - 2 * 86400_000))],
    [4, "Sunrise Merchants",      "matched",   "76370.00", "UTR2024061100004", "REF-20240611-004", fmt(new Date(now.getTime() - 1 * 86400_000))],
    [5, "GreenPath Commerce",     "matched",   "12500.00", "UTR2024061100005", "REF-20240611-005", fmt(new Date(now.getTime() - 1 * 86400_000))],
    [6, "Kartik Enterprises",     "unmatched", "18500.00", "",                 "",                 ""],
    [7, "Delta Pay Hub",          "unmatched", "5250.00",  "UTR2024061100007", "",                 ""],
  ];
  const escaped = rows.map(row =>
    row.map(v => escapeCsv(v as string | number)).join(",")
  );
  return [headers.join(","), ...escaped].join("\n");
}

export function buildEmailHtml(run: typeof reconciliationRunsTable.$inferSelect): string {
  const dateRange = `${run.dateFrom} to ${run.dateTo}`;
  const triggeredBy = run.triggeredBy === "auto" ? "Automatic (scheduled)" : "Manual";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #6d28d9; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Reconciliation Report</h1>
      <p style="margin: 4px 0 0; color: #ddd6fe; font-size: 13px;">Run #${run.id} · ${dateRange}</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 14px;">
        A reconciliation run has completed. Here is the summary:
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 50%;">Period</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${dateRange}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Triggered By</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${triggeredBy}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Total Deposits</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${run.totalDeposits ?? 0}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Total Settlements</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${run.totalSettlements ?? 0}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Matched</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #4ade80; font-weight: 600;">
            ${run.totalMatched ?? 0} items · ${formatAmount(run.matchedAmount)}
          </td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Unmatched</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: ${(run.totalUnmatched ?? 0) > 0 ? '#f87171' : '#4ade80'}; font-weight: 600;">
            ${run.totalUnmatched ?? 0} items · ${formatAmount(run.unmatchedAmount)}
          </td>
        </tr>
      </table>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        The full reconciliation report is attached as a CSV file. Log in to the 
        <a href="https://rasokart.com/admin/reconciliation" style="color: #818cf8;">Admin Console</a> 
        for detailed item-level review.
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This is an automated email from RasoKart. To stop receiving these reports, ask your admin to clear the Finance Report Email in Settings.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export function buildUnmatchedAlertHtml(run: typeof reconciliationRunsTable.$inferSelect): string {
  const dateRange = `${run.dateFrom} to ${run.dateTo}`;
  const unmatchedCount = run.totalUnmatched ?? 0;
  const unmatchedAmountFmt = formatAmount(run.unmatchedAmount);
  const matchedCount = run.totalMatched ?? 0;
  const matchedAmountFmt = formatAmount(run.matchedAmount);
  const appDomain = process.env["APP_DOMAIN"] ?? "https://rasokart.com";
  const runLink = `${appDomain}/admin/reconciliation?runId=${run.id}`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #991b1b; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Unmatched Items Alert</h1>
      <p style="margin: 4px 0 0; color: #fecaca; font-size: 13px;">Auto-reconciliation Run #${run.id} · ${dateRange}</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #f87171; font-size: 14px; font-weight: 600;">
        ⚠️ The scheduled auto-reconciliation run found ${unmatchedCount} unmatched item${unmatchedCount === 1 ? "" : "s"} requiring review.
      </p>
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 13px;">
        Please review these discrepancies in the admin portal as soon as possible.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 50%;">Period</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${dateRange}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Total Deposits Checked</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${run.totalDeposits ?? 0}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Total Settlements Checked</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${run.totalSettlements ?? 0}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Matched</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #4ade80; font-weight: 600;">
            ${matchedCount} item${matchedCount === 1 ? "" : "s"} · ${matchedAmountFmt}
          </td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Unmatched</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #f87171; font-weight: 600;">
            ${unmatchedCount} item${unmatchedCount === 1 ? "" : "s"} · ${unmatchedAmountFmt}
          </td>
        </tr>
      </table>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${runLink}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          Review Run #${run.id} in Admin Portal
        </a>
      </div>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        If the link above doesn't work, copy this URL into your browser:<br>
        <span style="color: #818cf8;">${runLink}</span>
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This alert was triggered by the RasoKart scheduled auto-reconciliation job. All active admin accounts receive this notice.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export async function notifyAdminsOfUnmatchedItems(runId: number, opts?: { force?: boolean }): Promise<void> {
  const force = opts?.force ?? false;
  try {
    const [run] = await db
      .select()
      .from(reconciliationRunsTable)
      .where(eq(reconciliationRunsTable.id, runId))
      .limit(1);

    if (!run) {
      logger.warn({ runId }, "Reconciliation run not found for unmatched-items admin alert");
      return;
    }

    if (!force && (run.totalUnmatched ?? 0) === 0) {
      logger.info({ runId }, "No unmatched items — skipping admin unmatched-items alert email");
      return;
    }

    const admins = await db
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(and(
        eq(usersTable.role, "admin"),
        eq(usersTable.isActive, true),
        eq(usersTable.reconciliationAlertEmails, true),
      ));

    if (admins.length === 0) {
      logger.info({ runId }, "No active admins found — skipping unmatched-items alert emails");
      return;
    }

    const html = buildUnmatchedAlertHtml(run);
    const subject = `[RasoKart] ⚠️ Unmatched Items Found — Auto-Reconciliation Run #${runId} (${run.dateFrom} to ${run.dateTo})`;
    const recipientList = admins.map(a => a.email).join(", ");

    const results = await Promise.allSettled(
      admins.map(admin =>
        sendMail({ to: admin.email, subject, html })
      )
    );

    const sent = results.filter(r => r.status === "fulfilled" && r.value).length;
    const failed = results.length - sent;

    const overallStatus = failed === results.length ? "failed" : "sent";
    const firstError = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    const errorMessage = firstError ? String(firstError.reason) : (failed > 0 ? `${failed} of ${results.length} recipients failed` : null);

    await db.insert(reconciliationEmailLogsTable).values({
      runId,
      emailType: "unmatched_alert",
      recipients: recipientList,
      status: overallStatus,
      errorMessage,
    });

    if (overallStatus === "failed") {
      try {
        await createBulkNotifications(admins.map(a => ({
          userId: a.id,
          type: "reconciliation_email_failure" as const,
          title: "Reconciliation Alert Email Failed",
          body: `The unmatched-items alert email for reconciliation run #${runId} (${run.dateFrom} to ${run.dateTo}) could not be delivered. Open the run to review the email log and use the Resend button.`,
          metadata: { runId, recipients: recipientList, error: errorMessage },
        })));

        logger.info({ runId, adminCount: admins.length }, "Admin notifications sent for unmatched-alert email failure");
      } catch (notifyErr) {
        logger.error({ err: notifyErr, runId }, "Failed to insert admin notifications for unmatched-alert email failure");
      }
    }

    logger.info(
      { runId, totalAdmins: admins.length, sent, failed },
      "Admin unmatched-items alert emails dispatched"
    );
  } catch (err) {
    logger.error({ err, runId }, "Failed to send admin unmatched-items alert emails");

    try {
      await db.insert(reconciliationEmailLogsTable).values({
        runId,
        emailType: "unmatched_alert",
        recipients: "",
        status: "failed",
        errorMessage: String(err),
      });
    } catch (logErr) {
      logger.error({ logErr, runId }, "Failed to write email log for unmatched-items alert");
    }

    try {
      const allAdmins = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)));

      if (allAdmins.length > 0) {
        await createBulkNotifications(allAdmins.map(a => ({
          userId: a.id,
          type: "reconciliation_email_failure" as const,
          title: "Reconciliation Alert Email Failed",
          body: `The unmatched-items alert email for reconciliation run #${runId} could not be sent. Open the run to review the email log and use the Resend button.`,
          metadata: { runId, error: String(err) },
        })));

        logger.info({ runId, adminCount: allAdmins.length }, "Admin notifications sent for unmatched-alert email dispatch failure");
      }
    } catch (notifyErr) {
      logger.error({ err: notifyErr, runId }, "Failed to insert admin notifications after unmatched-alert email dispatch failure");
    }
  }
}

export async function sendReconciliationReportEmail(runId: number): Promise<void> {
  try {
    const settingRow = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, "finance_report_email"))
      .limit(1);

    const rawValue = settingRow[0]?.value ?? null;
    if (!rawValue) {
      logger.info({ runId }, "No finance_report_email configured — skipping reconciliation report email");
      return;
    }

    const recipients = rawValue
      .split(",")
      .map(e => e.trim())
      .filter(e => e.length > 0);

    if (recipients.length === 0) {
      logger.info({ runId }, "finance_report_email is blank — skipping reconciliation report email");
      return;
    }

    const [run] = await db
      .select()
      .from(reconciliationRunsTable)
      .where(eq(reconciliationRunsTable.id, runId))
      .limit(1);

    if (!run) {
      logger.warn({ runId }, "Reconciliation run not found for email report");
      return;
    }

    const csv = await buildRunCsv(runId);
    const html = buildEmailHtml(run);
    const filename = `reconciliation-run-${runId}-${run.dateFrom}-to-${run.dateTo}.csv`;
    const subject = `[RasoKart] Reconciliation Report — Run #${runId} (${run.dateFrom} to ${run.dateTo})`;

    const [primaryRecipient, ...ccRecipients] = recipients;

    try {
      await sendMail({
        to: primaryRecipient,
        ...(ccRecipients.length > 0 ? { cc: ccRecipients.join(", ") } : {}),
        subject,
        html,
        attachments: [{ filename, content: csv, contentType: "text/csv" }],
      });

      await db.insert(reconciliationEmailLogsTable).values({
        runId,
        emailType: "report",
        recipients: recipients.join(", "),
        status: "sent",
        errorMessage: null,
      });

      logger.info({ runId, recipients }, "Reconciliation report email sent");
    } catch (sendErr) {
      await db.insert(reconciliationEmailLogsTable).values({
        runId,
        emailType: "report",
        recipients: recipients.join(", "),
        status: "failed",
        errorMessage: String(sendErr),
      });

      logger.error({ err: sendErr, runId }, "Failed to send reconciliation report email");

      try {
        const admins = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)));

        if (admins.length > 0) {
          await createBulkNotifications(admins.map(a => ({
            userId: a.id,
            type: "reconciliation_email_failure" as const,
            title: "Reconciliation Report Email Failed",
            body: `The report email for reconciliation run #${runId} (${run.dateFrom} to ${run.dateTo}) could not be delivered to the configured recipients. Check the email logs for details.`,
            metadata: { runId, recipients: recipients.join(", "), error: String(sendErr) },
          })));

          logger.info({ runId, adminCount: admins.length }, "Admin notifications sent for reconciliation report email failure");
        }
      } catch (notifyErr) {
        logger.error({ err: notifyErr, runId }, "Failed to insert admin notifications for reconciliation report email failure");
      }
    }
  } catch (err) {
    logger.error({ err, runId }, "Failed to send reconciliation report email");
  }
}
