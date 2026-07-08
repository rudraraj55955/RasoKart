/**
 * Admin — Payout Wallet Load management
 * /api/admin/payout-wallet-loads/*
 *
 * Handles:
 *  - Listing all load orders (with filters)
 *  - Viewing a single load order (with provider details)
 *  - Approving a UTR/bank transfer request → credits wallet
 *  - Rejecting a UTR/bank transfer request
 *  - Admin manual top-up (ADMIN_TOPUP method)
 *  - Wallet load settings management
 */
import { Router } from "express";
import {
  db,
  merchantsTable,
  merchantWalletsTable,
  walletLedgerTable,
  systemConfigTable,
  SYSTEM_CONFIG_KEYS,
  payoutWalletLoadOrdersTable,
  auditLogsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc, count, inArray, ilike, or, sql } from "drizzle-orm";
import { requireAuth, requireAnyAdmin } from "../middlewares/auth";
import { logger } from "../lib/logger";
import crypto from "crypto";

const router = Router();
router.use(requireAuth, requireAnyAdmin);

function numStr(v: string | number | null | undefined): number {
  return v == null ? 0 : Number(v);
}
function fmtNum(n: number): string { return n.toFixed(2); }

function makeLoadId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `WLOAD-${ts}-${rnd}`;
}

// ─── GET /api/admin/payout-wallet-loads ──────────────────────────────────────
router.get("/", async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt((req.query.limit as string) ?? "50"), 200);
    const offset = parseInt((req.query.offset as string) ?? "0");
    const status  = req.query.status as string | undefined;
    const method  = req.query.method as string | undefined;
    const search  = req.query.search as string | undefined;

    const conditions: any[] = [];
    if (status && status !== "ALL") {
      conditions.push(eq(payoutWalletLoadOrdersTable.status, status));
    }
    if (method && method !== "ALL") {
      conditions.push(eq(payoutWalletLoadOrdersTable.method, method));
    }

    const rows = await db
      .select({
        id:             payoutWalletLoadOrdersTable.id,
        loadId:         payoutWalletLoadOrdersTable.loadId,
        merchantId:     payoutWalletLoadOrdersTable.merchantId,
        amount:         payoutWalletLoadOrdersTable.amount,
        feeAmount:      payoutWalletLoadOrdersTable.feeAmount,
        gstAmount:      payoutWalletLoadOrdersTable.gstAmount,
        netCreditAmount: payoutWalletLoadOrdersTable.netCreditAmount,
        method:         payoutWalletLoadOrdersTable.method,
        status:         payoutWalletLoadOrdersTable.status,
        internalOrderId: payoutWalletLoadOrdersTable.internalOrderId,
        providerPaymentId: payoutWalletLoadOrdersTable.providerPaymentId,
        utr:            payoutWalletLoadOrdersTable.utr,
        payerName:      payoutWalletLoadOrdersTable.payerName,
        payerReference: payoutWalletLoadOrdersTable.payerReference,
        screenshotUrl:  payoutWalletLoadOrdersTable.screenshotUrl,
        rejectionReason: payoutWalletLoadOrdersTable.rejectionReason,
        adminNote:      payoutWalletLoadOrdersTable.adminNote,
        creditedAt:     payoutWalletLoadOrdersTable.creditedAt,
        approvedBy:     payoutWalletLoadOrdersTable.approvedBy,
        approvedAt:     payoutWalletLoadOrdersTable.approvedAt,
        createdAt:      payoutWalletLoadOrdersTable.createdAt,
        updatedAt:      payoutWalletLoadOrdersTable.updatedAt,
        businessName:   merchantsTable.businessName,
        merchantEmail:  merchantsTable.email,
      })
      .from(payoutWalletLoadOrdersTable)
      .leftJoin(merchantsTable, eq(payoutWalletLoadOrdersTable.merchantId, merchantsTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(payoutWalletLoadOrdersTable.createdAt))
      .limit(limit)
      .offset(offset);

    // Filter by search in JS (UTR, business name)
    const filtered = search
      ? rows.filter((r) => {
          const q = search.toLowerCase();
          return (
            r.loadId?.toLowerCase().includes(q) ||
            r.utr?.toLowerCase().includes(q) ||
            r.businessName?.toLowerCase().includes(q) ||
            r.merchantEmail?.toLowerCase().includes(q) ||
            r.payerName?.toLowerCase().includes(q)
          );
        })
      : rows;

    // Attach approver emails
    const approverIds = [...new Set(filtered.map((r) => r.approvedBy).filter(Boolean))] as number[];
    const approvers: Record<number, string> = {};
    if (approverIds.length > 0) {
      const approverRows = await db
        .select({ id: usersTable.id, email: usersTable.email })
        .from(usersTable)
        .where(inArray(usersTable.id, approverIds));
      approverRows.forEach((u) => { approvers[u.id] = u.email; });
    }

    res.json({
      data: filtered.map((r) => ({
        ...r,
        approvedByEmail: r.approvedBy ? (approvers[r.approvedBy] ?? null) : null,
      })),
      limit,
      offset,
    });
  } catch (err) { next(err); }
});

