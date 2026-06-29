import { Router } from "express";
import {
  db,
  withdrawalsTable,
  merchantsTable,
  merchantWalletsTable,
  walletLedgerTable,
  auditLogsTable,
  systemConfigTable,
  SYSTEM_CONFIG_KEYS,
} from "@workspace/db";
import { eq, and, count, sum, sql, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { requireModule } from "../middlewares/checkModule";
import { checkPlanLimit, rejectWithLimitError } from "../helpers/planLimits";
import {
  cashfreePayoutCreateTransfer,
  cashfreePayoutGetTransferStatus,
  normalizeCashfreePayoutStatus,
  isPayoutCredentialError,
  type CashfreePayoutEnv,
} from "../helpers/cashfreePayout";
import { mutateWallet, ensureWallet } from "./wallets";

const router = Router();
router.use(requireAuth);

function numStr(v: string | null | undefined): number {
  return v == null ? 0 : Number(v);
}

function fmtAmt(n: number): string {
  return n.toFixed(2);
}

async function getPayoutConfig() {
  const keys = [
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_ID,
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_SECRET,
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENV,
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENABLED,
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_FUNDSOURCE_ID,
  ];
  const rows = await db.select().from(systemConfigTable).where(inArray(systemConfigTable.key, keys));
  const cfg = new Map(rows.map(r => [r.key, r.value]));
  return {
    clientId: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_ID) ?? "",
    clientSecret: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_SECRET) ?? "",
    env: (cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENV) ?? "test") as CashfreePayoutEnv,
    enabled: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENABLED) === "true",
    fundsourceId: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_FUNDSOURCE_ID) ?? "",
  };
}

