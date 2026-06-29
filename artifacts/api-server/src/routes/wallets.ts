import { Router } from "express";
import { db, merchantWalletsTable, walletLedgerTable, walletHoldsTable, walletChargesTable, merchantsTable, auditLogsTable } from "@workspace/db";
import { eq, and, desc, count, ilike, or, sql, lt } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

function parseId(s: string | string[]): number {
  return parseInt(Array.isArray(s) ? s[0] : s, 10);
}
function numStr(n: string | null | undefined): number {
  return n == null ? 0 : Number(n);
}
function fmtNum(n: number): string { return n.toFixed(2); }

// Drizzle transaction type — works for both `db` and the `tx` callback parameter
type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// ── Helper: ensure wallet row exists for a merchant ───────────────────────────
async function ensureWallet(tx: DbOrTx, merchantId: number) {
  await tx
    .insert(merchantWalletsTable)
    .values({ merchantId })
    .onConflictDoNothing();
  const [w] = await tx
    .select()
    .from(merchantWalletsTable)
    .where(eq(merchantWalletsTable.merchantId, merchantId))
    .limit(1);
  if (!w) throw new Error("Wallet not found after upsert");
  return w;
}

// ── Helper: atomic wallet bucket update + ledger entry ────────────────────────
interface WalletMutation {
  availableDelta?: number;
  pendingDelta?: number;
  holdDelta?: number;
  settlementDelta?: number;
  payoutDelta?: number;
  totalCollectionDelta?: number;
  totalPayoutDelta?: number;
  totalChargesDelta?: number;
  totalRefundsDelta?: number;
  totalReversalsDelta?: number;
}
interface LedgerParams {
  txnType: string;
  bucket: string;
  amount: number;
  referenceType?: string;
  referenceId?: number | null;
  description: string;
  createdBy?: number | null;
}

async function mutateWallet(
  merchantId: number,
  mutation: WalletMutation,
  ledger: LedgerParams
): Promise<typeof walletLedgerTable.$inferSelect> {
  return await db.transaction(async (tx) => {
    const w = await ensureWallet(tx, merchantId);

    const avBefore = numStr(w.availableBalance);
    const peBefore = numStr(w.pendingBalance);

    const updates: Partial<typeof merchantWalletsTable.$inferInsert> = {};
    if (mutation.availableDelta)       updates.availableBalance  = fmtNum(avBefore + mutation.availableDelta);
    if (mutation.pendingDelta)         updates.pendingBalance     = fmtNum(peBefore + mutation.pendingDelta);
    if (mutation.holdDelta)            updates.holdBalance        = fmtNum(numStr(w.holdBalance)        + mutation.holdDelta);
    if (mutation.settlementDelta)      updates.settlementBalance  = fmtNum(numStr(w.settlementBalance)  + mutation.settlementDelta);
    if (mutation.payoutDelta)          updates.payoutBalance      = fmtNum(numStr(w.payoutBalance)      + mutation.payoutDelta);
    if (mutation.totalCollectionDelta) updates.totalCollection    = fmtNum(numStr(w.totalCollection)    + mutation.totalCollectionDelta);
    if (mutation.totalPayoutDelta)     updates.totalPayout        = fmtNum(numStr(w.totalPayout)        + mutation.totalPayoutDelta);
    if (mutation.totalChargesDelta)    updates.totalCharges       = fmtNum(numStr(w.totalCharges)       + mutation.totalChargesDelta);
    if (mutation.totalRefundsDelta)    updates.totalRefunds       = fmtNum(numStr(w.totalRefunds)       + mutation.totalRefundsDelta);
    if (mutation.totalReversalsDelta)  updates.totalReversals     = fmtNum(numStr(w.totalReversals)     + mutation.totalReversalsDelta);

    if (Object.keys(updates).length > 0) {
      await tx.update(merchantWalletsTable).set(updates).where(eq(merchantWalletsTable.merchantId, merchantId));
    }

    const avAfter = mutation.availableDelta != null ? avBefore + mutation.availableDelta : avBefore;
    const peAfter = mutation.pendingDelta   != null ? peBefore + mutation.pendingDelta   : peBefore;

    const [entry] = await tx
      .insert(walletLedgerTable)
      .values({
        merchantId,
        txnType: ledger.txnType,
        bucket: ledger.bucket,
        amount: fmtNum(ledger.amount),
        availableBefore: fmtNum(avBefore),
        availableAfter:  fmtNum(avAfter),
        pendingBefore:   fmtNum(peBefore),
        pendingAfter:    fmtNum(peAfter),
        referenceType:   ledger.referenceType ?? null,
        referenceId:     ledger.referenceId   ?? null,
        description:     ledger.description,
        createdBy:       ledger.createdBy      ?? null,
      })
      .returning();
    return entry;
  });
}

