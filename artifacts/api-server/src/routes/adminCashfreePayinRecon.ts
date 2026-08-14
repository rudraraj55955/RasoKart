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
import { ne, and, gte, lte, inArray, eq, sql } from "drizzle-orm";
import { requireAuth, requireAdmin, requirePermission } from "../middlewares/auth";
import { PERMISSIONS } from "../permissions";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);
router.use(requirePermission(PERMISSIONS.CASHFREE_RECONCILIATION_MANAGE));

// ── DB-backed dedup lock ─────────────────────────────────────────────────────
// Uses the `system_config` table as an atomic cross-instance lock store so
// that autoscaled deployments (multiple API pods) all share the same lock.
//
// Lock key: "backfill_lock_admin_<adminId>"  (transient; not in SYSTEM_CONFIG_KEYS,
//   so the systemConfig coverage test is unaffected).
// Lock value: JSON { token, expiresAt (ms) }
//
// Acquire — atomic INSERT … ON CONFLICT DO UPDATE … WHERE expired:
//   Returns the inserted/updated row only when we actually own the slot.
//   Returns 0 rows (lock contention) when a valid unexpired lock exists.
//
// Release — token-conditional DELETE:
//   Only deletes if our token still matches, so expiry + re-acquisition by a
//   second request is never accidentally wiped by the first request's finally.
//
// TTL: 500 orders × ~600 ms worst-case ≈ 5 min.  10 min gives headroom.
//   The `finally` block always releases on a clean exit; the TTL is a
//   dead-man's switch for hard crashes.
const BACKFILL_LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes

function backfillLockKey(adminId: number): string {
  return `backfill_lock_admin_${adminId}`;
}

/** Attempt to acquire the backfill lock for adminId.
 *  Returns the lock token on success, or null if already locked. */
async function acquireBackfillLock(adminId: number): Promise<string | null> {
  const lockKey   = backfillLockKey(adminId);
  const token     = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const expiresAt = Date.now() + BACKFILL_LOCK_TTL_MS;
  const lockValue = JSON.stringify({ token, expiresAt });
  const nowMs     = Date.now();

  // Atomic upsert: insert or overwrite only when existing lock is expired.
  // The WHERE clause on DO UPDATE means the row is NOT updated (and thus NOT
  // returned) when the existing lock is still valid.
  const rows = await db.execute<{ key: string }>(sql`
    INSERT INTO system_config (key, value, updated_at)
    VALUES (${lockKey}, ${lockValue}, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value      = EXCLUDED.value,
          updated_at = NOW()
      WHERE (system_config.value::jsonb->>'expiresAt')::bigint < ${nowMs}
    RETURNING key
  `);

  // rows.rows (pg driver) or rows (drizzle execute result array)
  const acquired = Array.isArray(rows) ? rows.length > 0
                 : (rows as any).rows?.length > 0;
  return acquired ? token : null;
}

/** Release the backfill lock, but only if we still own it (token match). */
async function releaseBackfillLock(adminId: number, token: string): Promise<void> {
  const lockKey = backfillLockKey(adminId);
  await db.execute(sql`
    DELETE FROM system_config
    WHERE key   = ${lockKey}
      AND value::jsonb->>'token' = ${token}
  `);
}

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

// ── GET /api/admin/cashfree-payin-recon/stuck-orders/export ─────────────────

router.get("/stuck-orders/export", async (req, res, next) => {
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

    const stuckCfOrderIds = stuckOrders
      .map(o => o.cashfreeOrderId)
      .filter((id): id is string => id != null);

    const logMatches = stuckCfOrderIds.length
      ? await db
          .select({
            cashfreeOrderId:  cashfreePaymentLogsTable.cashfreeOrderId,
            processingResult: cashfreePaymentLogsTable.processingResult,
          })
          .from(cashfreePaymentLogsTable)
          .where(inArray(cashfreePaymentLogsTable.cashfreeOrderId, stuckCfOrderIds))
      : [];

    const logCountMap = new Map<string, number>();
    for (const log of logMatches) {
      if (!log.cashfreeOrderId) continue;
      logCountMap.set(log.cashfreeOrderId, (logCountMap.get(log.cashfreeOrderId) ?? 0) + 1);
    }

    // Build CSV
    // Neutralise spreadsheet formula injection: Excel/Sheets treat cells starting
    // with =, +, -, @ (or any of those preceded by whitespace/control chars) as
    // formulas.  We prefix an apostrophe so they are treated as plain text.
    // The apostrophe is the standard mitigation and is invisible after import.
    const FORMULA_STARTERS = /^[\s\t]*[=+\-@]/;
    function csvEscape(val: unknown): string {
      if (val == null) return "";
      let s = String(val);
      if (FORMULA_STARTERS.test(s)) {
        s = `'${s}`;
      }
      // Wrap in quotes if contains comma, double-quote, or newline
      if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    }

    const headers = [
      "CF Order ID",
      "Public Order ID",
      "Merchant ID",
      "Merchant Name",
      "Amount",
      "Currency",
      "Status",
      "UTR",
      "Webhook Log Count",
      "Created At",
      "Paid At",
    ];

    const rows = stuckOrders.map(o => [
      csvEscape(o.cashfreeOrderId),
      csvEscape(o.publicOrderId),
      csvEscape(o.merchantId),
      csvEscape(o.merchantName),
      csvEscape(Number(o.amount ?? 0).toFixed(2)),
      csvEscape(o.currency ?? "INR"),
      csvEscape(o.status),
      csvEscape(o.utr),
      csvEscape(o.cashfreeOrderId ? (logCountMap.get(o.cashfreeOrderId) ?? 0) : 0),
      csvEscape(o.createdAt ? new Date(o.createdAt).toISOString() : ""),
      csvEscape(o.paidAt ? new Date(o.paidAt).toISOString() : ""),
    ].join(","));

    const csv = [headers.join(","), ...rows].join("\r\n");

    const filename = `stuck-orders-${since.toISOString().slice(0, 10)}-to-${until.toISOString().slice(0, 10)}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
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
  const user = (req as any).user as { id: number; email: string };

  // ── DB-backed dedup lock (cross-instance) ────────────────────────────────
  const lockToken = await acquireBackfillLock(user.id);
  if (lockToken === null) {
    res.status(409).json({
      error: "A backfill from this account is already in progress. Please wait for it to complete before retrying.",
    });
    return;
  }

  try {
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
  } finally {
    // Token-conditional release: only deletes the system_config row if our
    // token still matches.  Safe even if the TTL expired and a second request
    // already acquired the lock — we won't delete their lock row.
    await releaseBackfillLock(user.id, lockToken).catch(releaseErr =>
      logger.warn({ releaseErr, adminId: user.id }, "admin_cashfree_payin_recon: lock release failed")
    );
  }
});

export default router;