function mapWithdrawal(
  w: typeof withdrawalsTable.$inferSelect,
  merchantName?: string | null,
  isAdmin = false
) {
  return {
    id: w.id,
    merchantId: w.merchantId,
    merchantName: merchantName ?? null,
    amount: Number(w.amount),
    currency: w.currency,
    status: w.status,
    transferStatus: w.transferStatus,
    utr: w.transferStatus === "SUCCESS" ? w.utr : null,
    failureReason:
      isAdmin
        ? w.failureReason
        : ["FAILED", "REVERSED"].includes(w.transferStatus)
          ? (w.failureReason?.startsWith("PAYOUT_CREDENTIAL_ERROR")
              ? "Payout failed. Please contact support."
              : w.failureReason)
          : null,
    payoutMode: w.payoutMode,
    upiId: w.upiId,
    remarks: w.remarks,
    bankAccount: w.bankAccount,
    bankName: w.bankName,
    ifscCode: w.ifscCode,
    accountHolder: w.accountHolder,
    rejectionReason: w.rejectionReason,
    approvedAt: w.approvedAt?.toISOString() ?? null,
    completedAt: w.completedAt?.toISOString() ?? null,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

// GET /api/withdrawals
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const { status, merchantId, transferStatus, page = "1", limit = "20" } =
    req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;
  const isAdmin = user.role === "admin";

  const conditions = [];
  if (!isAdmin) conditions.push(eq(withdrawalsTable.merchantId, user.merchantId!));
  if (status && status !== "all") conditions.push(eq(withdrawalsTable.status, status));
  if (transferStatus && transferStatus !== "all")
    conditions.push(eq(withdrawalsTable.transferStatus, transferStatus));
  if (merchantId && isAdmin)
    conditions.push(eq(withdrawalsTable.merchantId, parseInt(merchantId)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [aggregates, rows] = await Promise.all([
    db
      .select({
        total: count(),
        totalVolume: sum(withdrawalsTable.amount),
        pendingCount: count(sql`CASE WHEN ${withdrawalsTable.status} = 'pending' THEN 1 END`),
        approvedCount: count(sql`CASE WHEN ${withdrawalsTable.status} = 'approved' THEN 1 END`),
        rejectedCount: count(sql`CASE WHEN ${withdrawalsTable.status} = 'rejected' THEN 1 END`),
        processingCount: count(
          sql`CASE WHEN ${withdrawalsTable.status} = 'approved' AND ${withdrawalsTable.transferStatus} IN ('INITIATED','PENDING','NOT_STARTED') THEN 1 END`
        ),
        successCount: count(
          sql`CASE WHEN ${withdrawalsTable.transferStatus} = 'SUCCESS' THEN 1 END`
        ),
        failedCount: count(
          sql`CASE WHEN ${withdrawalsTable.transferStatus} IN ('FAILED','REVERSED') THEN 1 END`
        ),
        lockedAmount: sum(
          sql`CASE WHEN ${withdrawalsTable.status} = 'approved' AND ${withdrawalsTable.transferStatus} NOT IN ('SUCCESS','FAILED','REVERSED') THEN ${withdrawalsTable.amount} ELSE 0 END`
        ),
      })
      .from(withdrawalsTable)
      .where(where),
    db
      .select({
        withdrawal: withdrawalsTable,
        merchantName: merchantsTable.businessName,
      })
      .from(withdrawalsTable)
      .leftJoin(merchantsTable, eq(withdrawalsTable.merchantId, merchantsTable.id))
      .where(where)
      .limit(limitNum)
      .offset(offset)
      .orderBy(sql`${withdrawalsTable.createdAt} DESC`),
  ]);

  const agg = aggregates[0]!;
  res.json({
    data: rows.map(r => mapWithdrawal(r.withdrawal, r.merchantName, isAdmin)),
    total: agg.total,
    page: pageNum,
    limit: limitNum,
    stats: {
      totalVolume: Number(agg.totalVolume ?? 0),
      pendingCount: Number(agg.pendingCount),
      approvedCount: Number(agg.approvedCount),
      rejectedCount: Number(agg.rejectedCount),
      processingCount: Number(agg.processingCount),
      successCount: Number(agg.successCount),
      failedCount: Number(agg.failedCount),
      lockedAmount: Number(agg.lockedAmount ?? 0),
    },
  });
});

// POST /api/withdrawals — merchant creates payout request
// The balance check + withdrawal insert + ledger entry are wrapped in a single
// db.transaction() so concurrent requests cannot both pass the balance check
// and overdraft the available balance.
router.post("/", requireModule("merchant_withdrawals"), async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "merchant") {
    res.status(403).json({ error: "Only merchants can request payouts" });
    return;
  }

  // Accept camelCase and snake_case field name aliases
  const {
    amount,
    // payoutMode aliases: payoutMode | mode | payout_mode
    payoutMode: _pm, mode, payout_mode,
    // accountNumber aliases: accountNumber | bankAccount | account_number
    accountNumber, bankAccount: _bankAccount, account_number,
    // bankName aliases: bankName | bank_name
    bankName: _bankName, bank_name,
    // ifscCode aliases: ifscCode | ifsc_code
    ifscCode: _ifscCode, ifsc_code,
    // accountHolderName aliases: accountHolderName | accountHolder | account_holder_name
    accountHolderName, accountHolder: _accountHolder, account_holder_name,
    // upiId aliases: upiId | upi_id
    upiId: _upiId, upi_id,
    remarks,
  } = req.body;

  const payoutMode = _pm ?? mode ?? payout_mode ?? "IMPS";
  const bankAccount = accountNumber ?? account_number ?? _bankAccount;
  const bankName = _bankName ?? bank_name;
  const ifscCode = _ifscCode ?? ifsc_code;
  const accountHolder = accountHolderName ?? account_holder_name ?? _accountHolder;
  const upiId = _upiId ?? upi_id;

  if (!amount || Number(amount) <= 0) {
    res.status(400).json({ error: "amount must be a positive number" });
    return;
  }

  if (payoutMode === "UPI") {
    if (!upiId?.trim()) {
      res.status(400).json({ error: "upiId required for UPI mode" });
      return;
    }
  } else {
    if (!bankAccount || !bankName || !ifscCode || !accountHolder) {
      res.status(400).json({
        error: "accountNumber, bankName, ifscCode and accountHolderName are required for bank transfer",
      });
      return;
    }
  }

  const limitCheck = await checkPlanLimit(user.merchantId!, "payout", user.id);
  if (!limitCheck.allowed) {
    rejectWithLimitError(res, limitCheck.message!);
    return;
  }

  const amt = Number(amount);
  const merchantId = user.merchantId!;

  // Wrap balance-check + insert + wallet mutation in ONE transaction to prevent
  // concurrent requests from both passing the check and then double-spending.
  let createdWithdrawal: typeof withdrawalsTable.$inferSelect;
  try {
    createdWithdrawal = await db.transaction(async (tx) => {
      // ensureWallet acquires a row-level lock (tx SELECT) so concurrent txs
      // for the same merchant wait for this one to commit before proceeding.
      const w = await ensureWallet(tx, merchantId);
      const avBefore = numStr(w.availableBalance);

      if (avBefore < amt) {
        throw Object.assign(new Error("Insufficient available balance"), {
          statusCode: 400,
        });
      }

      const [withdrawal] = await tx
        .insert(withdrawalsTable)
        .values({
          merchantId,
          amount: fmtAmt(amt),
          bankAccount: bankAccount ?? "",
          bankName: bankName ?? "",
          ifscCode: ifscCode ?? "",
          accountHolder: accountHolder ?? "",
          payoutMode,
          upiId: payoutMode === "UPI" ? (upiId?.trim() ?? null) : null,
          remarks: remarks?.trim() ?? null,
          status: "pending",
          transferStatus: "NOT_STARTED",
        })
        .returning();

      // Inline wallet mutation (same semantics as mutateWallet but within this tx)
      const newAvailable = avBefore - amt;
      const newHold = numStr(w.holdBalance) + amt;
      await tx
        .update(merchantWalletsTable)
        .set({
          availableBalance: fmtAmt(newAvailable),
          holdBalance: fmtAmt(newHold),
        })
        .where(eq(merchantWalletsTable.merchantId, merchantId));

      await tx.insert(walletLedgerTable).values({
        merchantId,
        txnType: "payout_hold",
        bucket: "available",
        amount: fmtAmt(-amt),
        availableBefore: fmtAmt(avBefore),
        availableAfter: fmtAmt(newAvailable),
        pendingBefore: fmtAmt(numStr(w.pendingBalance)),
        pendingAfter: fmtAmt(numStr(w.pendingBalance)),
        referenceType: "withdrawal",
        referenceId: withdrawal.id,
        description: `Payout request #${withdrawal.id} — ₹${fmtAmt(amt)} locked`,
        createdBy: null,
      });

      return withdrawal;
    });
  } catch (e: any) {
    if (e.statusCode === 400) {
      res.status(400).json({ error: e.message });
      return;
    }
    throw e;
  }

  req.log.info(
    { merchantId, withdrawalId: createdWithdrawal.id, amount: amt },
    "payout_requested"
  );
  res.status(201).json(mapWithdrawal(createdWithdrawal, null, false));
});

