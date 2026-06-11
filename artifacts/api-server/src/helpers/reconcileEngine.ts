import {
  db,
  reconciliationRunsTable,
  reconciliationItemsTable,
  transactionsTable,
  settlementsTable,
  merchantsTable,
  usersTable,
  notificationsTable,
} from "@workspace/db";
import { eq, and, gte, lte, inArray, sql, or, isNull, isNotNull, ne } from "drizzle-orm";
import { logger } from "../lib/logger";
import { createBulkNotifications } from "./notifications";
import { sendReconciliationReportEmail } from "./reconcileEmail";

export interface ReconcileOptions {
  dateFrom: string;
  dateTo: string;
  merchantId?: number | null;
  createdBy?: number | null;
  triggeredBy?: "manual" | "auto";
}

export async function runReconciliation(opts: ReconcileOptions) {
  const { dateFrom, dateTo, merchantId = null, createdBy = null, triggeredBy = "manual" } = opts;

  const fromDate = new Date(dateFrom + "T00:00:00.000Z");
  const toDate = new Date(dateTo + "T23:59:59.999Z");

  const [run] = await db.insert(reconciliationRunsTable).values({
    merchantId: merchantId ?? null,
    dateFrom,
    dateTo,
    status: "running",
    createdBy: createdBy ?? null,
    triggeredBy,
  }).returning();

  try {
    const txConditions: ReturnType<typeof eq>[] = [
      eq(transactionsTable.type, "deposit"),
      eq(transactionsTable.status, "success"),
      gte(transactionsTable.createdAt, fromDate),
      lte(transactionsTable.createdAt, toDate),
    ];
    if (merchantId) txConditions.push(eq(transactionsTable.merchantId, merchantId));

    const deposits = await db
      .select({
        tx: transactionsTable,
        merchantName: merchantsTable.businessName,
      })
      .from(transactionsTable)
      .leftJoin(merchantsTable, eq(transactionsTable.merchantId, merchantsTable.id))
      .where(and(...txConditions));

    const periodOverlap = or(
      and(
        isNotNull(settlementsTable.periodFrom),
        isNotNull(settlementsTable.periodTo),
        lte(settlementsTable.periodFrom, dateTo),
        gte(settlementsTable.periodTo, dateFrom),
      ),
      and(
        isNull(settlementsTable.periodFrom),
        gte(settlementsTable.createdAt, fromDate),
        lte(settlementsTable.createdAt, toDate),
      ),
    );
    const sConditions: any[] = [
      sql`${settlementsTable.status} IN ('approved', 'paid')`,
      periodOverlap!,
    ];
    if (merchantId) sConditions.push(eq(settlementsTable.merchantId, merchantId));

    const settlements = await db
      .select({ s: settlementsTable })
      .from(settlementsTable)
      .where(and(...sConditions));

    const sortedSettlements = [...settlements].sort(
      (a, b) => new Date(a.s.createdAt).getTime() - new Date(b.s.createdAt).getTime()
    );
    const sortedDeposits = [...deposits].sort(
      (a, b) => new Date(a.tx.createdAt!).getTime() - new Date(b.tx.createdAt!).getTime()
    );

    const usedDepositIds = new Set<number>();
    const usedSettlementIds = new Set<number>();

    const items: {
      runId: number;
      transactionId: number | null;
      settlementId: number | null;
      merchantId: number;
      status: string;
      amount: string;
      matchedAt: Date | null;
      notes: string | null;
    }[] = [];

    for (const { s } of sortedSettlements) {
      if (usedSettlementIds.has(s.id)) continue;
      const settlementAmt = Number(s.requestedAmount ?? s.amount);

      const periodStart = s.periodFrom ? new Date(s.periodFrom + "T00:00:00.000Z") : null;
      const periodEnd   = s.periodTo   ? new Date(s.periodTo   + "T23:59:59.999Z") : null;

      const match = sortedDeposits.find(({ tx }) => {
        if (usedDepositIds.has(tx.id)) return false;
        if (tx.merchantId !== s.merchantId) return false;
        if (Math.abs(Number(tx.amount) - settlementAmt) >= 0.01) return false;
        if (periodStart && tx.createdAt && tx.createdAt < periodStart) return false;
        if (periodEnd   && tx.createdAt && tx.createdAt > periodEnd)   return false;
        return true;
      });

      if (match) {
        usedDepositIds.add(match.tx.id);
        usedSettlementIds.add(s.id);
        const now = new Date();
        items.push({
          runId: run.id,
          transactionId: match.tx.id,
          settlementId: s.id,
          merchantId: s.merchantId,
          status: "matched",
          amount: settlementAmt.toFixed(2),
          matchedAt: now,
          notes: `Deposit UTR: ${match.tx.utr}`,
        });
      }
    }

    for (const { tx } of deposits) {
      if (usedDepositIds.has(tx.id)) continue;
      items.push({
        runId: run.id,
        transactionId: tx.id,
        settlementId: null,
        merchantId: tx.merchantId,
        status: "unmatched_deposit",
        amount: Number(tx.amount).toFixed(2),
        matchedAt: null,
        notes: `No matching settlement found for UTR: ${tx.utr}`,
      });
    }

    for (const { s } of settlements) {
      if (usedSettlementIds.has(s.id)) continue;
      items.push({
        runId: run.id,
        transactionId: null,
        settlementId: s.id,
        merchantId: s.merchantId,
        status: "unmatched_settlement",
        amount: Number(s.requestedAmount ?? s.amount).toFixed(2),
        matchedAt: null,
        notes: `No matching deposit found for settlement #${s.id}`,
      });
    }

    if (items.length > 0) {
      await db.insert(reconciliationItemsTable).values(items);
    }

    const matched = items.filter(i => i.status === "matched");
    const unmatchedDeposits = items.filter(i => i.status === "unmatched_deposit");
    const unmatchedSettlements = items.filter(i => i.status === "unmatched_settlement");
    const totalUnmatched = unmatchedDeposits.length + unmatchedSettlements.length;
    const matchedAmount = matched.reduce((s, i) => s + Number(i.amount), 0);
    const unmatchedAmount = [...unmatchedDeposits, ...unmatchedSettlements].reduce((s, i) => s + Number(i.amount), 0);

    const [updated] = await db.update(reconciliationRunsTable)
      .set({
        status: "complete",
        completedAt: new Date(),
        totalDeposits: deposits.length,
        totalSettlements: settlements.length,
        totalMatched: matched.length,
        totalUnmatched,
        matchedAmount: matchedAmount.toFixed(2),
        unmatchedAmount: unmatchedAmount.toFixed(2),
      })
      .where(eq(reconciliationRunsTable.id, run.id))
      .returning();

    // Send reconciliation report email (non-blocking, best-effort)
    sendReconciliationReportEmail(updated.id).catch(err => {
      logger.error({ err, runId: updated.id }, "Unexpected error in reconciliation report email");
    });

    return updated;
  } catch (err) {
    await db.update(reconciliationRunsTable)
      .set({ status: "failed", completedAt: new Date(), notes: err instanceof Error ? err.message : "Unknown error" })
      .where(eq(reconciliationRunsTable.id, run.id));
    throw err;
  }
}

export async function hasExistingAutoRun(dateFrom: string, dateTo: string): Promise<boolean> {
  const existing = await db
    .select({ id: reconciliationRunsTable.id })
    .from(reconciliationRunsTable)
    .where(
      and(
        eq(reconciliationRunsTable.triggeredBy, "auto"),
        eq(reconciliationRunsTable.dateFrom, dateFrom),
        eq(reconciliationRunsTable.dateTo, dateTo),
        ne(reconciliationRunsTable.status, "failed"),
      )
    )
    .limit(1);

  return existing.length > 0;
}

export async function notifyAdminsOfReconciliationFailure(runId: number, error: string) {
  try {
    const admins = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)));

    if (admins.length === 0) return;

    await createBulkNotifications(
      admins.map(admin => ({
        userId: admin.id,
        type: "system_notice" as const,
        title: "Scheduled Reconciliation Failed",
        body: `The nightly auto-reconciliation run (ID: ${runId}) failed. Error: ${error}`,
        metadata: { runId, error },
      }))
    );
  } catch (notifyErr) {
    logger.error({ err: notifyErr }, "Failed to send reconciliation failure notifications");
  }
}
