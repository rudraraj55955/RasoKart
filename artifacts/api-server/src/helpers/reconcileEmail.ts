import { db, reconciliationRunsTable, reconciliationItemsTable, transactionsTable, settlementsTable, merchantsTable, systemSettingsTable, usersTable, reconciliationEmailLogsTable } from "@workspace/db";
import { eq, and, inArray, sql, lte, isNull, or } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendMailRich, humanizeMailError } from "./mailer";
import { createBulkNotifications } from "./notifications";

// Maximum automatic retry attempts after the initial send failure
const MAX_EMAIL_RETRIES = 3;

// Exponential backoff delays: 5 min, 15 min, 60 min
const RETRY_DELAYS_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000];

function nextRetryAt(retryCount: number): Date | null {
  const delayMs = RETRY_DELAYS_MS[retryCount] ?? null;
  if (delayMs === null) return null;
  return new Date(Date.now() + delayMs);
}

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
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Status</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600; color: ${run.status === 'complete' ? '#4ade80' : run.status === 'failed' ? '#f87171' : '#60a5fa'};">${run.status.charAt(0).toUpperCase() + run.status.slice(1)}</td>
        </tr>
        <tr style="background: #111;">
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

export type NotifyAdminsResult =
  | { skipped: false }
  | { skipped: true; reason: "no_recipients" };

export async function notifyAdminsOfUnmatchedItems(runId: number): Promise<NotifyAdminsResult> {
  try {
    const [run] = await db
      .select()
      .from(reconciliationRunsTable)
      .where(eq(reconciliationRunsTable.id, runId))
      .limit(1);

    if (!run) {
      logger.warn({ runId }, "Reconciliation run not found for unmatched-items admin alert");
      return { skipped: false };
    }

    if ((run.totalUnmatched ?? 0) === 0) {
      logger.info({ runId }, "No unmatched items — skipping admin unmatched-items alert email");
      return { skipped: false };
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
      return { skipped: true, reason: "no_recipients" };
    }

    const html = buildUnmatchedAlertHtml(run);
    const subject = `[RasoKart] ⚠️ Unmatched Items Found — Auto-Reconciliation Run #${runId} (${run.dateFrom} to ${run.dateTo})`;
    const recipientList = admins.map(a => a.email).join(", ");

    const results = await Promise.allSettled(
      admins.map(admin => sendMailRich({ to: admin.email, subject, html }))
    );

    const sent = results.filter(r => r.status === "fulfilled" && r.value.ok).length;
    const failed = results.length - sent;

    const overallStatus = failed === results.length ? "failed" : "sent";

    // Collect one message ID from successful sends
    const firstSuccess = results.find(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof sendMailRich>>> =>
        r.status === "fulfilled" && r.value.ok
    );
    const providerMessageId = firstSuccess?.value.messageId ?? null;

    // Collect first failure detail
    const firstFailure = results.find(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof sendMailRich>>> =>
        r.status === "fulfilled" && !r.value.ok
    );
    const errorMessage = overallStatus === "failed"
      ? humanizeMailError(firstFailure?.value ?? { ok: false })
      : failed > 0 ? `${failed} of ${results.length} recipients failed` : null;
    const failureCode = firstFailure?.value.code ?? null;

    const idemKey = `unmatched_alert-${runId}-${Date.now()}`;
    const retryAt = overallStatus === "failed" ? nextRetryAt(0) : null;

    await db.insert(reconciliationEmailLogsTable).values({
      runId,
      emailType: "unmatched_alert",
      recipients: recipientList,
      status: overallStatus,
      errorMessage,
      providerMessageId,
      retryCount: 0,
      failureCode,
      retryAt,
      idempotencyKey: idemKey,
    });

    logger.info(
      { runId, totalAdmins: admins.length, sent, failed, providerMessageId },
      "Admin unmatched-items alert emails dispatched"
    );

    return { skipped: false };
  } catch (err) {
    logger.error({ err, runId }, "Failed to send admin unmatched-items alert emails");

    try {
      await db.insert(reconciliationEmailLogsTable).values({
        runId,
        emailType: "unmatched_alert",
        recipients: "",
        status: "failed",
        errorMessage: String(err).slice(0, 500),
        retryCount: 0,
        failureCode: "EXCEPTION",
        retryAt: nextRetryAt(0),
        idempotencyKey: `unmatched_alert-${runId}-${Date.now()}`,
      });
    } catch (logErr) {
      logger.error({ logErr, runId }, "Failed to write email log for unmatched-items alert");
    }

    return { skipped: false };
  }
}

/**
 * Core implementation used by both initial sends and automatic retries.
 * retryCount=0 means this is the first attempt.
 */