// POST /api/withdrawals/:id/approve
// Atomically claims the payout (status pending → approved) BEFORE calling the
// provider, so no two admin actions can double-process the same payout.
router.post("/:id/approve", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params["id"] as string);
  const now = new Date();

  // Step 1: Atomically claim: transition pending → approved with a conditional UPDATE.
  // If 0 rows returned, another admin already processed it.
  const [claimed] = await db
    .update(withdrawalsTable)
    .set({
      status: "approved",
      transferStatus: "INITIATED",
      approvedByAdminId: user.id,
      approvedAt: now,
    })
    .where(and(eq(withdrawalsTable.id, id), eq(withdrawalsTable.status, "pending")))
    .returning();

  if (!claimed) {
    // Either not found, or already approved/rejected
    const [existing] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Payout not found" });
    } else {
      res.status(409).json({ error: `Payout is already ${existing.status} — cannot approve again` });
    }
    return;
  }

  // Step 2: Fetch merchant name for response (non-blocking, separate query)
  const [merchantRow] = await db
    .select({ businessName: merchantsTable.businessName })
    .from(merchantsTable)
    .where(eq(merchantsTable.id, claimed.merchantId))
    .limit(1);
  const merchantName = merchantRow?.businessName ?? null;

  const amt = Number(claimed.amount);
  const cfg = await getPayoutConfig();

  // Step 3: Call provider (row is already committed as "approved/INITIATED")
  let transferStatus = "INITIATED";
  let providerReferenceId: string | null = null;
  let utr: string | null = null;
  let failureReason: string | null = null;

  if (cfg.enabled && cfg.clientId && cfg.clientSecret) {
    const transferId = `RKPAY_${id}_${Date.now()}`;
    try {
      const result = await cashfreePayoutCreateTransfer(
        cfg.clientId,
        cfg.clientSecret,
        cfg.env,
        {
          transferId,
          referenceId: transferId,
          beneficiaryName: claimed.accountHolder || merchantName || "Merchant",
          accountNumber: claimed.bankAccount || undefined,
          ifsc: claimed.ifscCode || undefined,
          upiId: claimed.payoutMode === "UPI" ? (claimed.upiId ?? undefined) : undefined,
          amount: amt,
          remark: `Payout #${id}`,
        }
      );
      providerReferenceId = transferId;
      const normalized = normalizeCashfreePayoutStatus(result.parsed?.status);
      if (isPayoutCredentialError(result.parsed, result.httpStatus)) {
        // Credential error from provider — mark FAILED so hold is released and admin sees clear message
        transferStatus = "FAILED";
        failureReason = `PAYOUT_CREDENTIAL_ERROR: ${result.parsed?.message ?? "Invalid payout Client ID or Secret"}`;
        req.log.warn({ withdrawalId: id, httpStatus: result.httpStatus }, "cashfree_payout_credential_error");
      } else if (normalized === "SUCCESS") {
        transferStatus = "SUCCESS";
        utr = result.parsed?.utr ?? null;
      } else if (normalized === "FAILED") {
        transferStatus = "FAILED";
        failureReason = result.parsed?.message ?? "Transfer failed";
      } else {
        transferStatus = "PENDING";
      }
    } catch (err: any) {
      req.log.warn({ err, withdrawalId: id }, "cashfree_payout_create_error");
      // Network/connection error — release hold by marking FAILED
      transferStatus = "FAILED";
      failureReason = `PAYOUT_CREDENTIAL_ERROR: ${err?.message ?? "Could not reach payout provider"}`;
    }
  }

  // Step 4: Update with provider result
  const isTerminal = ["SUCCESS", "FAILED", "REVERSED"].includes(transferStatus);
  const [updated] = await db
    .update(withdrawalsTable)
    .set({
      transferStatus,
      providerReferenceId,
      utr,
      failureReason,
      completedAt: isTerminal ? now : null,
    })
    .where(eq(withdrawalsTable.id, id))
    .returning();

  // Step 5: Wallet mutation based on terminal provider result.
  // mutateWallet is internally transactional; called AFTER the status row is durable.
  if (transferStatus === "SUCCESS") {
    await mutateWallet(
      claimed.merchantId,
      { holdDelta: -amt, totalPayoutDelta: amt },
      {
        txnType: "payout_success",
        bucket: "hold",
        amount: -amt,
        referenceType: "withdrawal",
        referenceId: id,
        description: `Payout #${id} successful — ₹${fmtAmt(amt)} settled`,
        createdBy: user.id,
      }
    );
  } else if (transferStatus === "FAILED" || transferStatus === "REVERSED") {
    await mutateWallet(
      claimed.merchantId,
      { holdDelta: -amt, availableDelta: amt, totalReversalsDelta: amt },
      {
        txnType: "payout_failed_release",
        bucket: "hold",
        amount: amt,
        referenceType: "withdrawal",
        referenceId: id,
        description: `Payout #${id} failed — ₹${fmtAmt(amt)} released back`,
        createdBy: user.id,
      }
    );
  }

  await db.insert(auditLogsTable).values({
    adminId: user.id,
    adminEmail: user.email,
    action: "payout_approved",
    targetType: "withdrawal",
    targetId: id,
    details: JSON.stringify({ amount: amt, transferStatus, providerReferenceId }),
    ipAddress: (req as any).ip ?? null,
  });

  req.log.info({ withdrawalId: id, transferStatus, adminId: user.id }, "payout_approved");
  res.json(mapWithdrawal(updated, merchantName, true));
});

