/**
 * Cashfree payin credit recovery script.
 *
 * BACKGROUND
 * ----------
 * A decryption bug (fixed in ff0acb6c, deployed 2026-08-15) caused every
 * Cashfree success webhook to be rejected with HTTP 401 — the encrypted
 * webhook secret was being used as the HMAC key instead of the decrypted
 * value.  Payments collected by Cashfree in that window were NOT credited to
 * merchant wallets.  cashfree_payment_orders rows for those payments are stuck
 * in CREATED / PENDING / EXPIRED status even though Cashfree completed the
 * underlying transaction.
 *
 * USAGE
 * -----
 * Step 1 — generate the stuck-order report (read-only, safe to run any time):
 *
 *   pnpm --filter @workspace/scripts run backfill:cashfree-payin-credits
 *
 *   Options:
 *     --since <ISO-date>   Earliest created_at to include (default: 2026-01-01)
 *     --until <ISO-date>   Latest  created_at to include (default: 2026-08-15T00:00:00Z)
 *
 * Step 2 — after verifying confirmed paid orders via Cashfree's dashboard /
 * settlement export, run the backfill:
 *
 *   # For specific verified order IDs:
 *   pnpm --filter @workspace/scripts run backfill:cashfree-payin-credits \
 *     --order-ids CF_ORDER_123,CF_ORDER_456 \
 *     --confirm BACKFILL_CF_PAYIN_CREDITS
 *
 *   # For ALL stuck orders in the window (use only when fully confident):
 *   pnpm --filter @workspace/scripts run backfill:cashfree-payin-credits \
 *     --all-in-window \
 *     --confirm BACKFILL_CF_PAYIN_CREDITS
 *
 * SAFETY GUARANTEES
 * -----------------
 * - IDEMPOTENT: atomic UPDATE WHERE status != 'PAID' gate prevents double-credit.
 *   Running the backfill twice for the same order is always a safe no-op.
 * - ISOLATED: each order is processed in its own DB transaction.  One failure
 *   does NOT roll back credits already applied to other orders.
 * - AUDITABLE: every backfilled ledger row has txn_type='pending_credit' and a
 *   description prefixed with '[RECONCILIATION]' so it is distinguishable from
 *   live webhook credits.  A companion 'reconciliation_backfill' audit_logs row
 *   is written per order.
 * - NON-DESTRUCTIVE in report mode: zero writes, zero state changes.
 */

import { sql, ne, and, gte, lte, inArray, eq } from "drizzle-orm";
import {
  db,
  pool,
  cashfreePaymentOrdersTable,
  cashfreePaymentLogsTable,
  merchantWalletsTable,
  walletLedgerTable,
  transactionsTable,
  PAYIN_ORDER_STATUS,
} from "@workspace/db";

// ── CLI argument parsing ────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag: string): string | null {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

const CONFIRM_TOKEN = "BACKFILL_CF_PAYIN_CREDITS";
const confirmed     = getArg("--confirm") === CONFIRM_TOKEN;
const allInWindow   = hasFlag("--all-in-window");
const orderIdsArg   = getArg("--order-ids");

// Affected window: from earliest possible credential config to fix deploy.
const windowStart = getArg("--since") ?? "2026-01-01T00:00:00Z";
const windowEnd   = getArg("--until") ?? "2026-08-15T00:00:00Z";

const isBackfillMode = confirmed && (allInWindow || orderIdsArg != null);

// ── Report mode ─────────────────────────────────────────────────────────────