async function sendReportEmailCore(runId: number, retryCount: number): Promise<void> {
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

    // Duplicate-send prevention: if a successful send exists in the last 30 seconds, skip
    const cutoff = new Date(Date.now() - 30_000);
    const recentSent = await db
      .select({ id: reconciliationEmailLogsTable.id })
      .from(reconciliationEmailLogsTable)
      .where(and(
        eq(reconciliationEmailLogsTable.runId, runId),
        eq(reconciliationEmailLogsTable.emailType, "report"),
        eq(reconciliationEmailLogsTable.status, "sent"),
      ))
      .limit(1);

    // Only block duplicate if this is the very first attempt (retryCount === 0)
    if (retryCount === 0 && recentSent.length > 0) {
      logger.info({ runId }, "Duplicate send prevented — reconciliation report already sent for this run");
      return;
    }

    const csv = await buildRunCsv(runId);
    const html = buildEmailHtml(run);
    const filename = `reconciliation-run-${runId}-${run.dateFrom}-to-${run.dateTo}.csv`;
    const subject = `[RasoKart] Reconciliation Report — Run #${runId} (${run.dateFrom} to ${run.dateTo})`;
    const [primaryRecipient, ...ccRecipients] = recipients;
    const idemKey = `report-${runId}-attempt-${retryCount}-${Date.now()}`;

    // ── CRITICAL FIX ──────────────────────────────────────────────────────────
    // sendMailRich never throws — it returns { ok: false } on any failure.
    // We MUST check result.ok to determine delivery status, not rely on try/catch.
    const result = await sendMailRich({
      to: primaryRecipient,
      ...(ccRecipients.length > 0 ? { cc: ccRecipients.join(", ") } : {}),
      subject,
      html,
      attachments: [{ filename, content: csv, contentType: "text/csv" }],
    });
    // ─────────────────────────────────────────────────────────────────────────

    const isSent = result.ok;
    const errorMsg = isSent ? null : humanizeMailError(result);
    const retryAt = isSent ? null : nextRetryAt(retryCount);

    await db.insert(reconciliationEmailLogsTable).values({
      runId,
      emailType: "report",
      recipients: recipients.join(", "),
      status: isSent ? "sent" : "failed",
      errorMessage: errorMsg,
      providerMessageId: result.messageId ?? null,
      retryCount,
      failureCode: result.code ?? null,
      retryAt,
      idempotencyKey: idemKey,
    });

    if (isSent) {
      logger.info({ runId, recipients, messageId: result.messageId, retryCount }, "Reconciliation report email sent");
    } else {
      logger.error(
        { runId, recipients, error: result.error, code: result.code, retryCount, retryAt },
        "Failed to send reconciliation report email"
      );

      // Notify all active admins of the failure (only on first attempt to avoid spam)
      if (retryCount === 0) {
        try {
          const admins = await db
            .select({ id: usersTable.id })
            .from(usersTable)
            .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)));

          if (admins.length > 0) {
            const retryMsg = retryAt
              ? ` The system will retry automatically at ${retryAt.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })} IST.`
              : " No further automatic retries remain — use the Resend button in the Admin Console.";

            await createBulkNotifications(admins.map(a => ({
              userId: a.id,
              type: "reconciliation_email_failure" as const,
              title: "Reconciliation Report Email Failed",
              body: `The report email for reconciliation run #${runId} (${run.dateFrom} to ${run.dateTo}) could not be delivered.${retryMsg}`,
              metadata: { runId, recipients: recipients.join(", "), error: errorMsg, code: result.code },
            })));

            logger.info({ runId, adminCount: admins.length }, "Admin notifications sent for reconciliation report email failure");
          }
        } catch (notifyErr) {
          logger.error({ err: notifyErr, runId }, "Failed to insert admin notifications for reconciliation report email failure");
        }
      }
    }
  } catch (err) {
    logger.error({ err, runId, retryCount }, "Unexpected error in sendReportEmailCore");
  }
}

/** Sends the post-run report email to the configured finance_report_email recipient. */
export async function sendReconciliationReportEmail(runId: number): Promise<void> {
  await sendReportEmailCore(runId, 0);
}

/**
 * Picks up failed reconciliation report emails that are due for retry
 * (retryAt <= NOW, retryCount < MAX_EMAIL_RETRIES).
 *
 * Called by the reconciliation scheduler on each run so failed emails
 * get automatically retried with exponential backoff.
 */
export async function retryFailedReconEmails(): Promise<void> {
  try {
    const now = new Date();

    // Picks up rows that are past their backoff window OR rows with NULL retryAt
    // (old failed rows created before this schema migration that never had retryAt set).
    const pending = await db
      .select()
      .from(reconciliationEmailLogsTable)
      .where(and(
        eq(reconciliationEmailLogsTable.status, "failed"),
        eq(reconciliationEmailLogsTable.emailType, "report"),
        or(
          lte(reconciliationEmailLogsTable.retryAt, now),
          isNull(reconciliationEmailLogsTable.retryAt),
        ),
      ))
      .limit(20);

    if (pending.length === 0) return;

    logger.info({ count: pending.length }, "reconciliation_email_retry_batch_start");

    for (const log of pending) {
      const currentRetryCount = log.retryCount ?? 0;
      if (currentRetryCount >= MAX_EMAIL_RETRIES) {
        // Exhausted retries — clear retryAt so this row doesn't keep showing up
        await db
          .update(reconciliationEmailLogsTable)
          .set({ retryAt: null })
          .where(eq(reconciliationEmailLogsTable.id, log.id));
        logger.warn({ logId: log.id, runId: log.runId, retryCount: currentRetryCount }, "Max email retries exhausted — giving up");
        continue;
      }

      // Clear retryAt on the old failed row so it won't be picked up again
      await db
        .update(reconciliationEmailLogsTable)
        .set({ retryAt: null })
        .where(eq(reconciliationEmailLogsTable.id, log.id));

      // Create a new attempt row with incremented retry count
      logger.info({ logId: log.id, runId: log.runId, attempt: currentRetryCount + 1 }, "reconciliation_email_retry_attempt");
      await sendReportEmailCore(log.runId, currentRetryCount + 1);
    }
  } catch (err) {
    logger.error({ err }, "Failed to run reconciliation email retry batch");
  }
}