// POST /api/withdrawals/:id/reject
// Atomically claims the payout (status pending → rejected) BEFORE releasing the
// wallet hold, so no two concurrent rejects can double-credit the hold.
router.post("/:id/reject", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params["id"] as string);
  const { reason } = req.body;
  if (!reason?.trim()) {
    res.status(400).json({ error: "Rejection reason required" });
    return;
  }

  // Step 1: Atomically claim: transition pending → rejected with conditional UPDATE.
  const [claimed] = await db
    .update(withdrawalsTable)
    .set({ status: "rejected", rejectionReason: reason.trim() })
    .where(and(eq(withdrawalsTable.id, id), eq(withdrawalsTable.status, "pending")))
    .returning();

  if (!claimed) {
    const [existing] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Payout not found" });
    } else {
      res.status(409).json({ error: `Payout is already ${existing.status} — cannot reject again` });
    }
    return;
  }

  const [merchantRow] = await db
    .select({ businessName: merchantsTable.businessName })
    .from(merchantsTable)
    .where(eq(merchantsTable.id, claimed.merchantId))
    .limit(1);
  const merchantName = merchantRow?.businessName ?? null;
  const amt = Number(claimed.amount);

  // Step 2: Release the wallet hold AFTER the status row is committed as "rejected".
  // mutateWallet is internally transactional.
  await mutateWallet(
    claimed.merchantId,
    { holdDelta: -amt, availableDelta: amt },
    {
      txnType: "payout_release",
      bucket: "hold",
      amount: amt,
      referenceType: "withdrawal",
      referenceId: id,
      description: `Payout #${id} rejected — ₹${fmtAmt(amt)} released back`,
      createdBy: user.id,
    }
  );

  await db.insert(auditLogsTable).values({
    adminId: user.id,
    adminEmail: user.email,
    action: "payout_rejected",
    targetType: "withdrawal",
    targetId: id,
    details: JSON.stringify({ amount: amt, reason: reason.trim() }),
    ipAddress: (req as any).ip ?? null,
  });

  req.log.info({ withdrawalId: id, adminId: user.id }, "payout_rejected");
  res.json(mapWithdrawal(claimed, merchantName, true));
});