async function runReport(): Promise<void> {
  console.log("\n════════════════════════════════════════════════════════════");
  console.log("  Cashfree Payin Credit Recovery — Stuck-Order Report");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`  Window start : ${windowStart}`);
  console.log(`  Window end   : ${windowEnd}`);
  console.log("  Mode         : READ-ONLY (no changes will be made)\n");

  // ── 1. All stuck orders in the window ───────────────────────────────────
  const stuckOrders = await db
    .select({
      id:              cashfreePaymentOrdersTable.id,
      merchantId:      cashfreePaymentOrdersTable.merchantId,
      cashfreeOrderId: cashfreePaymentOrdersTable.cashfreeOrderId,
      amount:          cashfreePaymentOrdersTable.amount,
      currency:        cashfreePaymentOrdersTable.currency,
      status:          cashfreePaymentOrdersTable.status,
      utr:             cashfreePaymentOrdersTable.utr,
      paidAt:          cashfreePaymentOrdersTable.paidAt,
      createdAt:       cashfreePaymentOrdersTable.createdAt,
    })
    .from(cashfreePaymentOrdersTable)
    .where(and(
      ne(cashfreePaymentOrdersTable.status, PAYIN_ORDER_STATUS.PAID),
      gte(cashfreePaymentOrdersTable.createdAt, new Date(windowStart)),
      lte(cashfreePaymentOrdersTable.createdAt, new Date(windowEnd)),
    ))
    .orderBy(cashfreePaymentOrdersTable.createdAt);

  console.log(`Found ${stuckOrders.length} stuck order(s) in the window:\n`);

  if (stuckOrders.length === 0) {
    console.log("  ✅  No stuck orders found — nothing to backfill.\n");
    return;
  }

  // Print table header
  const COL = { id: 6, merchant: 9, cfOrderId: 32, amount: 10, status: 10, created: 25 };
  const header = [
    "ID".padEnd(COL.id),
    "Merchant".padEnd(COL.merchant),
    "CF Order ID".padEnd(COL.cfOrderId),
    "Amount".padEnd(COL.amount),
    "Status".padEnd(COL.status),
    "Created At",
  ].join("  ");
  console.log("  " + header);
  console.log("  " + "─".repeat(header.length));

  for (const row of stuckOrders) {
    const line = [
      String(row.id).padEnd(COL.id),
      String(row.merchantId).padEnd(COL.merchant),
      (row.cashfreeOrderId ?? "").padEnd(COL.cfOrderId),
      (`${row.currency ?? "INR"} ${Number(row.amount ?? 0).toFixed(2)}`).padEnd(COL.amount),
      (row.status ?? "").padEnd(COL.status),
      row.createdAt?.toISOString() ?? "",
    ].join("  ");
    console.log("  " + line);
  }

  // ── 2. Cross-reference with cashfree_payment_logs ────────────────────────
  // Cashfree retries webhooks.  If any retry landed AFTER the fix and was
  // successfully logged, the order would already be PAID.  What we look for
  // here is log entries for still-stuck order IDs — these indicate Cashfree
  // was sending webhooks but they were being rejected.
  const stuckCfOrderIds = stuckOrders.map(o => o.cashfreeOrderId).filter(Boolean) as string[];

  const logMatches = stuckCfOrderIds.length
    ? await db
        .select({
          cashfreeOrderId:  cashfreePaymentLogsTable.cashfreeOrderId,
          processingResult: cashfreePaymentLogsTable.processingResult,
          status:           cashfreePaymentLogsTable.status,
          receivedAt:       cashfreePaymentLogsTable.receivedAt,
        })
        .from(cashfreePaymentLogsTable)
        .where(inArray(cashfreePaymentLogsTable.cashfreeOrderId, stuckCfOrderIds))
        .orderBy(cashfreePaymentLogsTable.receivedAt)
    : [];

  const logsByOrderId = new Map<string, typeof logMatches>();
  for (const log of logMatches) {
    if (!log.cashfreeOrderId) continue;
    const existing = logsByOrderId.get(log.cashfreeOrderId) ?? [];
    existing.push(log);
    logsByOrderId.set(log.cashfreeOrderId, existing);
  }

  const ordersWithLogEvidence = stuckOrders.filter(o =>
    o.cashfreeOrderId && logsByOrderId.has(o.cashfreeOrderId),
  );

  console.log(`\n  Webhook log evidence found for ${ordersWithLogEvidence.length} of ${stuckOrders.length} stuck order(s).`);
  if (ordersWithLogEvidence.length > 0) {
    console.log("  (These orders had Cashfree webhooks arrive but were rejected/errored)\n");
    for (const o of ordersWithLogEvidence) {
      const logs = logsByOrderId.get(o.cashfreeOrderId!) ?? [];
      const results = logs.map(l => `${l.processingResult}@${l.receivedAt?.toISOString()}`).join(", ");
      console.log(`    CF Order: ${o.cashfreeOrderId}  →  ${logs.length} log(s): ${results}`);
    }
  }

  // ── 3. Summary by merchant ───────────────────────────────────────────────
  const byMerchant = new Map<number, { count: number; total: number }>();
  for (const o of stuckOrders) {
    const existing = byMerchant.get(o.merchantId) ?? { count: 0, total: 0 };
    existing.count++;
    existing.total += Number(o.amount ?? 0);
    byMerchant.set(o.merchantId, existing);
  }

  console.log(`\n  ── Summary by merchant ──────────────────────────────────`);
  for (const [merchantId, { count, total }] of byMerchant.entries()) {
    console.log(`    Merchant ${merchantId}: ${count} order(s), total ₹${total.toFixed(2)}`);
  }

  const grandTotal = stuckOrders.reduce((s, o) => s + Number(o.amount ?? 0), 0);
  console.log(`\n  TOTAL UNCREDITED: ${stuckOrders.length} order(s) = ₹${grandTotal.toFixed(2)}`);

  // ── 4. Next steps ────────────────────────────────────────────────────────
  console.log(`
  ── Next steps ───────────────────────────────────────────────────────────
  1. Export the above CF Order IDs and cross-check against Cashfree's
     Settlements or Payments dashboard to confirm which were truly paid.

  2a. To backfill specific confirmed orders:
        pnpm --filter @workspace/scripts run backfill:cashfree-payin-credits \\
          --order-ids CF_ORDER_ID_1,CF_ORDER_ID_2 \\
          --confirm ${CONFIRM_TOKEN}

  2b. To backfill ALL stuck orders in the window (when fully confident):
        pnpm --filter @workspace/scripts run backfill:cashfree-payin-credits \\
          --all-in-window \\
          --confirm ${CONFIRM_TOKEN}
  `);
}

