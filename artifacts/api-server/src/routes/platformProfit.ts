/**
 * Admin Platform Profit Wallet — Super Admin only.
 *
 * Records all platform revenue (payin fees), manages GST liability separately,
 * and supports manual credit/debit adjustments with full audit trail.
 *
 * Accounting rule: GST is NEVER platform profit — it flows to tax_liability_ledger.
 * Platform Profit = payinFee only (before GST).
 */

import { Router } from "express";
import {
  db,
  platformWalletLedgerTable,
  taxLiabilityLedgerTable,
  merchantsTable,
  usersTable,
  type InsertPlatformWalletLedger,
  type InsertTaxLiabilityLedger,
} from "@workspace/db";
import { desc, eq, gte, lte, and, count, sum } from "drizzle-orm";
import { requireAuth, requireAdmin, requireSuperAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth, requireAdmin, requireSuperAdmin);

// ── Shared helpers (exported for use in other routes) ───────────────────────

/** Get current platform wallet running balance (last row's balance_after). */
export async function getPlatformWalletBalance(): Promise<number> {
  const rows = await db
    .select({ bal: platformWalletLedgerTable.balanceAfter })
    .from(platformWalletLedgerTable)
    .orderBy(desc(platformWalletLedgerTable.id))
    .limit(1);
  return rows[0] ? parseFloat(rows[0].bal as string) : 0;
}

/** Get current GST liability running balance. */
export async function getGstLiabilityBalance(): Promise<number> {
  const rows = await db
    .select({ bal: taxLiabilityLedgerTable.balanceAfter })
    .from(taxLiabilityLedgerTable)
    .orderBy(desc(taxLiabilityLedgerTable.id))
    .limit(1);
  return rows[0] ? parseFloat(rows[0].bal as string) : 0;
}

/**
 * Append a platform wallet ledger entry.
 * Automatically computes running balance as previous + profitAmount.
 * Returns the new running balance.
 */
export async function appendPlatformProfitEntry(
  entry: Omit<InsertPlatformWalletLedger, "balanceAfter">,
): Promise<number> {
  const current = await getPlatformWalletBalance();
  const profitDelta = parseFloat((entry.profitAmount ?? "0") as string);
  const newBalance = current + profitDelta;
  await db.insert(platformWalletLedgerTable).values({
    ...entry,
    balanceAfter: newBalance.toFixed(2),
  });
  return newBalance;
}

/**
 * Append a tax liability ledger entry.
 * Automatically computes running balance as previous + gstAmount.
 * Returns the new running balance.
 */
export async function appendTaxLiabilityEntry(
  entry: Omit<InsertTaxLiabilityLedger, "balanceAfter">,
): Promise<number> {
  const current = await getGstLiabilityBalance();
  const gstDelta = parseFloat((entry.gstAmount ?? "0") as string);
  const newBalance = current + gstDelta;
  await db.insert(taxLiabilityLedgerTable).values({
    ...entry,
    balanceAfter: newBalance.toFixed(2),
  });
  return newBalance;
}

// ── GET /api/admin/platform-profit/summary ──────────────────────────────────
router.get("/summary", async (req, res, next) => {
  try {
    const now      = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const last7    = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);
    const last15   = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [availableBalance, gstLiabilityBalance] = await Promise.all([
      getPlatformWalletBalance(),
      getGstLiabilityBalance(),
    ]);

    const profitSince = async (since: Date) => {
      const [r] = await db
        .select({ total: sum(platformWalletLedgerTable.profitAmount) })
        .from(platformWalletLedgerTable)
        .where(gte(platformWalletLedgerTable.createdAt, since));
      return parseFloat((r?.total as string) ?? "0") || 0;
    };

    const costSince = async (since: Date) => {
      const [r] = await db
        .select({ total: sum(platformWalletLedgerTable.providerCost) })
        .from(platformWalletLedgerTable)
        .where(gte(platformWalletLedgerTable.createdAt, since));
      return parseFloat((r?.total as string) ?? "0") || 0;
    };

    const [todayProfit, last7DaysProfit, last15DaysProfit, thisMonthProfit, totalProviderCost] =
      await Promise.all([
        profitSince(todayStart),
        profitSince(last7),
        profitSince(last15),
        profitSince(monthStart),
        costSince(monthStart),
      ]);

    res.json({
      availableBalance,
      todayProfit,
      last7DaysProfit,
      last15DaysProfit,
      thisMonthProfit,
      gstLiabilityBalance,
      totalProviderCost,
      netMargin: availableBalance - gstLiabilityBalance - totalProviderCost,
    });
  } catch (err) { next(err); }
});

