import { Router } from "express";
import { db, cashfreePayoutsTable, systemConfigTable, SYSTEM_CONFIG_KEYS, merchantsTable } from "@workspace/db";
import { eq, inArray, desc, and, gte, lte, sql } from "drizzle-orm";
import {
  cashfreePayoutCreateTransfer,
  cashfreePayoutGetTransferStatus,
  normalizeCashfreePayoutStatus,
  type CashfreePayoutEnv,
} from "../helpers/cashfreePayout";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();

async function getPayoutConfig() {
  const keys = [
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_ID,
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_SECRET,
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENV,
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENABLED,
  ];
  const rows = await db.select().from(systemConfigTable).where(inArray(systemConfigTable.key, keys));
  const cfg = new Map(rows.map(r => [r.key, r.value]));
  const clientId = cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_ID) ?? "";
  const clientSecret = cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_SECRET) ?? "";
  return {
    clientId,
    clientSecret,
    env: (cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENV) ?? "test") as CashfreePayoutEnv,
    enabled: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENABLED) === "true",
  };
}

/**
 * GET /api/cashfree-payout
 * List payouts with pagination + optional filters.
 * Admin only.
 */
router.get("/", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query["page"] as string) || 1);
    const limit = Math.min(100, parseInt(req.query["limit"] as string) || 25);
    const offset = (page - 1) * limit;
    const status = req.query["status"] as string | undefined;
    const merchantId = req.query["merchantId"] ? parseInt(req.query["merchantId"] as string) : undefined;
    const dateFrom = req.query["dateFrom"] as string | undefined;
    const dateTo = req.query["dateTo"] as string | undefined;

    const conditions = [];
    if (status && ["PENDING", "SUCCESS", "FAILED", "REVERSED"].includes(status)) {
      conditions.push(eq(cashfreePayoutsTable.status, status));
    }
    if (merchantId) {
      conditions.push(eq(cashfreePayoutsTable.merchantId, merchantId));
    }
    if (dateFrom) {
      conditions.push(gte(cashfreePayoutsTable.createdAt, new Date(dateFrom)));
    }
    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      conditions.push(lte(cashfreePayoutsTable.createdAt, endDate));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db.select().from(cashfreePayoutsTable)
        .where(where)
        .orderBy(desc(cashfreePayoutsTable.createdAt))
        .limit(limit).offset(offset),
      db.select({ total: sql<number>`count(*)::int` }).from(cashfreePayoutsTable).where(where),
    ]);

    res.json({
      data: rows.map(r => ({
        ...r,
        amount: r.amount,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      total: total ?? 0,
      page,
      limit,
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/cashfree-payout
 * Create a single payout transfer. Admin only.
 */
router.post("/", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { beneficiaryName, accountNumber, ifsc, upiId, amount, remark, merchantId } = req.body as {
      beneficiaryName?: string;
      accountNumber?: string;
      ifsc?: string;
      upiId?: string;
      amount?: number;
      remark?: string;
      merchantId?: number;
    };

    if (!beneficiaryName?.trim()) {
      res.status(400).json({ error: "beneficiaryName is required" }); return;
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      res.status(400).json({ error: "Valid amount is required" }); return;
    }
    const hasBank = accountNumber?.trim() && ifsc?.trim();
    const hasUpi = upiId?.trim();
    if (!hasBank && !hasUpi) {
      res.status(400).json({ error: "Either accountNumber+ifsc or upiId is required" }); return;
    }

    const cfg = await getPayoutConfig();
    if (!cfg.enabled) {
      res.status(400).json({ error: "Cashfree Payout is not enabled" }); return;
    }
    if (!cfg.clientId || !cfg.clientSecret) {
      res.status(400).json({ error: "Cashfree Payout credentials are not configured" }); return;
    }

    const transferId = `RKPAY-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const { raw, parsed } = await cashfreePayoutCreateTransfer(cfg.clientId, cfg.clientSecret, cfg.env, {
      referenceId: transferId,
      beneficiaryName: beneficiaryName.trim(),
      accountNumber: accountNumber?.trim(),
      ifsc: ifsc?.trim(),
      upiId: upiId?.trim(),
      amount: Number(amount),
      remark: remark?.trim(),
    });

    const cashfreeStatus = parsed.status as string | undefined;
    const normalizedStatus = normalizeCashfreePayoutStatus(cashfreeStatus);
    const cashfreeTransferId = (parsed.transferId ?? parsed.referenceId) as string | undefined;
    const errorMessage = normalizedStatus === "FAILED" ? (parsed.message as string | undefined) ?? null : null;

    const [row] = await db.insert(cashfreePayoutsTable).values({
      transferId,
      beneficiaryName: beneficiaryName.trim(),
      accountNumber: accountNumber?.trim() ?? null,
      ifsc: ifsc?.trim() ?? null,
      upiId: upiId?.trim() ?? null,
      amount: String(amount),
      remark: remark?.trim() ?? null,
      status: normalizedStatus,
      cashfreeTransferId: cashfreeTransferId ?? null,
      errorMessage,
      merchantId: merchantId ?? null,
      initiatedByEmail: user.email,
      rawResponse: raw,
    }).returning();

    req.log.info({ transferId, status: normalizedStatus, cashfreeTransferId }, "Cashfree payout created");

    res.json({
      ...row,
      amount: row!.amount,
      createdAt: row!.createdAt.toISOString(),
      updatedAt: row!.updatedAt.toISOString(),
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/cashfree-payout/bulk
 * Accept a JSON array of already-parsed CSV rows, validate each, submit to Cashfree.
 * Admin only.
 */
router.post("/bulk", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const body = req.body as { rows?: Array<{
      beneficiary_name?: string;
      account_number?: string;
      ifsc?: string;
      upi_id?: string;
      amount?: string | number;
      remark?: string;
    }> };
    const rows = body.rows ?? [];

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "rows array is required and must not be empty" }); return;
    }
    if (rows.length > 200) {
      res.status(400).json({ error: "Maximum 200 rows per bulk upload" }); return;
    }

    const cfg = await getPayoutConfig();
    if (!cfg.enabled) {
      res.status(400).json({ error: "Cashfree Payout is not enabled" }); return;
    }
    if (!cfg.clientId || !cfg.clientSecret) {
      res.status(400).json({ error: "Cashfree Payout credentials are not configured" }); return;
    }

    let successCount = 0;
    let failedCount = 0;
    const results: Array<{ index: number; transferId?: string; status: string; error?: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const beneficiaryName = row.beneficiary_name?.trim() ?? "";
      const accountNumber = row.account_number?.trim() ?? "";
      const ifsc = row.ifsc?.trim() ?? "";
      const upiId = row.upi_id?.trim() ?? "";
      const amount = Number(row.amount);
      const remark = row.remark?.trim() ?? "";

      if (!beneficiaryName) {
        failedCount++;
        results.push({ index: i, status: "FAILED", error: "Missing beneficiary_name" });
        continue;
      }
      if (isNaN(amount) || amount <= 0) {
        failedCount++;
        results.push({ index: i, status: "FAILED", error: "Invalid amount" });
        continue;
      }
      const hasBank = accountNumber && ifsc;
      const hasUpi = !!upiId;
      if (!hasBank && !hasUpi) {
        failedCount++;
        results.push({ index: i, status: "FAILED", error: "Missing account_number+ifsc or upi_id" });
        continue;
      }

      const transferId = `RKPAY-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${i}`;

      try {
        const { raw, parsed } = await cashfreePayoutCreateTransfer(cfg.clientId, cfg.clientSecret, cfg.env, {
          referenceId: transferId,
          beneficiaryName,
          accountNumber: accountNumber || undefined,
          ifsc: ifsc || undefined,
          upiId: upiId || undefined,
          amount,
          remark: remark || undefined,
        });

        const cashfreeStatus = parsed.status as string | undefined;
        const normalizedStatus = normalizeCashfreePayoutStatus(cashfreeStatus);
        const cashfreeTransferId = (parsed.transferId ?? parsed.referenceId) as string | undefined;

        await db.insert(cashfreePayoutsTable).values({
          transferId,
          beneficiaryName,
          accountNumber: accountNumber || null,
          ifsc: ifsc || null,
          upiId: upiId || null,
          amount: String(amount),
          remark: remark || null,
          status: normalizedStatus,
          cashfreeTransferId: cashfreeTransferId ?? null,
          errorMessage: normalizedStatus === "FAILED" ? (parsed.message as string | undefined) ?? null : null,
          merchantId: null,
          initiatedByEmail: user.email,
          rawResponse: raw,
        }).onConflictDoNothing();

        if (normalizedStatus === "FAILED") {
          failedCount++;
          results.push({ index: i, transferId, status: normalizedStatus, error: parsed.message as string | undefined });
        } else {
          successCount++;
          results.push({ index: i, transferId, status: normalizedStatus });
        }
      } catch (err: any) {
        failedCount++;
        results.push({ index: i, transferId, status: "FAILED", error: err?.message ?? "Unknown error" });
      }
    }

    req.log.info({ total: rows.length, successCount, failedCount }, "Cashfree bulk payout completed");
    res.json({ total: rows.length, successCount, failedCount, results });
  } catch (err) { next(err); }
});

/**
 * POST /api/cashfree-payout/:id/retry
 * Re-submit a FAILED payout to Cashfree. Admin only.
 */
router.post("/:id/retry", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params["id"] as string);

    const [payout] = await db.select().from(cashfreePayoutsTable)
      .where(eq(cashfreePayoutsTable.id, id)).limit(1);

    if (!payout) {
      res.status(404).json({ error: "Payout not found" }); return;
    }
    if (payout.status !== "FAILED") {
      res.status(400).json({ error: `Cannot retry a payout with status ${payout.status}` }); return;
    }

    const cfg = await getPayoutConfig();
    if (!cfg.enabled) {
      res.status(400).json({ error: "Cashfree Payout is not enabled" }); return;
    }
    if (!cfg.clientId || !cfg.clientSecret) {
      res.status(400).json({ error: "Cashfree Payout credentials are not configured" }); return;
    }

    const newTransferId = `RKPAY-RETRY-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const { raw, parsed } = await cashfreePayoutCreateTransfer(cfg.clientId, cfg.clientSecret, cfg.env, {
      referenceId: newTransferId,
      beneficiaryName: payout.beneficiaryName,
      accountNumber: payout.accountNumber ?? undefined,
      ifsc: payout.ifsc ?? undefined,
      upiId: payout.upiId ?? undefined,
      amount: Number(payout.amount),
      remark: payout.remark ?? undefined,
    });

    const cashfreeStatus = parsed.status as string | undefined;
    const normalizedStatus = normalizeCashfreePayoutStatus(cashfreeStatus);
    const cashfreeTransferId = (parsed.transferId ?? parsed.referenceId) as string | undefined;

    const [updated] = await db.update(cashfreePayoutsTable).set({
      transferId: newTransferId,
      status: normalizedStatus,
      cashfreeTransferId: cashfreeTransferId ?? null,
      errorMessage: normalizedStatus === "FAILED" ? (parsed.message as string | undefined) ?? null : null,
      rawResponse: raw,
    }).where(eq(cashfreePayoutsTable.id, id)).returning();

    req.log.info({ id, newTransferId, status: normalizedStatus }, "Cashfree payout retried");

    res.json({
      ...updated,
      amount: updated!.amount,
      createdAt: updated!.createdAt.toISOString(),
      updatedAt: updated!.updatedAt.toISOString(),
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/cashfree-payout/sync-status
 * Fetch latest status from Cashfree for all PENDING payouts (or a specific id).
 * Admin only.
 */
router.post("/sync-status", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.body as { id?: number };

    const cfg = await getPayoutConfig();
    if (!cfg.clientId || !cfg.clientSecret) {
      res.status(400).json({ error: "Cashfree Payout credentials are not configured" }); return;
    }

    const pendingRows = id
      ? await db.select().from(cashfreePayoutsTable).where(eq(cashfreePayoutsTable.id, id)).limit(1)
      : await db.select().from(cashfreePayoutsTable).where(eq(cashfreePayoutsTable.status, "PENDING")).limit(100);

    let updatedCount = 0;
    for (const row of pendingRows) {
      try {
        const { parsed } = await cashfreePayoutGetTransferStatus(cfg.clientId, cfg.clientSecret, cfg.env, row.transferId);
        const cashfreeStatus = parsed.status as string | undefined;
        const normalizedStatus = normalizeCashfreePayoutStatus(cashfreeStatus);

        if (normalizedStatus !== row.status) {
          await db.update(cashfreePayoutsTable).set({
            status: normalizedStatus,
            cashfreeTransferId: (parsed.transferId ?? parsed.referenceId ?? row.cashfreeTransferId) as string | null,
            errorMessage: normalizedStatus === "FAILED" ? (parsed.message as string | undefined) ?? null : null,
          }).where(eq(cashfreePayoutsTable.id, row.id));
          updatedCount++;
        }
      } catch {
        // Skip failed status checks — they'll be retried on next sync
      }
    }

    req.log.info({ checked: pendingRows.length, updatedCount }, "Cashfree payout sync-status completed");
    res.json({ checked: pendingRows.length, updatedCount });
  } catch (err) { next(err); }
});

export default router;