function mapWallet(w: typeof merchantWalletsTable.$inferSelect, merchantName?: string | null) {
  return {
    id: w.id,
    merchantId: w.merchantId,
    merchantName: merchantName ?? null,
    currency: w.currency,
    availableBalance:  numStr(w.availableBalance),
    pendingBalance:    numStr(w.pendingBalance),
    holdBalance:       numStr(w.holdBalance),
    settlementBalance: numStr(w.settlementBalance),
    payoutBalance:     numStr(w.payoutBalance),
    totalCollection:   numStr(w.totalCollection),
    totalPayout:       numStr(w.totalPayout),
    totalCharges:      numStr(w.totalCharges),
    totalRefunds:      numStr(w.totalRefunds),
    totalReversals:    numStr(w.totalReversals),
    updatedAt: w.updatedAt,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MERCHANT routes (own wallet only)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/wallets/me
router.get("/me", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" }); return;
    }
    const [merchant] = await db.select({ businessName: merchantsTable.businessName })
      .from(merchantsTable).where(eq(merchantsTable.id, user.merchantId)).limit(1);
    await ensureWallet(db, user.merchantId);
    const [w] = await db.select().from(merchantWalletsTable)
      .where(eq(merchantWalletsTable.merchantId, user.merchantId)).limit(1);
    res.json(mapWallet(w, merchant?.businessName));
  } catch (err) { next(err); }
});