// ── GET /api/admin/platform-profit/ledger ───────────────────────────────────
router.get("/ledger", async (req, res, next) => {
  try {
    const { page = "1", limit = "50", sourceType, merchantId, search, from, to } =
      req.query as Record<string, string | undefined>;
    const pageNum  = Math.max(1, parseInt(page ?? "1"));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit ?? "50")));
    const offset   = (pageNum - 1) * limitNum;

    const conds: ReturnType<typeof eq>[] = [];
    if (sourceType && sourceType !== "all") {
      conds.push(eq(platformWalletLedgerTable.sourceType, sourceType) as any);
    }
    if (merchantId) {
      conds.push(eq(platformWalletLedgerTable.merchantId, parseInt(merchantId)) as any);
    }
    if (from) {
      conds.push(gte(platformWalletLedgerTable.createdAt, new Date(from)) as any);
    }
    if (to) {
      conds.push(lte(platformWalletLedgerTable.createdAt, new Date(to)) as any);
    }
    const whereClause = conds.length ? and(...(conds as any[])) : undefined;

    const [rows, [totalRow]] = await Promise.all([
      db
        .select({
          ledger:       platformWalletLedgerTable,
          merchantName: merchantsTable.businessName,
          adminEmail:   usersTable.email,
        })
        .from(platformWalletLedgerTable)
        .leftJoin(merchantsTable, eq(platformWalletLedgerTable.merchantId, merchantsTable.id))
        .leftJoin(usersTable, eq(platformWalletLedgerTable.createdByAdminId, usersTable.id))
        .where(whereClause)
        .orderBy(desc(platformWalletLedgerTable.id))
        .limit(limitNum)
        .offset(offset),
      db
        .select({ total: count() })
        .from(platformWalletLedgerTable)
        .where(whereClause),
    ]);

    const items = rows
      .filter(r => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          (r.merchantName ?? "").toLowerCase().includes(q) ||
          (r.ledger.description ?? "").toLowerCase().includes(q) ||
          r.ledger.sourceType.toLowerCase().includes(q)
        );
      })
      .map(r => ({
        id:                  r.ledger.id,
        sourceType:          r.ledger.sourceType,
        sourceId:            r.ledger.sourceId ?? null,
        merchantId:          r.ledger.merchantId ?? null,
        merchantName:        r.merchantName ?? null,
        grossAmount:         parseFloat(r.ledger.grossAmount as string) || 0,
        feeAmount:           parseFloat(r.ledger.feeAmount as string) || 0,
        gstAmount:           parseFloat(r.ledger.gstAmount as string) || 0,
        providerCost:        parseFloat(r.ledger.providerCost as string) || 0,
        profitAmount:        parseFloat(r.ledger.profitAmount as string) || 0,
        balanceAfter:        parseFloat(r.ledger.balanceAfter as string) || 0,
        description:         r.ledger.description ?? null,
        createdByAdminId:    r.ledger.createdByAdminId ?? null,
        createdByAdminEmail: r.adminEmail ?? null,
        createdAt:           r.ledger.createdAt.toISOString(),
      }));

    res.json({ items, total: totalRow?.total ?? 0, page: pageNum, limit: limitNum });
  } catch (err) { next(err); }
});

