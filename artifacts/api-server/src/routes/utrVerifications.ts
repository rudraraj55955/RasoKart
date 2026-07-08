/**
 * Admin UTR Verification — approve / reject manual UPI payments submitted
 * via the static-UPI checkout on /pay/:slug.
 *
 * Every UTR submission creates a `transactions` row with:
 *   type   = 'deposit'
 *   status = 'pending_verification'
 *   utr    = customer-provided UTR (unique constraint guards duplicates)
 *   metadata JSON = { payerName?, payerUpi?, screenshotUrl?, providerKey? }
 *   description = null initially; set to rejection reason on reject
 *
 * Approve credits the merchant wallet exactly once (idempotent status guard).
 */

import { Router } from "express";
import { db, transactionsTable, merchantsTable, paymentLinksTable } from "@workspace/db";
import { eq, and, desc, ilike, or, count } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { mutateWallet } from "./wallets";
import { resolveChargeSettings, calculatePayinCharge } from "../lib/chargeCalculator";
import { appendPlatformProfitEntry, appendTaxLiabilityEntry } from "./platformProfit";

const router = Router();
router.use(requireAuth, requireAdmin);

// ── GET /api/admin/utr-verifications ──────────────────────────────────────────
router.get("/", async (req, res, next) => {
  try {
    const { status, search, merchantId, page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: ReturnType<typeof eq>[] = [
      eq(transactionsTable.provider, "own_static_upi"),
    ];
    if (status && status !== "all") {
      conditions.push(eq(transactionsTable.status, status) as any);
    } else if (!status) {
      conditions.push(eq(transactionsTable.status, "pending_verification") as any);
    }
    if (merchantId) conditions.push(eq(transactionsTable.merchantId, parseInt(merchantId)) as any);

    const rows = await db
      .select({
        tx: transactionsTable,
        merchantName: merchantsTable.businessName,
        merchantEmail: merchantsTable.email,
      })
      .from(transactionsTable)
      .leftJoin(merchantsTable, eq(transactionsTable.merchantId, merchantsTable.id))
      .where(and(...(conditions as any[])))
      .orderBy(desc(transactionsTable.createdAt))
      .limit(limitNum)
      .offset(offset);

    const items = rows
      .filter(r => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          r.tx.utr.toLowerCase().includes(q) ||
          (r.merchantName ?? "").toLowerCase().includes(q) ||
          (r.merchantEmail ?? "").toLowerCase().includes(q)
        );
      })
      .map(r => {
        let meta: Record<string, unknown> = {};
        try { meta = JSON.parse(r.tx.metadata ?? "{}"); } catch { /* ignore */ }
        return {
          id: r.tx.id,
          merchantId: r.tx.merchantId,
          merchantName: r.merchantName ?? null,
          merchantEmail: r.merchantEmail ?? null,
          amount: r.tx.amount,
          currency: r.tx.currency,
          utr: r.tx.utr,
          status: r.tx.status,
          paymentLinkId: r.tx.paymentLinkId ?? null,
          payerName: (meta["payerName"] as string) ?? null,
          payerUpi: (meta["payerUpi"] as string) ?? null,
          screenshotUrl: (meta["screenshotUrl"] as string) ?? null,
          rejectionReason: r.tx.description ?? null,
          reviewedAt: (meta["reviewedAt"] as string) ?? null,
          reviewedByEmail: (meta["reviewedByEmail"] as string) ?? null,
          createdAt: r.tx.createdAt.toISOString(),
          updatedAt: r.tx.updatedAt.toISOString(),
        };
      });

    res.json({ items, total: items.length });
  } catch (err) { next(err); }
});