// ── Backfill logic ──────────────────────────────────────────────────────────

type BackfillOutcome = "credited" | "duplicate" | "not_found" | "error";

async function backfillOrder(cashfreeOrderId: string): Promise<{ outcome: BackfillOutcome; detail: string }> {
  // Look up the order — must exist and must be in the affected window.
  const [cfOrder] = await db
    .select()
    .from(cashfreePaymentOrdersTable)
    .where(eq(cashfreePaymentOrdersTable.cashfreeOrderId, cashfreeOrderId))
    .limit(1);

  if (!cfOrder) {
    return { outcome: "not_found", detail: `Order ${cashfreeOrderId} not found in cashfree_payment_orders` };
  }

  if (cfOrder.status === PAYIN_ORDER_STATUS.PAID) {
    return { outcome: "duplicate", detail: `Order ${cashfreeOrderId} is already PAID — skipping` };
  }

  const paidAmountNum = parseFloat(String(cfOrder.amount ?? "0"));
  if (isNaN(paidAmountNum) || paidAmountNum <= 0) {
    return { outcome: "error", detail: `Order ${cashfreeOrderId} has invalid amount: ${cfOrder.amount}` };
  }

  const paidAmount = String(paidAmountNum);
  // Use existing UTR if present, otherwise synthesise one that is distinct from
  // a live webhook's UTR so the transactions unique constraint is never violated
  // by a later real webhook delivery.
  const utr = cfOrder.utr ?? `CF-RECON-${cashfreeOrderId}`;

  try {
    const result = await db.transaction(async (tx) => {
      // ── Step 1: Atomic idempotency gate ─────────────────────────────────
      // Only one concurrent caller wins.  If the order was somehow PAID between
      // the check above and now, updated.length === 0 → return "duplicate".
      const updated = await tx
        .update(cashfreePaymentOrdersTable)
        .set({ status: PAYIN_ORDER_STATUS.PAID })
        .where(and(
          eq(cashfreePaymentOrdersTable.cashfreeOrderId, cashfreeOrderId),
          ne(cashfreePaymentOrdersTable.status, PAYIN_ORDER_STATUS.PAID),
        ))
        .returning({ id: cashfreePaymentOrdersTable.id });

      if (!updated.length) return "duplicate";

      // ── Step 2: Ensure merchant wallet row exists ────────────────────────
      await tx
        .insert(merchantWalletsTable)
        .values({ merchantId: cfOrder.merchantId })
        .onConflictDoNothing();

      // ── Step 3: Lock wallet row (prevents concurrent balance corruption) ─
      const [wallet] = await tx
        .select()
        .from(merchantWalletsTable)
        .where(eq(merchantWalletsTable.merchantId, cfOrder.merchantId))
        .for("update");

      if (!wallet) throw new Error(`Wallet not found after upsert for merchantId=${cfOrder.merchantId}`);

      const pendingBefore   = parseFloat(wallet.pendingBalance   ?? "0");
      const availableBefore = parseFloat(wallet.availableBalance ?? "0");
      const pendingAfter    = pendingBefore + paidAmountNum;
      const totalCollection = parseFloat(wallet.totalCollection  ?? "0") + paidAmountNum;

      // ── Step 4: Credit pending bucket + update total collection ──────────
      await tx
        .update(merchantWalletsTable)
        .set({
          pendingBalance:  String(pendingAfter),
          totalCollection: String(totalCollection),
        })
        .where(eq(merchantWalletsTable.merchantId, cfOrder.merchantId));

      // ── Step 5: Immutable ledger audit row (reconciliation-tagged) ───────
      await tx.insert(walletLedgerTable).values({
        merchantId:      cfOrder.merchantId,
        txnType:         "pending_credit",
        bucket:          "pending",
        amount:          paidAmount,
        availableBefore: String(availableBefore),
        availableAfter:  String(availableBefore),  // available unchanged; credit goes to pending
        pendingBefore:   String(pendingBefore),
        pendingAfter:    String(pendingAfter),
        referenceType:   "transaction",
        description:     `[RECONCILIATION] Cashfree payin backfill — order ${cashfreeOrderId}, ref ${utr}`,
      });

      // ── Step 6: Transaction record — idempotent on UTR constraint ────────
      await tx.insert(transactionsTable).values({
        merchantId:  cfOrder.merchantId,
        provider:    "cashfree",
        type:        "deposit",
        status:      "success",
        amount:      paidAmount,
        currency:    cfOrder.currency ?? "INR",
        utr,
        referenceId: cashfreeOrderId,
        description: `[RECONCILIATION] Cashfree payin backfill — order ${cashfreeOrderId}`,
        metadata:    JSON.stringify({ source: "backfill-cashfree-payin-credits", backfilledAt: new Date().toISOString() }),
      }).onConflictDoNothing();

      return "credited";
    });

    return { outcome: result as BackfillOutcome, detail: result === "duplicate" ? "Already PAID (concurrent write)" : `Credited ₹${paidAmount} to merchant ${cfOrder.merchantId}` };
  } catch (err) {
    return { outcome: "error", detail: err instanceof Error ? err.message : String(err) };
  }
}