// ── GET /api/admin/platform-profit/ledger/export/csv ────────────────────────
router.get("/ledger/export/csv", async (req, res, next) => {
  try {
    const { sourceType, merchantId, from, to, search } =
      req.query as Record<string, string | undefined>;

    const conds: ReturnType<typeof eq>[] = [];
    if (sourceType && sourceType !== "all") {
      conds.push(eq(platformWalletLedgerTable.sourceType, sourceType) as any);
    }
    if (merchantId) {
      conds.push(eq(platformWalletLedgerTable.merchantId, parseInt(merchantId)) as any);
    }
    if (from) {
      conds.push(gte(platformWalletLedgerTable.createdAt, new Date(from)) as any);
    }
    if (to) {
      conds.push(lte(platformWalletLedgerTable.createdAt, new Date(to)) as any);
    }
    const whereClause = conds.length ? and(...(conds as any[])) : undefined;

    const rows = await db
      .select({
        ledger:       platformWalletLedgerTable,
        merchantName: merchantsTable.businessName,
        adminEmail:   usersTable.email,
      })
      .from(platformWalletLedgerTable)
      .leftJoin(merchantsTable, eq(platformWalletLedgerTable.merchantId, merchantsTable.id))
      .leftJoin(usersTable, eq(platformWalletLedgerTable.createdByAdminId, usersTable.id))
      .where(whereClause)
      .orderBy(desc(platformWalletLedgerTable.id));

    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const header = "ID,Date,Source Type,Source ID,Merchant,Gross Amount,Fee Amount,GST Amount,Provider Cost,Profit Amount,Balance After,Description,Created By\n";
    const csvRows = rows
      .filter(r => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          (r.merchantName ?? "").toLowerCase().includes(q) ||
          (r.ledger.description ?? "").toLowerCase().includes(q) ||
          r.ledger.sourceType.toLowerCase().includes(q)
        );
      })
      .map(r => [
        r.ledger.id,
        r.ledger.createdAt.toISOString(),
        r.ledger.sourceType,
        r.ledger.sourceId ?? "",
        esc(r.merchantName ?? ""),
        r.ledger.grossAmount,
        r.ledger.feeAmount,
        r.ledger.gstAmount,
        r.ledger.providerCost,
        r.ledger.profitAmount,
        r.ledger.balanceAfter,
        esc(r.ledger.description ?? ""),
        esc(r.adminEmail ?? ""),
      ].join(","))
      .join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="platform-profit-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(header + csvRows);
  } catch (err) { next(err); }
});

// ── POST /api/admin/platform-profit/adjustment ──────────────────────────────
router.post("/adjustment", async (req, res, next) => {
  try {
    const { type, amount, reason, merchantId } =
      req.body as {
        type?: string;
        amount?: unknown;
        reason?: string;
        merchantId?: unknown;
      };

    if (type !== "manual_credit" && type !== "manual_debit") {
      res.status(400).json({ error: "type must be manual_credit or manual_debit" });
      return;
    }
    const amt = typeof amount === "number" ? amount : parseFloat(String(amount ?? ""));
    if (isNaN(amt) || amt <= 0) {
      res.status(400).json({ error: "amount must be a positive number" });
      return;
    }
    if (!reason?.trim()) {
      res.status(400).json({ error: "reason is required" });
      return;
    }
    const merchantIdNum = merchantId != null ? parseInt(String(merchantId)) : undefined;
    const adminUser = (req as any).user as { id: number; email: string };

    const profitDelta = type === "manual_credit" ? amt : -amt;
    const newBalance  = await appendPlatformProfitEntry({
      sourceType:       type,
      merchantId:       merchantIdNum ?? null,
      grossAmount:      "0",
      feeAmount:        "0",
      gstAmount:        "0",
      providerCost:     "0",
      profitAmount:     profitDelta.toFixed(2),
      description:      reason.trim(),
      createdByAdminId: adminUser.id,
    });

    req.log.info({ adminId: adminUser.id, type, amount, newBalance }, "platform_profit_adjustment");
    res.json({ ok: true, newBalance });
  } catch (err) { next(err); }
});

export default router;
