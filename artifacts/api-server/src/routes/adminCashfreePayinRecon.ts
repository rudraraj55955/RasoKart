/**
 * Admin — Cashfree Payin Reconciliation
 *
 * Exposes the stuck-order report and atomic backfill logic from
 * scripts/src/backfill-cashfree-payin-credits.ts as API endpoints so that
 * Super Admins can perform credit recovery directly from the Admin UI
 * without requiring SSH / terminal access to the server.
 *
 * Routes:
 *   GET  /api/admin/cashfree-payin-recon/stuck-orders
 *        ?since=<ISO-date>  (default: 2026-01-01)
 *        ?until=<ISO-date>  (default: current date midnight)
 *        → list of cashfree_payment_orders rows that are NOT in PAID status
 *          within the window, with webhook-log evidence counts.
 *
 *   POST /api/admin/cashfree-payin-recon/backfill
 *        body: { cashfreeOrderIds: string[] }
 *        → runs the same atomic credit logic as the script for each order;
 *          writes an audit_logs row per order; returns per-order outcomes.
 *
 * Access: Super Admin only (CASHFREE_RECONCILIATION_MANAGE — SA-only by policy).
 *
 * Safety guarantees (same as the CLI script):
 *   - IDEMPOTENT: atomic UPDATE WHERE status != 'PAID' gate prevents double-credit.
 *   - ISOLATED: each order processed in its own DB transaction.
 *   - AUDITABLE: every backfilled row tagged '[RECONCILIATION]'; audit_logs row per order.
 */

import { Router } from "express";
import {
  db,
  cashfreePaymentOrdersTable,
  cashfreePaymentLogsTable,
  merchantWalletsTable,
  walletLedgerTable,
  transactionsTable,
  merchantsTable,
  auditLogsTable,
  PAYIN_ORDER_STATUS,
} from "@workspace/db";
import { ne, and, gte, lte, inArray, eq } from "drizzle-orm";
import { requireAuth, requireAdmin, requirePermission } from "../middlewares/auth";
import { PERMISSIONS } from "../permissions";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);
router.use(requirePermission(PERMISSIONS.CASHFREE_RECONCILIATION_MANAGE));

// ── GET /api/admin/cashfree-payin-recon/stuck-orders ────────────────────────