// GET /api/wallets/me/ledger
router.get("/me/ledger", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" }); return;
    }
    const { page = "1", limit = "50", txnType } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;
    const mid = user.merchantId;

    const conditions = [eq(walletLedgerTable.merchantId, mid)];
    if (txnType && txnType !== "all") conditions.push(eq(walletLedgerTable.txnType, txnType));

    const where = and(...conditions);
    const [[{ total }], rows] = await Promise.all([
      db.select({ total: count() }).from(walletLedgerTable).where(where),
      db.select().from(walletLedgerTable).where(where)
        .orderBy(desc(walletLedgerTable.createdAt)).limit(limitNum).offset(offset),
    ]);
    res.json({ data: rows.map(r => ({ ...r, amount: numStr(r.amount), availableBefore: numStr(r.availableBefore), availableAfter: numStr(r.availableAfter), pendingBefore: numStr(r.pendingBefore), pendingAfter: numStr(r.pendingAfter) })), total: Number(total), page: pageNum, limit: limitNum });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN routes
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/wallets — list all merchant wallets
router.get("/", requireAdmin, async (req, res, next) => {
  try {
    const { search = "", page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const merchantCondition = search.trim()
      ? or(ilike(merchantsTable.businessName, `%${search.trim()}%`), ilike(merchantsTable.email, `%${search.trim()}%`))
      : undefined;

    const baseQuery = db.select({
      wallet: merchantWalletsTable,
      businessName: merchantsTable.businessName,
      email: merchantsTable.email,
      status: merchantsTable.status,
    })
      .from(merchantsTable)
      .leftJoin(merchantWalletsTable, eq(merchantsTable.id, merchantWalletsTable.merchantId))
      .where(merchantCondition);

    const [[{ total }], rows] = await Promise.all([
      db.select({ total: count() }).from(merchantsTable).where(merchantCondition),
      baseQuery.orderBy(desc(merchantWalletsTable.availableBalance)).limit(limitNum).offset(offset),
    ]);

    res.json({
      data: rows.map(r => ({
        merchantId: r.wallet?.merchantId ?? null,
        businessName: r.businessName,
        email: r.email,
        merchantStatus: r.status,
        wallet: r.wallet ? mapWallet(r.wallet, r.businessName) : null,
      })),
      total: Number(total), page: pageNum, limit: limitNum,
    });
  } catch (err) { next(err); }
});

// GET /api/wallets/:merchantId — single merchant wallet detail
router.get("/:merchantId", requireAdmin, async (req, res, next) => {
  try {
    const merchantId = parseId(req.params["merchantId"] as string);
    const [[merchant]] = await Promise.all([
      db.select({ businessName: merchantsTable.businessName, email: merchantsTable.email, status: merchantsTable.status })
        .from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1),
    ]);
    if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }
    await ensureWallet(db, merchantId);
    const [[w], activeHolds] = await Promise.all([
      db.select().from(merchantWalletsTable).where(eq(merchantWalletsTable.merchantId, merchantId)).limit(1),
      db.select().from(walletHoldsTable)
        .where(and(eq(walletHoldsTable.merchantId, merchantId), eq(walletHoldsTable.status, "active")))
        .orderBy(desc(walletHoldsTable.createdAt)),
    ]);
    res.json({
      merchant: { id: merchantId, ...merchant },
      wallet: mapWallet(w, merchant.businessName),
      activeHolds: activeHolds.map(h => ({ ...h, amount: numStr(h.amount) })),
    });
  } catch (err) { next(err); }
});

// GET /api/wallets/:merchantId/ledger
router.get("/:merchantId/ledger", requireAdmin, async (req, res, next) => {
  try {
    const merchantId = parseId(req.params["merchantId"] as string);
    const { page = "1", limit = "50", txnType } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [eq(walletLedgerTable.merchantId, merchantId)];
    if (txnType && txnType !== "all") conditions.push(eq(walletLedgerTable.txnType, txnType));
    const where = and(...conditions);

    const [[{ total }], rows] = await Promise.all([
      db.select({ total: count() }).from(walletLedgerTable).where(where),
      db.select().from(walletLedgerTable).where(where)
        .orderBy(desc(walletLedgerTable.createdAt)).limit(limitNum).offset(offset),
    ]);
    res.json({
      data: rows.map(r => ({ ...r, amount: numStr(r.amount), availableBefore: numStr(r.availableBefore), availableAfter: numStr(r.availableAfter), pendingBefore: numStr(r.pendingBefore), pendingAfter: numStr(r.pendingAfter) })),
      total: Number(total), page: pageNum, limit: limitNum,
    });
  } catch (err) { next(err); }
});

// GET /api/wallets/:merchantId/holds — list holds
router.get("/:merchantId/holds", requireAdmin, async (req, res, next) => {
  try {
    const merchantId = parseId(req.params["merchantId"] as string);
    const { status } = req.query as Record<string, string>;
    const conds = [eq(walletHoldsTable.merchantId, merchantId)];
    if (status && status !== "all") conds.push(eq(walletHoldsTable.status, status));
    const holds = await db.select().from(walletHoldsTable).where(and(...conds))
      .orderBy(desc(walletHoldsTable.createdAt));
    res.json({ data: holds.map(h => ({ ...h, amount: numStr(h.amount) })) });
  } catch (err) { next(err); }
});