// ── POST /api/admin/utr-verifications/:id/approve ─────────────────────────────
router.post("/:id/approve", async (req, res, next) => {
  try {
    const id = parseInt(req.params["id"] as string);
    const adminEmail: string = (req as any).user.email;

    // Atomic status guard: only claim from pending_verification
    const [claimed] = await db
      .update(transactionsTable)
      .set({ status: "success", updatedAt: new Date() })
      .where(
        and(
          eq(transactionsTable.id, id),
          eq(transactionsTable.status, "pending_verification"),
          eq(transactionsTable.provider, "own_static_upi"),
        ) as any,
      )
      .returning();

    if (!claimed) {
      res.status(409).json({ error: "Transaction not found or already processed" });
      return;
    }

    // Update metadata with review info
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(claimed.metadata ?? "{}"); } catch { /* ignore */ }
    meta["reviewedAt"] = new Date().toISOString();
    meta["reviewedByEmail"] = adminEmail;
    await db
      .update(transactionsTable)
      .set({ metadata: JSON.stringify(meta) })
      .where(eq(transactionsTable.id, id));

    // Resolve charges and credit merchant wallet
    const grossAmount = parseFloat(claimed.amount as string);
    const chargeSettings = await resolveChargeSettings(claimed.merchantId);
    const charge = calculatePayinCharge(grossAmount, chargeSettings);

    // Idempotency: store fee columns on the transaction (only if not already set)
    await db.update(transactionsTable).set({
      payinFee:  charge.payinFee.toFixed(2),
      gstAmount: charge.gstAmount.toFixed(2),
      netAmount: charge.netAmount.toFixed(2),
    }).where(eq(transactionsTable.id, id));

    // Credit net amount to available; gross to totalCollection
    await mutateWallet(
      claimed.merchantId,
      {
        availableDelta:     charge.netAmount,
        totalCollectionDelta: grossAmount,
        totalChargesDelta:  charge.chargesApplied ? (charge.payinFee + charge.gstAmount) : 0,
      },
      {
        txnType: "deposit",
        bucket: "available",
        amount: charge.netAmount,
        referenceType: "transaction",
        referenceId: claimed.id,
        description: `UTR ${claimed.utr} approved` + (charge.chargesApplied ? ` (net after ₹${(charge.payinFee + charge.gstAmount).toFixed(2)} fee)` : ""),
      },
    );

    // Separate ledger entry for the charge deduction (only when fee > 0)
    if (charge.chargesApplied && (charge.payinFee + charge.gstAmount) > 0) {
      await mutateWallet(
        claimed.merchantId,
        { totalChargesDelta: 0 }, // balance already updated above; ledger entry only
        {
          txnType: "charge",
          bucket: "available",
          amount: -(charge.payinFee + charge.gstAmount),
          referenceType: "transaction",
          referenceId: claimed.id,
          description: `Payin fee ₹${charge.payinFee.toFixed(2)}` + (charge.gstAmount > 0 ? ` + GST ₹${charge.gstAmount.toFixed(2)}` : ""),
        },
      );
    }

    // Record platform profit (payin fee only — not GST, which flows to tax_liability_ledger)
    if (charge.chargesApplied && charge.payinFee > 0) {
      const [merchantRow] = await db
        .select({ name: merchantsTable.businessName })
        .from(merchantsTable)
        .where(eq(merchantsTable.id, claimed.merchantId))
        .limit(1);
      await appendPlatformProfitEntry({
        sourceType:   "payin_fee",
        sourceId:     claimed.id,
        merchantId:   claimed.merchantId,
        grossAmount:  grossAmount.toFixed(2),
        feeAmount:    charge.payinFee.toFixed(2),
        gstAmount:    charge.gstAmount.toFixed(2),
        providerCost: "0",
        profitAmount: charge.payinFee.toFixed(2), // GST is NOT platform profit
        description:  `Payin fee · UTR ${claimed.utr} · ${merchantRow?.name ?? `merchant #${claimed.merchantId}`}`,
      });
      if (charge.gstAmount > 0) {
        await appendTaxLiabilityEntry({
          sourceType:  "payin_fee",
          sourceId:    claimed.id,
          merchantId:  claimed.merchantId,
          gstAmount:   charge.gstAmount.toFixed(2),
          description: `GST on payin fee · UTR ${claimed.utr}`,
        });
      }
    }

    // If this transaction was linked to a payment link, check if it should be marked completed
    if (claimed.paymentLinkId) {
      const linkRows = await db
        .select({ maxPayments: paymentLinksTable.maxPayments, status: paymentLinksTable.status })
        .from(paymentLinksTable)
        .where(eq(paymentLinksTable.id, claimed.paymentLinkId))
        .limit(1);
      const link = linkRows[0];
      if (link && link.maxPayments != null && link.status !== "completed") {
        const [{ successCount }] = await db
          .select({ successCount: count() })
          .from(transactionsTable)
          .where(and(
            eq(transactionsTable.paymentLinkId, claimed.paymentLinkId),
            eq(transactionsTable.status, "success") as any,
          ));
        if (successCount >= link.maxPayments) {
          await db.update(paymentLinksTable)
            .set({ status: "completed", updatedAt: new Date() })
            .where(eq(paymentLinksTable.id, claimed.paymentLinkId));
        }
      }
    }

    req.log.info({ txId: id, merchantId: claimed.merchantId, amount: grossAmount, utr: claimed.utr }, "utr_approved");
    res.json({ message: "Approved and wallet credited" });
  } catch (err) { next(err); }
});

// ── POST /api/admin/utr-verifications/:id/reject ──────────────────────────────
router.post("/:id/reject", async (req, res, next) => {
  try {
    const id = parseInt(req.params["id"] as string);
    const adminEmail: string = (req as any).user.email;
    const { reason } = req.body as { reason?: string };

    // Atomic status guard
    const [claimed] = await db
      .update(transactionsTable)
      .set({
        status: "failed",
        description: reason?.trim() || "Rejected by admin",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(transactionsTable.id, id),
          eq(transactionsTable.status, "pending_verification"),
          eq(transactionsTable.provider, "own_static_upi"),
        ) as any,
      )
      .returning();

    if (!claimed) {
      res.status(409).json({ error: "Transaction not found or already processed" });
      return;
    }

    // Update metadata with review info
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(claimed.metadata ?? "{}"); } catch { /* ignore */ }
    meta["reviewedAt"] = new Date().toISOString();
    meta["reviewedByEmail"] = adminEmail;
    await db
      .update(transactionsTable)
      .set({ metadata: JSON.stringify(meta) })
      .where(eq(transactionsTable.id, id));

    // If link was in pending_verification and no other pending txns remain, revert to active
    if (claimed.paymentLinkId) {
      const linkRows = await db
        .select({ maxPayments: paymentLinksTable.maxPayments, status: paymentLinksTable.status })
        .from(paymentLinksTable)
        .where(eq(paymentLinksTable.id, claimed.paymentLinkId))
        .limit(1);
      const link = linkRows[0];
      if (link && link.status === "pending_verification") {
        const [{ pendingCount }] = await db
          .select({ pendingCount: count() })
          .from(transactionsTable)
          .where(and(
            eq(transactionsTable.paymentLinkId, claimed.paymentLinkId),
            eq(transactionsTable.status, "pending_verification") as any,
          ));
        if (pendingCount === 0) {
          await db.update(paymentLinksTable)
            .set({ status: "active", updatedAt: new Date() })
            .where(and(
              eq(paymentLinksTable.id, claimed.paymentLinkId),
              eq(paymentLinksTable.status, "pending_verification") as any,
            ));
        }
      }
    }

    req.log.info({ txId: id, merchantId: claimed.merchantId, utr: claimed.utr, reason }, "utr_rejected");
    res.json({ message: "Rejected" });
  } catch (err) { next(err); }
});

export default router;
