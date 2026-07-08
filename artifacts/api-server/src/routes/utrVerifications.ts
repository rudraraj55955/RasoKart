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
import { db, transactionsTable, merchantsTable } from "@workspace/db";
import { eq, and, desc, ilike, or } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { mutateWallet } from "./wallets";

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

    // Credit merchant wallet
    const amount = parseFloat(claimed.amount as string);
    await mutateWallet(
      claimed.merchantId,
      { availableDelta: amount, totalCollectionDelta: amount },
      {
        txnType: "deposit",
        bucket: "available",
        amount,
        referenceType: "transaction",
        referenceId: claimed.id,
        description: `UTR ${claimed.utr} approved`,
      },
    );

    req.log.info({ txId: id, merchantId: claimed.merchantId, amount, utr: claimed.utr }, "utr_approved");
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

    req.log.info({ txId: id, merchantId: claimed.merchantId, utr: claimed.utr, reason }, "utr_rejected");
    res.json({ message: "Rejected" });
  } catch (err) { next(err); }
});

export default router;