// POST /api/wallets/:merchantId/adjust — manual credit or debit
router.post("/:merchantId/adjust", requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const merchantId = parseId(req.params["merchantId"] as string);
    const { bucket, amount, description } = req.body as { bucket?: string; amount?: number; description?: string };

    const validBuckets = ["available", "pending", "hold", "settlement", "payout"];
    if (!bucket || !validBuckets.includes(bucket)) {
      res.status(400).json({ error: `bucket must be one of: ${validBuckets.join(", ")}` }); return;
    }
    if (!amount || typeof amount !== "number" || amount === 0) {
      res.status(400).json({ error: "amount must be a non-zero number (positive=credit, negative=debit)" }); return;
    }
    if (!description?.trim()) { res.status(400).json({ error: "description is required" }); return; }

    const [merchant] = await db.select({ businessName: merchantsTable.businessName })
      .from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
    if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }

    const mutation: WalletMutation = {};
    const bucketKey = `${bucket}Delta` as keyof WalletMutation;
    (mutation as any)[bucketKey] = amount;

    const txnType = amount > 0 ? "manual_credit" : "manual_debit";
    const entry = await mutateWallet(merchantId, mutation, {
      txnType, bucket, amount,
      referenceType: "manual",
      description: description.trim(),
      createdBy: user.id,
    });

    await db.insert(auditLogsTable).values({
      adminId: user.id, adminEmail: user.email,
      action: "wallet_manual_adjust",
      targetType: "merchant", targetId: merchantId,
      details: JSON.stringify({ bucket, amount, description: description.trim(), ledgerId: entry.id }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ merchantId, bucket, amount }, "wallet_manual_adjust");
    res.status(201).json({ ...entry, amount: numStr(entry.amount), availableBefore: numStr(entry.availableBefore), availableAfter: numStr(entry.availableAfter), pendingBefore: numStr(entry.pendingBefore), pendingAfter: numStr(entry.pendingAfter) });
  } catch (err) { next(err); }
});

// POST /api/wallets/:merchantId/hold — create hold (deducts from available, adds to hold)
router.post("/:merchantId/hold", requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const merchantId = parseId(req.params["merchantId"] as string);
    const { amount, reason, expiresAt } = req.body as { amount?: number; reason?: string; expiresAt?: string };

    if (!amount || typeof amount !== "number" || amount <= 0) {
      res.status(400).json({ error: "amount must be a positive number" }); return;
    }
    if (!reason?.trim()) { res.status(400).json({ error: "reason is required" }); return; }

    const [merchant] = await db.select({ businessName: merchantsTable.businessName })
      .from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
    if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }

    let holdId: number;
    try {
      await db.transaction(async (tx) => {
        const w = await ensureWallet(tx, merchantId);
        if (numStr(w.availableBalance) < amount) {
          throw Object.assign(new Error("Insufficient available balance for hold"), { statusCode: 400 });
        }
        const avBefore = numStr(w.availableBalance);
        const holBefore = numStr(w.holdBalance);

        await tx.update(merchantWalletsTable).set({
          availableBalance: fmtNum(avBefore - amount),
          holdBalance: fmtNum(holBefore + amount),
        }).where(eq(merchantWalletsTable.merchantId, merchantId));

        const [hold] = await tx.insert(walletHoldsTable).values({
          merchantId, amount: fmtNum(amount), reason: reason.trim(), status: "active",
          createdBy: user.id,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
        }).returning();
        holdId = hold.id;

        await tx.insert(walletLedgerTable).values({
          merchantId, txnType: "hold_created", bucket: "hold",
          amount: fmtNum(amount),
          availableBefore: fmtNum(avBefore),   availableAfter: fmtNum(avBefore - amount),
          pendingBefore: w.pendingBalance ?? "0", pendingAfter: w.pendingBalance ?? "0",
          referenceType: "hold", referenceId: hold.id,
          description: `Hold created: ${reason.trim()}`,
          createdBy: user.id,
        });
      });
    } catch (err: any) {
      res.status(err?.statusCode ?? 500).json({ error: err?.message ?? "Hold failed" }); return;
    }

    await db.insert(auditLogsTable).values({
      adminId: user.id, adminEmail: user.email, action: "wallet_hold_created",
      targetType: "merchant", targetId: merchantId,
      details: JSON.stringify({ amount, reason: reason.trim(), holdId: holdId! }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ merchantId, amount, holdId: holdId! }, "wallet_hold_created");
    const [hold] = await db.select().from(walletHoldsTable).where(eq(walletHoldsTable.id, holdId!)).limit(1);
    res.status(201).json({ ...hold, amount: numStr(hold.amount) });
  } catch (err) { next(err); }
});