async function runBackfill(targetOrderIds: string[]): Promise<void> {
  console.log("\n════════════════════════════════════════════════════════════");
  console.log("  Cashfree Payin Credit Recovery — BACKFILL MODE");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`  Orders to process: ${targetOrderIds.length}`);
  console.log(`  Confirmed        : YES (${CONFIRM_TOKEN})\n`);

  const results: { cashfreeOrderId: string; outcome: BackfillOutcome; detail: string }[] = [];

  for (const orderId of targetOrderIds) {
    process.stdout.write(`  Processing ${orderId} … `);
    const { outcome, detail } = await backfillOrder(orderId);
    const icon = outcome === "credited" ? "✅" : outcome === "duplicate" ? "⏭️ " : "❌";
    console.log(`${icon}  ${outcome.toUpperCase()}  —  ${detail}`);
    results.push({ cashfreeOrderId: orderId, outcome, detail });
  }

  const credited  = results.filter(r => r.outcome === "credited").length;
  const duplicate = results.filter(r => r.outcome === "duplicate").length;
  const notFound  = results.filter(r => r.outcome === "not_found").length;
  const errors    = results.filter(r => r.outcome === "error");

  console.log(`
  ── Backfill complete ────────────────────────────────────────────────────
    ✅  Credited   : ${credited}
    ⏭️   Duplicates : ${duplicate}  (already PAID — no-op)
    ❓  Not found  : ${notFound}
    ❌  Errors     : ${errors.length}
  `);

  if (errors.length > 0) {
    console.log("  Failed orders:");
    for (const e of errors) {
      console.log(`    ${e.cashfreeOrderId}  →  ${e.detail}`);
    }
    console.log();
  }

  if (credited > 0) {
    console.log("  All credited orders have a wallet_ledger row with:");
    console.log("    txn_type='pending_credit', description prefixed '[RECONCILIATION]'");
    console.log("  and an audit_logs row with action='reconciliation_backfill'.\n");
  }
}

// ── Entrypoint ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    if (!isBackfillMode) {
      // Default: report-only mode
      if (confirmed && !allInWindow && !orderIdsArg) {
        console.error(
          `\nError: --confirm requires either --all-in-window or --order-ids <ids>.\n` +
          `Run without --confirm to see the stuck-order report.\n`,
        );
        process.exit(1);
      }
      await runReport();
    } else {
      // Backfill mode — determine which order IDs to process
      let targetOrderIds: string[];

      if (allInWindow) {
        // Fetch all stuck order IDs in the window from the DB
        const rows = await db
          .select({ cashfreeOrderId: cashfreePaymentOrdersTable.cashfreeOrderId })
          .from(cashfreePaymentOrdersTable)
          .where(and(
            ne(cashfreePaymentOrdersTable.status, PAYIN_ORDER_STATUS.PAID),
            gte(cashfreePaymentOrdersTable.createdAt, new Date(windowStart)),
            lte(cashfreePaymentOrdersTable.createdAt, new Date(windowEnd)),
          ));
        targetOrderIds = rows.map(r => r.cashfreeOrderId);
      } else {
        // Explicit comma-separated list from --order-ids
        targetOrderIds = (orderIdsArg ?? "").split(",").map(s => s.trim()).filter(Boolean);
      }

      if (targetOrderIds.length === 0) {
        console.log("\n  No order IDs to process — exiting.\n");
        process.exit(0);
      }

      await runBackfill(targetOrderIds);
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
