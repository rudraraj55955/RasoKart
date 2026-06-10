import { db, reconciliationRunsTable, reconciliationItemsTable, transactionsTable, settlementsTable, merchantsTable, systemSettingsTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendMail } from "./mailer";

function escapeCsv(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function buildRunCsv(runId: number): Promise<string> {
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

function buildEmailHtml(run: typeof reconciliationRunsTable.$inferSelect): string {
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

export async function sendReconciliationReportEmail(runId: number): Promise<void> {
  try {
    const settingRow = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, "finance_report_email"))
      .limit(1);

    const financeEmail = settingRow[0]?.value ?? null;
    if (!financeEmail) {
      logger.info({ runId }, "No finance_report_email configured — skipping reconciliation report email");
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

    await sendMail({
      to: financeEmail,
      subject: `[RasoKart] Reconciliation Report — Run #${runId} (${run.dateFrom} to ${run.dateTo})`,
      html,
      attachments: [{ filename, content: csv, contentType: "text/csv" }],
    });
  } catch (err) {
    logger.error({ err, runId }, "Failed to send reconciliation report email");
  }
}