// PUT /api/wallets/holds/:holdId/release — release a hold
router.put("/holds/:holdId/release", requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const holdId = parseId(req.params["holdId"] as string);

    const [hold] = await db.select().from(walletHoldsTable).where(eq(walletHoldsTable.id, holdId)).limit(1);
    if (!hold) { res.status(404).json({ error: "Hold not found" }); return; }
    if (hold.status !== "active") { res.status(400).json({ error: `Hold is already ${hold.status}` }); return; }

    const holdAmount = numStr(hold.amount);
    try {
      await db.transaction(async (tx) => {
        const w = await ensureWallet(tx, hold.merchantId);
        const avBefore = numStr(w.availableBalance);
        const holBefore = numStr(w.holdBalance);

        await tx.update(merchantWalletsTable).set({
          availableBalance: fmtNum(avBefore + holdAmount),
          holdBalance: fmtNum(Math.max(0, holBefore - holdAmount)),
        }).where(eq(merchantWalletsTable.merchantId, hold.merchantId));

        await tx.update(walletHoldsTable).set({
          status: "released", releasedBy: user.id, releasedAt: new Date(),
        }).where(eq(walletHoldsTable.id, holdId));

        await tx.insert(walletLedgerTable).values({
          merchantId: hold.merchantId, txnType: "hold_released", bucket: "available",
          amount: fmtNum(holdAmount),
          availableBefore: fmtNum(avBefore), availableAfter: fmtNum(avBefore + holdAmount),
          pendingBefore: w.pendingBalance ?? "0", pendingAfter: w.pendingBalance ?? "0",
          referenceType: "hold", referenceId: holdId,
          description: `Hold released: ${hold.reason}`,
          createdBy: user.id,
        });
      });
    } catch (err: any) {
      res.status(err?.statusCode ?? 500).json({ error: err?.message ?? "Release failed" }); return;
    }

    await db.insert(auditLogsTable).values({
      adminId: user.id, adminEmail: user.email, action: "wallet_hold_released",
      targetType: "merchant", targetId: hold.merchantId,
      details: JSON.stringify({ holdId, amount: holdAmount }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ holdId, merchantId: hold.merchantId, amount: holdAmount }, "wallet_hold_released");
    const [updated] = await db.select().from(walletHoldsTable).where(eq(walletHoldsTable.id, holdId)).limit(1);
    res.json({ ...updated, amount: numStr(updated.amount) });
  } catch (err) { next(err); }
});

// POST /api/wallets/:merchantId/charge — admin applies a charge
router.post("/:merchantId/charge", requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const merchantId = parseId(req.params["merchantId"] as string);
    const { amount, chargeType = "fee", description } = req.body as { amount?: number; chargeType?: string; description?: string };

    if (!amount || typeof amount !== "number" || amount <= 0) {
      res.status(400).json({ error: "amount must be a positive number" }); return;
    }
    if (!description?.trim()) { res.status(400).json({ error: "description is required" }); return; }

    const [merchant] = await db.select({ businessName: merchantsTable.businessName })
      .from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
    if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }

    await db.transaction(async (tx) => {
      const w = await ensureWallet(tx, merchantId);
      if (numStr(w.availableBalance) < amount) throw Object.assign(new Error("Insufficient available balance"), { statusCode: 400 });

      const avBefore = numStr(w.availableBalance);
      await tx.update(merchantWalletsTable).set({
        availableBalance: fmtNum(avBefore - amount),
        totalCharges: fmtNum(numStr(w.totalCharges) + amount),
      }).where(eq(merchantWalletsTable.merchantId, merchantId));

      const [charge] = await tx.insert(walletChargesTable).values({
        merchantId, amount: fmtNum(amount), chargeType, description: description.trim(),
      }).returning();

      await tx.insert(walletLedgerTable).values({
        merchantId, txnType: "charge", bucket: "available", amount: fmtNum(-amount),
        availableBefore: fmtNum(avBefore), availableAfter: fmtNum(avBefore - amount),
        pendingBefore: w.pendingBalance ?? "0", pendingAfter: w.pendingBalance ?? "0",
        referenceType: "charge", referenceId: charge.id,
        description: `Charge (${chargeType}): ${description.trim()}`,
        createdBy: user.id,
      });
    });

    req.log.info({ merchantId, amount, chargeType }, "wallet_charge_applied");
    res.status(201).json({ message: "Charge applied" });
  } catch (err: any) {
    if (err?.statusCode) { res.status(err.statusCode).json({ error: err.message }); return; }
    next(err);
  }
});