// POST /api/withdrawals/:id/refresh-status
// Updates the row FIRST (conditional on not-yet-terminal), then fires wallet
// mutations — so a concurrent refresh cannot double-credit the wallet.
router.post("/:id/refresh-status", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params["id"] as string);

  const [row] = await db
    .select({ withdrawal: withdrawalsTable, merchantName: merchantsTable.businessName })
    .from(withdrawalsTable)
    .leftJoin(merchantsTable, eq(withdrawalsTable.merchantId, merchantsTable.id))
    .where(eq(withdrawalsTable.id, id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Payout not found" });
    return;
  }
  const w = row.withdrawal;
  const merchantName = row.merchantName ?? null;

  if (w.status !== "approved") {
    res.status(400).json({ error: "Can only refresh approved payouts" });
    return;
  }
  if (["SUCCESS", "FAILED", "REVERSED"].includes(w.transferStatus)) {
    res.status(400).json({ error: `Payout already in terminal state: ${w.transferStatus}` });
    return;
  }
  if (!w.providerReferenceId) {
    res.status(400).json({ error: "No provider reference — payout was not dispatched to provider" });
    return;
  }

  const cfg = await getPayoutConfig();
  if (!cfg.enabled || !cfg.clientId) {
    res.status(400).json({ error: "Cashfree payout not configured" });
    return;
  }

  const result = await cashfreePayoutGetTransferStatus(
    cfg.clientId,
    cfg.clientSecret,
    cfg.env,
    w.providerReferenceId
  );
  const normalized = normalizeCashfreePayoutStatus(result.parsed?.status);
  const amt = Number(w.amount);
  const now = new Date();

  const newTransferStatus =
    normalized === "SUCCESS" ? "SUCCESS" : normalized === "FAILED" ? "FAILED" : w.transferStatus;
  const newUtr = normalized === "SUCCESS" ? (result.parsed?.utr ?? w.utr) : w.utr;
  const newFailureReason =
    normalized === "FAILED" ? (result.parsed?.message ?? "Transfer failed") : w.failureReason;
  const isNewTerminal = normalized === "SUCCESS" || normalized === "FAILED";

  // Step 1: Persist the updated status row FIRST, only if the status actually changed.
  // Using a conditional WHERE to guard against concurrent refreshes landing the
  // same wallet mutation twice.
  if (newTransferStatus !== w.transferStatus) {
    const [conditionalUpdated] = await db
      .update(withdrawalsTable)
      .set({
        transferStatus: newTransferStatus,
        utr: newUtr,
        failureReason: newFailureReason,
        completedAt: isNewTerminal ? now : w.completedAt,
      })
      .where(
        and(
          eq(withdrawalsTable.id, id),
          eq(withdrawalsTable.transferStatus, w.transferStatus) // only if not already changed by another request
        )
      )
      .returning();

    if (!conditionalUpdated) {
      // Another refresh already moved the status — return current state
      const [current] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, id)).limit(1);
      res.json(mapWithdrawal(current!, merchantName, true));
      return;
    }
  }

  // Step 2: Wallet mutations AFTER the status row is committed.
  if (normalized === "SUCCESS" && w.transferStatus !== "SUCCESS") {
    await mutateWallet(
      w.merchantId,
      { holdDelta: -amt, totalPayoutDelta: amt },
      {
        txnType: "payout_success",
        bucket: "hold",
        amount: -amt,
        referenceType: "withdrawal",
        referenceId: id,
        description: `Payout #${id} confirmed successful — ₹${fmtAmt(amt)} settled`,
        createdBy: user.id,
      }
    );
  } else if (normalized === "FAILED" && !["FAILED", "REVERSED"].includes(w.transferStatus)) {
    await mutateWallet(
      w.merchantId,
      { holdDelta: -amt, availableDelta: amt, totalReversalsDelta: amt },
      {
        txnType: "payout_failed_release",
        bucket: "hold",
        amount: amt,
        referenceType: "withdrawal",
        referenceId: id,
        description: `Payout #${id} confirmed failed — ₹${fmtAmt(amt)} released back`,
        createdBy: user.id,
      }
    );
  }

  const [finalRow] = await db
    .select().from(withdrawalsTable).where(eq(withdrawalsTable.id, id)).limit(1);

  req.log.info(
    { withdrawalId: id, prevStatus: w.transferStatus, newTransferStatus },
    "payout_status_refreshed"
  );
  res.json(mapWithdrawal(finalRow!, merchantName, true));
});