// ─── GET /api/admin/payout-wallet-loads/settings ─────────────────────────────
router.get("/settings", async (_req, res, next) => {
  try {
    const keys = [
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_ENABLED,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_ONLINE_ENABLED,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_MANUAL_UTR_ENABLED,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_ADMIN_TOPUP_ENABLED,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_MIN_AMOUNT,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_MAX_AMOUNT,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_FEE_TYPE,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_FEE_VALUE,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_GST_ON_FEE,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_REQUIRE_SCREENSHOT,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_BANK_NAME,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_ACCOUNT_NUMBER,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_IFSC,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_ACCOUNT_HOLDER,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_UPI_ID,
    ];
    const rows = await db
      .select({ key: systemConfigTable.key, value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(inArray(systemConfigTable.key, keys));
    const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    res.json(cfg);
  } catch (err) { next(err); }
});

// ─── PUT /api/admin/payout-wallet-loads/settings ─────────────────────────────
router.put("/settings", async (req: any, res, next) => {
  try {
    const updates: Record<string, string> = req.body ?? {};
    const adminEmail: string = req.user.email;
    const allowedKeys = new Set([
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_ENABLED,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_ONLINE_ENABLED,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_MANUAL_UTR_ENABLED,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_ADMIN_TOPUP_ENABLED,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_MIN_AMOUNT,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_MAX_AMOUNT,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_FEE_TYPE,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_FEE_VALUE,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_GST_ON_FEE,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_REQUIRE_SCREENSHOT,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_BANK_NAME,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_ACCOUNT_NUMBER,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_IFSC,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_ACCOUNT_HOLDER,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_UPI_ID,
    ]);

    for (const [key, value] of Object.entries(updates)) {
      if (!allowedKeys.has(key as any)) continue;
      await db
        .insert(systemConfigTable)
        .values({ key, value: String(value), updatedByEmail: adminEmail })
        .onConflictDoUpdate({
          target: systemConfigTable.key,
          set: { value: String(value), updatedByEmail: adminEmail, updatedAt: new Date() },
        });
    }

    await db.insert(auditLogsTable).values({
      adminId:    req.user.id,
      adminEmail: req.user.email ?? "admin@rasokart.com",
      action:     "WALLET_LOAD_SETTINGS_UPDATED",
      targetType: "system_config",
      details:    JSON.stringify(updates),
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── GET /api/admin/payout-wallet-loads/:id ───────────────────────────────────
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params["id"] as string);
    const [row] = await db
      .select({
        id:             payoutWalletLoadOrdersTable.id,
        loadId:         payoutWalletLoadOrdersTable.loadId,
        merchantId:     payoutWalletLoadOrdersTable.merchantId,
        amount:         payoutWalletLoadOrdersTable.amount,
        feeAmount:      payoutWalletLoadOrdersTable.feeAmount,
        gstAmount:      payoutWalletLoadOrdersTable.gstAmount,
        netCreditAmount: payoutWalletLoadOrdersTable.netCreditAmount,
        method:         payoutWalletLoadOrdersTable.method,
        status:         payoutWalletLoadOrdersTable.status,
        internalOrderId: payoutWalletLoadOrdersTable.internalOrderId,
        providerPaymentId: payoutWalletLoadOrdersTable.providerPaymentId,
        utr:            payoutWalletLoadOrdersTable.utr,
        payerName:      payoutWalletLoadOrdersTable.payerName,
        payerReference: payoutWalletLoadOrdersTable.payerReference,
        screenshotUrl:  payoutWalletLoadOrdersTable.screenshotUrl,
        rejectionReason: payoutWalletLoadOrdersTable.rejectionReason,
        adminNote:      payoutWalletLoadOrdersTable.adminNote,
        creditedAt:     payoutWalletLoadOrdersTable.creditedAt,
        approvedBy:     payoutWalletLoadOrdersTable.approvedBy,
        approvedAt:     payoutWalletLoadOrdersTable.approvedAt,
        createdAt:      payoutWalletLoadOrdersTable.createdAt,
        businessName:   merchantsTable.businessName,
        merchantEmail:  merchantsTable.email,
      })
      .from(payoutWalletLoadOrdersTable)
      .leftJoin(merchantsTable, eq(payoutWalletLoadOrdersTable.merchantId, merchantsTable.id))
      .where(eq(payoutWalletLoadOrdersTable.id, id))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Load order not found" }); return; }
    res.json(row);
  } catch (err) { next(err); }
});

// ─── POST /api/admin/payout-wallet-loads/:id/approve ─────────────────────────
// Approves a PENDING_VERIFICATION (UTR) load → credits wallet.
router.post("/:id/approve", async (req: any, res, next) => {
  try {
    const id = parseInt(req.params["id"] as string);
    const { adminNote } = req.body ?? {};
    const adminUserId: number = req.user.id;

    const result = await db.transaction(async (tx) => {
      // Atomic claim: only approve PENDING_VERIFICATION orders
      const [claimed] = await tx
        .update(payoutWalletLoadOrdersTable)
        .set({
          status:     "SUCCESS",
          approvedBy: adminUserId,
          approvedAt: new Date(),
          creditedAt: new Date(),
          adminNote:  adminNote ?? null,
          updatedAt:  new Date(),
        })
        .where(
          and(
            eq(payoutWalletLoadOrdersTable.id, id),
            eq(payoutWalletLoadOrdersTable.status, "PENDING_VERIFICATION"),
          )
        )
        .returning();

      if (!claimed) return null;

      // Ensure wallet row exists
      await tx
        .insert(merchantWalletsTable)
        .values({ merchantId: claimed.merchantId })
        .onConflictDoNothing();

      const [wallet] = await tx
        .select()
        .from(merchantWalletsTable)
        .where(eq(merchantWalletsTable.merchantId, claimed.merchantId))
        .for("update")
        .limit(1);

      const avBefore  = numStr(wallet?.availableBalance);
      const netCredit = numStr(claimed.netCreditAmount);
      const avAfter   = avBefore + netCredit;

      await tx
        .update(merchantWalletsTable)
        .set({
          availableBalance: fmtNum(avAfter),
          totalCollection:  fmtNum(numStr(wallet?.totalCollection) + netCredit),
          updatedAt: new Date(),
        })
        .where(eq(merchantWalletsTable.merchantId, claimed.merchantId));

      const ledgerEntry = await tx.insert(walletLedgerTable).values({
        merchantId:      claimed.merchantId,
        txnType:         "wallet_load_manual_credit",
        bucket:          "available",
        amount:          fmtNum(netCredit),
        availableBefore: fmtNum(avBefore),
        availableAfter:  fmtNum(avAfter),
        pendingBefore:   fmtNum(numStr(wallet?.pendingBalance)),
        pendingAfter:    fmtNum(numStr(wallet?.pendingBalance)),
        referenceType:   "wallet_load",
        referenceId:     claimed.id,
        description:     `Manual UTR deposit approved — ${claimed.utr ?? claimed.loadId}`,
        createdBy:       adminUserId,
      }).returning();

      await tx.insert(auditLogsTable).values({
        adminId:    adminUserId,
        adminEmail: req.user.email ?? "admin@rasokart.com",
        action:     "WALLET_LOAD_MANUAL_APPROVED",
        targetType: "payout_wallet_load",
        targetId:   id,
        details:    JSON.stringify({ loadId: claimed.loadId, netCredit, utr: claimed.utr }),
      }).catch(() => {});

      return { claimed, avBefore, avAfter, netCredit };
    });

    if (!result) {
      res.status(409).json({ error: "Order is not in PENDING_VERIFICATION status or was already processed" });
      return;
    }

    res.json({ success: true, message: "Wallet load approved and credited successfully" });
  } catch (err) { next(err); }
});

// ─── POST /api/admin/payout-wallet-loads/:id/reject ──────────────────────────
router.post("/:id/reject", async (req: any, res, next) => {
  try {
    const id = parseInt(req.params["id"] as string);
    const { rejectionReason } = req.body ?? {};
    const adminUserId: number = req.user.id;

    if (!rejectionReason || typeof rejectionReason !== "string" || rejectionReason.trim().length < 5) {
      res.status(400).json({ error: "Rejection reason is required (min 5 characters)" });
      return;
    }

    const [rejected] = await db
      .update(payoutWalletLoadOrdersTable)
      .set({
        status:          "REJECTED",
        rejectionReason: rejectionReason.trim(),
        approvedBy:      adminUserId,
        approvedAt:      new Date(),
        updatedAt:       new Date(),
      })
      .where(
        and(
          eq(payoutWalletLoadOrdersTable.id, id),
          eq(payoutWalletLoadOrdersTable.status, "PENDING_VERIFICATION"),
        )
      )
      .returning({ id: payoutWalletLoadOrdersTable.id, loadId: payoutWalletLoadOrdersTable.loadId });

    if (!rejected) {
      res.status(409).json({ error: "Order is not in PENDING_VERIFICATION status or was already processed" });
      return;
    }

    await db.insert(auditLogsTable).values({
      adminId:    adminUserId,
      adminEmail: req.user.email ?? "admin@rasokart.com",
      action:     "WALLET_LOAD_REJECTED",
      targetType: "payout_wallet_load",
      targetId:   id,
      details:    JSON.stringify({ loadId: rejected.loadId, rejectionReason }),
    }).catch(() => {});

    res.json({ success: true, message: "Load request rejected" });
  } catch (err) { next(err); }
});

// ─── POST /api/admin/payout-wallet-loads/topup ───────────────────────────────
// Admin manual top-up — directly credits a merchant's payout wallet.
router.post("/topup", async (req: any, res, next) => {
  try {
    const { merchantId, amount, reason } = req.body ?? {};
    const adminUserId: number = req.user.id;

    if (!merchantId || !amount || !reason) {
      res.status(400).json({ error: "merchantId, amount, and reason are required" });
      return;
    }
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      res.status(400).json({ error: "Invalid amount" });
      return;
    }
    if (typeof reason !== "string" || reason.trim().length < 5) {
      res.status(400).json({ error: "Reason is required (min 5 characters)" });
      return;
    }

    const [merchant] = await db
      .select({ id: merchantsTable.id, businessName: merchantsTable.businessName })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, parseInt(String(merchantId))))
      .limit(1);
    if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }

    const loadId = makeLoadId();

    const { credited, loadOrderId } = await db.transaction(async (tx) => {
      const [loadOrder] = await tx
        .insert(payoutWalletLoadOrdersTable)
        .values({
          loadId,
          merchantId:       merchant.id,
          amount:           fmtNum(parsedAmount),
          feeAmount:        "0.00",
          gstAmount:        "0.00",
          netCreditAmount:  fmtNum(parsedAmount),
          method:           "ADMIN_TOPUP",
          status:           "SUCCESS",
          creditedAt:       new Date(),
          approvedBy:       adminUserId,
          approvedAt:       new Date(),
          adminNote:        reason.trim(),
        })
        .returning();

      await tx
        .insert(merchantWalletsTable)
        .values({ merchantId: merchant.id })
        .onConflictDoNothing();

      const [wallet] = await tx
        .select()
        .from(merchantWalletsTable)
        .where(eq(merchantWalletsTable.merchantId, merchant.id))
        .for("update")
        .limit(1);

      const avBefore = numStr(wallet?.availableBalance);
      const avAfter  = avBefore + parsedAmount;

      await tx
        .update(merchantWalletsTable)
        .set({
          availableBalance: fmtNum(avAfter),
          totalCollection:  fmtNum(numStr(wallet?.totalCollection) + parsedAmount),
          updatedAt: new Date(),
        })
        .where(eq(merchantWalletsTable.merchantId, merchant.id));

      await tx.insert(walletLedgerTable).values({
        merchantId:      merchant.id,
        txnType:         "wallet_load_admin_topup",
        bucket:          "available",
        amount:          fmtNum(parsedAmount),
        availableBefore: fmtNum(avBefore),
        availableAfter:  fmtNum(avAfter),
        pendingBefore:   fmtNum(numStr(wallet?.pendingBalance)),
        pendingAfter:    fmtNum(numStr(wallet?.pendingBalance)),
        referenceType:   "wallet_load",
        referenceId:     loadOrder.id,
        description:     `Admin top-up — ${reason.trim()}`,
        createdBy:       adminUserId,
      });

      await tx.insert(auditLogsTable).values({
        adminId:    adminUserId,
        adminEmail: req.user.email ?? "admin@rasokart.com",
        action:     "ADMIN_WALLET_TOPUP",
        targetType: "payout_wallet_load",
        targetId:   loadOrder.id,
        details:    JSON.stringify({ loadId, merchantId: merchant.id, amount: parsedAmount, reason }),
      }).catch(() => {});

      return { credited: true, loadOrderId: loadOrder.id };
    });

    res.json({ success: true, loadId, loadOrderId, message: `₹${parsedAmount} credited to ${merchant.businessName}'s payout wallet` });
  } catch (err) { next(err); }
});

// (settings GET and PUT are registered before /:id — see top of this section)

export default router;