// POST /api/wallets/:merchantId/load — admin loads (credits) merchant wallet
router.post("/:merchantId/load", requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const merchantId = parseId(req.params["merchantId"] as string);
    const body = req.body as { amount?: number; note?: string; remarks?: string };
    const { amount } = body;
    const note = body.note?.trim() || body.remarks?.trim();

    if (!amount || typeof amount !== "number" || amount <= 0) {
      res.status(400).json({ error: "amount must be a positive number" }); return;
    }
    if (!note) { res.status(400).json({ error: "Note / reason is required" }); return; }

    const [merchant] = await db.select({ businessName: merchantsTable.businessName })
      .from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
    if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }

    const entry = await mutateWallet(merchantId, { availableDelta: amount }, {
      txnType: "admin_wallet_load",
      bucket: "available",
      amount,
      referenceType: "manual",
      description: `Admin wallet load: ${note.trim()}`,
      createdBy: user.id,
    });

    await db.insert(auditLogsTable).values({
      adminId: user.id, adminEmail: user.email,
      action: "admin_wallet_load",
      targetType: "merchant", targetId: merchantId,
      details: JSON.stringify({ amount, note: note.trim(), ledgerId: entry.id }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ merchantId, amount, note: note.trim() }, "admin_wallet_load");
    res.status(201).json({ message: "Wallet loaded", amount, ledgerId: entry.id });
  } catch (err) { next(err); }
});

// ── Expire old holds (called periodically; also available as admin endpoint) ──
async function expireOldHolds() {
  const now = new Date();
  const expired = await db.select().from(walletHoldsTable)
    .where(and(eq(walletHoldsTable.status, "active"), lt(walletHoldsTable.expiresAt, now)));
  for (const hold of expired) {
    const holdAmount = numStr(hold.amount);
    await db.transaction(async (tx) => {
      const w = await ensureWallet(tx, hold.merchantId);
      const avBefore = numStr(w.availableBalance);
      await tx.update(merchantWalletsTable).set({
        availableBalance: fmtNum(avBefore + holdAmount),
        holdBalance: fmtNum(Math.max(0, numStr(w.holdBalance) - holdAmount)),
      }).where(eq(merchantWalletsTable.merchantId, hold.merchantId));
      await tx.update(walletHoldsTable).set({ status: "expired" }).where(eq(walletHoldsTable.id, hold.id));
      await tx.insert(walletLedgerTable).values({
        merchantId: hold.merchantId, txnType: "hold_released", bucket: "available",
        amount: fmtNum(holdAmount),
        availableBefore: fmtNum(avBefore), availableAfter: fmtNum(avBefore + holdAmount),
        pendingBefore: w.pendingBalance ?? "0", pendingAfter: w.pendingBalance ?? "0",
        referenceType: "hold", referenceId: hold.id,
        description: `Hold auto-expired: ${hold.reason}`,
        createdBy: null,
      });
    });
  }
}

export { mutateWallet, ensureWallet };
export default router;