// POST /api/withdrawals/:id/retry
// Re-initiates a failed/reversed payout. For FAILED/REVERSED payouts where
// funds were already released back, re-locks them before the provider call.
// The re-lock is done via mutateWallet (internally transactional); if the
// provider call then fails, the hold is released again atomically.
router.post("/:id/retry", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params["id"] as string);

  const [row] = await db
    .select({ withdrawal: withdrawalsTable, merchantName: merchantsTable.businessName })
    .from(withdrawalsTable)
    .leftJoin(merchantsTable, eq(withdrawalsTable.merchantId, merchantsTable.id))
    .where(eq(withdrawalsTable.id, id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Payout not found" });
    return;
  }
  const w = row.withdrawal;
  const merchantName = row.merchantName ?? null;

  if (w.status !== "approved") {
    res.status(400).json({ error: "Can only retry approved payouts" });
    return;
  }
  if (!["FAILED", "REVERSED", "INITIATED"].includes(w.transferStatus)) {
    res.status(400).json({
      error: `Payout transfer status is ${w.transferStatus} — only FAILED/REVERSED/INITIATED can be retried`,
    });
    return;
  }

  const cfg = await getPayoutConfig();
  if (!cfg.enabled || !cfg.clientId || !cfg.clientSecret) {
    res.status(400).json({
      error: "Payout provider credentials invalid. Check payout Client ID / Secret in Gateway Settings.",
    });
    return;
  }

  // ── Atomic claim: only one retry can proceed per withdrawal ────────────────
  // Conditional UPDATE — transitions to INITIATED only if status is still in
  // the retryable set. If a concurrent request already claimed it, 0 rows are
  // returned and we return 409 so the second request is rejected.
  const claimed = await db
    .update(withdrawalsTable)
    .set({ transferStatus: "INITIATED" })
    .where(
      and(
        eq(withdrawalsTable.id, id),
        inArray(withdrawalsTable.transferStatus, ["FAILED", "REVERSED", "INITIATED"]),
      )
    )
    .returning({ id: withdrawalsTable.id });

  if (claimed.length === 0) {
    res.status(409).json({ error: "A retry is already in progress for this payout. Please wait." });
    return;
  }

  const amt = Number(w.amount);
  // For FAILED/REVERSED, funds were released back to available — re-lock before retrying.
  const wasReleased = ["FAILED", "REVERSED"].includes(w.transferStatus);

  if (wasReleased) {
    // Check balance then re-lock inside a transaction to prevent concurrent overdraft
    try {
      await db.transaction(async (tx) => {
        const wallet = await ensureWallet(tx, w.merchantId);
        if (numStr(wallet.availableBalance) < amt) {
          throw Object.assign(new Error("Insufficient available balance to retry payout"), {
            statusCode: 400,
          });
        }
        const avBefore = numStr(wallet.availableBalance);
        const newAvailable = avBefore - amt;
        const newHold = numStr(wallet.holdBalance) + amt;
        await tx
          .update(merchantWalletsTable)
          .set({ availableBalance: fmtAmt(newAvailable), holdBalance: fmtAmt(newHold) })
          .where(eq(merchantWalletsTable.merchantId, w.merchantId));
        await tx.insert(walletLedgerTable).values({
          merchantId: w.merchantId,
          txnType: "payout_hold",
          bucket: "available",
          amount: fmtAmt(-amt),
          availableBefore: fmtAmt(avBefore),
          availableAfter: fmtAmt(newAvailable),
          pendingBefore: fmtAmt(numStr(wallet.pendingBalance)),
          pendingAfter: fmtAmt(numStr(wallet.pendingBalance)),
          referenceType: "withdrawal",
          referenceId: id,
          description: `Payout #${id} retry — ₹${fmtAmt(amt)} re-locked`,
          createdBy: user.id,
        });
      });
    } catch (e: any) {
      if (e.statusCode === 400) {
        res.status(400).json({ error: e.message });
        return;
      }
      throw e;
    }
  }

  // Status is already INITIATED via the atomic claim above — proceed to provider call.
  const newTransferId = `RKPAY_${id}_RETRY_${Date.now()}`;
  let transferStatus = "INITIATED";
  let utr: string | null = null;
  let failureReason: string | null = null;

  try {
    const result = await cashfreePayoutCreateTransfer(
      cfg.clientId,
      cfg.clientSecret,
      cfg.env,
      {
        transferId: newTransferId,
        referenceId: newTransferId,
        beneficiaryName: w.accountHolder || merchantName || "Merchant",
        accountNumber: w.bankAccount || undefined,
        ifsc: w.ifscCode || undefined,
        upiId: w.payoutMode === "UPI" ? (w.upiId ?? undefined) : undefined,
        amount: amt,
        remark: `Payout #${id} retry`,
      }
    );
    const normalized = normalizeCashfreePayoutStatus(result.parsed?.status);
    if (isPayoutCredentialError(result.parsed, result.httpStatus)) {
      transferStatus = "FAILED";
      failureReason = `PAYOUT_CREDENTIAL_ERROR: ${result.parsed?.message ?? "Invalid payout Client ID or Secret"}`;
      req.log.warn({ withdrawalId: id, httpStatus: result.httpStatus }, "cashfree_payout_credential_error_on_retry");
    } else if (normalized === "SUCCESS") {
      transferStatus = "SUCCESS";
      utr = result.parsed?.utr ?? null;
    } else if (normalized === "FAILED") {
      transferStatus = "FAILED";
      failureReason = result.parsed?.message ?? "Transfer failed";
    } else {
      transferStatus = "PENDING";
    }
  } catch (err: any) {
    req.log.warn({ err, withdrawalId: id }, "cashfree_payout_retry_error");
    // Network/connection error — release any re-locked hold by marking FAILED
    transferStatus = "FAILED";
    failureReason = `PAYOUT_CREDENTIAL_ERROR: ${err?.message ?? "Could not reach payout provider"}`;
  }

  const now = new Date();
  const isTerminal = ["SUCCESS", "FAILED", "REVERSED"].includes(transferStatus);

  const [updated] = await db
    .update(withdrawalsTable)
    .set({
      transferStatus,
      providerReferenceId: newTransferId,
      utr,
      failureReason,
      completedAt: isTerminal ? now : null,
    })
    .where(eq(withdrawalsTable.id, id))
    .returning();

  // Wallet mutations AFTER status row is committed
  if (transferStatus === "SUCCESS") {
    await mutateWallet(
      w.merchantId,
      { holdDelta: -amt, totalPayoutDelta: amt },
      {
        txnType: "payout_success",
        bucket: "hold",
        amount: -amt,
        referenceType: "withdrawal",
        referenceId: id,
        description: `Payout #${id} retry successful — ₹${fmtAmt(amt)} settled`,
        createdBy: user.id,
      }
    );
  } else if (transferStatus === "FAILED" || transferStatus === "REVERSED") {
    // Re-release the hold we just re-locked
    await mutateWallet(
      w.merchantId,
      { holdDelta: -amt, availableDelta: amt, totalReversalsDelta: amt },
      {
        txnType: "payout_failed_release",
        bucket: "hold",
        amount: amt,
        referenceType: "withdrawal",
        referenceId: id,
        description: `Payout #${id} retry failed — ₹${fmtAmt(amt)} released back`,
        createdBy: user.id,
      }
    );
  }

  await db.insert(auditLogsTable).values({
    adminId: user.id,
    adminEmail: user.email,
    action: "payout_retried",
    targetType: "withdrawal",
    targetId: id,
    details: JSON.stringify({ amount: amt, transferStatus, newTransferId }),
    ipAddress: (req as any).ip ?? null,
  });

  req.log.info({ withdrawalId: id, transferStatus, adminId: user.id }, "payout_retried");
  res.json(mapWithdrawal(updated, merchantName, true));
});

export default router;