router.get("/stuck-orders", async (req, res, next) => {
  try {
    const sinceStr = (req.query["since"] as string | undefined) ?? "2026-01-01T00:00:00Z";
    const untilStr = (req.query["until"] as string | undefined) ?? new Date().toISOString();

    const since = new Date(sinceStr);
    const until = new Date(untilStr);

    if (isNaN(since.getTime()) || isNaN(until.getTime()) || since >= until) {
      res.status(400).json({ error: "Invalid date range: 'since' must be before 'until'" });
      return;
    }

    // Fetch all non-PAID orders in the window
    const stuckOrders = await db
      .select({
        id:              cashfreePaymentOrdersTable.id,
        merchantId:      cashfreePaymentOrdersTable.merchantId,
        merchantName:    merchantsTable.businessName,
        cashfreeOrderId: cashfreePaymentOrdersTable.cashfreeOrderId,
        publicOrderId:   cashfreePaymentOrdersTable.publicOrderId,
        amount:          cashfreePaymentOrdersTable.amount,
        currency:        cashfreePaymentOrdersTable.currency,
        status:          cashfreePaymentOrdersTable.status,
        utr:             cashfreePaymentOrdersTable.utr,
        paidAt:          cashfreePaymentOrdersTable.paidAt,
        createdAt:       cashfreePaymentOrdersTable.createdAt,
      })
      .from(cashfreePaymentOrdersTable)
      .leftJoin(merchantsTable, eq(cashfreePaymentOrdersTable.merchantId, merchantsTable.id))
      .where(and(
        ne(cashfreePaymentOrdersTable.status, PAYIN_ORDER_STATUS.PAID),
        gte(cashfreePaymentOrdersTable.createdAt, since),
        lte(cashfreePaymentOrdersTable.createdAt, until),
      ))
      .orderBy(cashfreePaymentOrdersTable.createdAt);

    // Cross-reference with webhook logs to find evidence of Cashfree sending
    // webhooks that were rejected (the bug window).
    const stuckCfOrderIds = stuckOrders
      .map(o => o.cashfreeOrderId)
      .filter((id): id is string => id != null);

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

    // Build a summary map: cashfreeOrderId → {count, results}
    const logSummaryMap = new Map<string, { count: number; results: string[] }>();
    for (const log of logMatches) {
      if (!log.cashfreeOrderId) continue;
      const existing = logSummaryMap.get(log.cashfreeOrderId) ?? { count: 0, results: [] };
      existing.count++;
      if (log.processingResult) existing.results.push(log.processingResult);
      logSummaryMap.set(log.cashfreeOrderId, existing);
    }

    const orders = stuckOrders.map(o => ({
      id:              o.id,
      merchantId:      o.merchantId,
      merchantName:    o.merchantName ?? null,
      cashfreeOrderId: o.cashfreeOrderId,
      publicOrderId:   o.publicOrderId ?? null,
      amount:          Number(o.amount ?? 0),
      currency:        o.currency ?? "INR",
      status:          o.status,
      utr:             o.utr ?? null,
      paidAt:          o.paidAt ?? null,
      createdAt:       o.createdAt,
      webhookLogCount: o.cashfreeOrderId ? (logSummaryMap.get(o.cashfreeOrderId)?.count ?? 0) : 0,
      webhookLogResults: o.cashfreeOrderId ? (logSummaryMap.get(o.cashfreeOrderId)?.results ?? []) : [],
    }));

    // Grand total
    const grandTotal = orders.reduce((s, o) => s + o.amount, 0);

    res.json({
      since: since.toISOString(),
      until: until.toISOString(),
      total: orders.length,
      grandTotal,
      orders,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/admin/cashfree-payin-recon/backfill ───────────────────────────

type BackfillOutcome = "credited" | "duplicate" | "not_found" | "error";

interface BackfillOrderResult {
  cashfreeOrderId: string;
  outcome: BackfillOutcome;
  detail: string;
}

async function backfillOrder(cashfreeOrderId: string): Promise<BackfillOrderResult> {
  // Fetch the order — must exist and be in the affected window.
  const [cfOrder] = await db
    .select()
    .from(cashfreePaymentOrdersTable)
    .where(eq(cashfreePaymentOrdersTable.cashfreeOrderId, cashfreeOrderId))
    .limit(1);

  if (!cfOrder) {
    return { cashfreeOrderId, outcome: "not_found", detail: `Order ${cashfreeOrderId} not found` };
  }

  if (cfOrder.status === PAYIN_ORDER_STATUS.PAID) {
    return { cashfreeOrderId, outcome: "duplicate", detail: `Order ${cashfreeOrderId} is already PAID — skipping` };
  }

  const paidAmountNum = parseFloat(String(cfOrder.amount ?? "0"));
  if (isNaN(paidAmountNum) || paidAmountNum <= 0) {
    return { cashfreeOrderId, outcome: "error", detail: `Order ${cashfreeOrderId} has invalid amount: ${cfOrder.amount}` };
  }

  const paidAmount = String(paidAmountNum);
  // Use existing UTR if present, otherwise synthesise one that won't collide
  // with a later real webhook delivery for the same order.
  const utr = cfOrder.utr ?? `CF-RECON-${cashfreeOrderId}`;

  try {
    const result = await db.transaction(async (tx) => {
      // ── Step 1: Atomic idempotency gate ─────────────────────────────────
      // Only one concurrent caller wins.  If the order was somehow PAID
      // between the check above and now, updated.length === 0 → duplicate.
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
        availableAfter:  String(availableBefore),  // available unchanged; credit → pending
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
        metadata:    JSON.stringify({
          source:       "admin-cashfree-payin-recon",
          backfilledAt: new Date().toISOString(),
        }),
      }).onConflictDoNothing();

      return "credited";
    });

    const outcome = result as BackfillOutcome;
    return {
      cashfreeOrderId,
      outcome,
      detail: outcome === "duplicate"
        ? "Already PAID (concurrent write)"
        : `Credited ₹${paidAmount} to merchant ${cfOrder.merchantId}`,
    };
  } catch (err) {
    return {
      cashfreeOrderId,
      outcome: "error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

router.post("/backfill", async (req, res, next) => {
  try {
    const user = (req as any).user as { id: number; email: string };
    const body = req.body as { cashfreeOrderIds?: unknown };

    if (!Array.isArray(body.cashfreeOrderIds) || body.cashfreeOrderIds.length === 0) {
      res.status(400).json({ error: "cashfreeOrderIds must be a non-empty array of strings" });
      return;
    }

    const ids = (body.cashfreeOrderIds as unknown[])
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map(id => id.trim());

    if (ids.length === 0) {
      res.status(400).json({ error: "No valid cashfreeOrderIds provided" });
      return;
    }

    if (ids.length > 500) {
      res.status(400).json({ error: "Cannot backfill more than 500 orders in a single request" });
      return;
    }

    logger.info({ adminId: user.id, adminEmail: user.email, count: ids.length },
      "admin_cashfree_payin_recon: backfill initiated");

    const results: BackfillOrderResult[] = [];

    for (const cashfreeOrderId of ids) {
      const result = await backfillOrder(cashfreeOrderId);
      results.push(result);

      // Write per-order audit log — awaited so the record is reliably
      // persisted before the response is returned.  A failure here is
      // logged but does NOT abort the backfill: the credit already
      // committed in a separate transaction and must be reported.
      try {
        await db.insert(auditLogsTable).values({
          adminId:    user.id,
          adminEmail: user.email,
          action:     "reconciliation_backfill",
          targetType: "cashfree_payment_order",
          targetId:   null,
          details:    JSON.stringify({
            cashfreeOrderId,
            outcome: result.outcome,
            detail:  result.detail,
          }),
          ipAddress: (req as any).ip ?? null,
        });
      } catch (auditErr) {
        logger.warn({ auditErr, cashfreeOrderId }, "admin_cashfree_payin_recon: audit log insert failed (credit already committed)");
      }
    }

    const credited  = results.filter(r => r.outcome === "credited").length;
    const duplicate = results.filter(r => r.outcome === "duplicate").length;
    const notFound  = results.filter(r => r.outcome === "not_found").length;
    const errors    = results.filter(r => r.outcome === "error").length;

    logger.info(
      { adminId: user.id, credited, duplicate, notFound, errors },
      "admin_cashfree_payin_recon: backfill complete",
    );

    res.json({
      results,
      summary: { credited, duplicate, notFound, errors, total: results.length },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
