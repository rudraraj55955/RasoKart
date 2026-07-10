import { Router } from "express";
import {
  db,
  withdrawalsTable,
  merchantsTable,
  merchantWalletsTable,
  walletLedgerTable,
  auditLogsTable,
  systemConfigTable,
  payoutBeneficiariesTable,
  SYSTEM_CONFIG_KEYS,
} from "@workspace/db";
import { buildPayoutSlipPdf } from "../helpers/payoutSlipPdf";
import type { PayoutSlipData, PayoutDisplayStatus } from "../helpers/payoutSlipPdf";
import { eq, and, count, sum, sql, inArray, ne, isNull } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { signSlipShareToken } from "../helpers/payoutSlipShare";
import { requireModule } from "../middlewares/checkModule";
import { checkPlanLimit, rejectWithLimitError } from "../helpers/planLimits";
import {
  cashfreePayoutCreateTransfer,
  cashfreePayoutGetTransferStatus,
  normalizeCashfreePayoutStatus,
  isPayoutCredentialError,
  isBeneficiaryNotFound,
  type CashfreePayoutEnv,
} from "../helpers/cashfreePayout";
import { decryptSecret } from "../helpers/cryptoUtils";
import { mutateWallet, ensureWallet } from "./wallets";
import {
  resolveOrCreateBeneficiary,
  ensureBeneficiaryProviderRegistered,
  invalidateBeneficiaryProviderRegistration,
  reregisterBeneficiaryWithProvider,
  repairBeneficiaryMappingFromProvider,
  checkBeneficiaryProviderStatus,
  toBeneficiaryStatus,
  type BeneficiaryDestinationInput,
} from "../helpers/payoutBeneficiaryStore";

// Safe failure reason strings stored in the failureReason column — visible
// to admins in the detail drawer. Never exposed raw to merchants.
const SAFE_REASON_BENEFICIARY_NOT_VERIFIED = "beneficiary_not_verified";
const SAFE_REASON_BENEFICIARY_NOT_FOUND = "beneficiary_not_found";
// Kept for backward compatibility as the generic block-gate message
const BENEFICIARY_NOT_VERIFIED_MESSAGE = SAFE_REASON_BENEFICIARY_NOT_VERIFIED;

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
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_BASE_URL,
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_API_VERSION,
  ];
  const rows = await db.select().from(systemConfigTable).where(inArray(systemConfigTable.key, keys));
  const cfg = new Map(rows.map(r => [r.key, r.value]));
  const rawSecret = cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_SECRET) ?? "";
  const decrypted = decryptSecret(rawSecret);
  return {
    clientId: (cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_ID) ?? "").trim(),
    clientSecret: decrypted.ok ? decrypted.value.trim() : "",
    clientSecretDecryptOk: decrypted.ok,
    env: (cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENV) ?? "test") as CashfreePayoutEnv,
    enabled: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENABLED) === "true",
    fundsourceId: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_FUNDSOURCE_ID) ?? "",
    providerConfig: {
      baseUrl: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_BASE_URL) ?? "",
      apiVersion: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_API_VERSION) ?? "",
    },
  };
}

/**
 * Resolve the beneficiary row for a withdrawal, preferring the FK set at
 * creation time. Legacy withdrawals created before this row existed (or a
 * withdrawal whose beneficiaryId is somehow missing) fall back to
 * dedup/auto-create from the withdrawal's own snapshot fields, and persist
 * the resolved id so future approve/retry calls skip this fallback.
 */
async function resolveBeneficiaryRowForWithdrawal(
  w: typeof withdrawalsTable.$inferSelect,
  env: CashfreePayoutEnv,
  merchantName?: string | null
) {
  if (w.beneficiaryId) {
    const [row] = await db
      .select()
      .from(payoutBeneficiariesTable)
      .where(eq(payoutBeneficiariesTable.id, w.beneficiaryId))
      .limit(1);
    // Only trust the FK-resolved row if it was registered for the currently
    // configured provider environment. A row created while the gateway was
    // set to "test" can never be valid on "live" (different Cashfree
    // merchant account) and vice versa — reusing it would send a
    // provider_beneficiary_id that genuinely doesn't exist in the target
    // environment, producing "Beneficiary id does not exist" on transfer.
    if (row && row.env === env) return row;
  }

  const destination: BeneficiaryDestinationInput = {
    payoutMode: w.payoutMode,
    bankAccount: w.bankAccount,
    bankName: w.bankName,
    ifscCode: w.ifscCode,
    upiId: w.upiId,
    accountHolder: w.accountHolder || merchantName,
  };
  const row = await resolveOrCreateBeneficiary(w.merchantId, env, destination);
  await db.update(withdrawalsTable).set({ beneficiaryId: row.id }).where(eq(withdrawalsTable.id, w.id));
  return row;
}

// Generic, provider-agnostic failure message shown to merchants — never
// exposes provider name, raw response, or internal error codes.
const MERCHANT_GENERIC_FAILURE_MESSAGE = "Transfer failed. Please contact support or retry after verification.";

function mapWithdrawal(
  w: typeof withdrawalsTable.$inferSelect,
  merchantName?: string | null,
  isAdmin = false,
  beneficiaryProviderStatus?: string | null
) {
  // Safe, sanitized failure reason — admin-facing only, never a raw provider
  // dump. Used for both the legacy `failureReason` field (kept for back
  // compat) and the explicitly-named `safeFailureReason` field the admin
  // detail drawer reads from.
  const safeFailureReason = ["FAILED", "REVERSED"].includes(w.transferStatus)
    ? (w.failureReason?.startsWith("PAYOUT_CREDENTIAL_ERROR")
        ? "Payout provider credentials invalid. Check Gateway Settings."
        : w.failureReason)
    : null;

  return {
    id: w.id,
    merchantId: w.merchantId,
    merchantName: merchantName ?? null,
    beneficiaryId: w.beneficiaryId,
    beneficiaryStatus: beneficiaryProviderStatus != null ? toBeneficiaryStatus(beneficiaryProviderStatus) : undefined,
    amount: Number(w.amount),
    currency: w.currency,
    status: w.status,
    transferStatus: w.transferStatus,
    utr: w.transferStatus === "SUCCESS" ? w.utr : null,
    failureReason: isAdmin ? w.failureReason : (safeFailureReason ? MERCHANT_GENERIC_FAILURE_MESSAGE : null),
    safeFailureReason: isAdmin ? safeFailureReason : (safeFailureReason ? MERCHANT_GENERIC_FAILURE_MESSAGE : null),
    hasProviderReference: isAdmin ? !!w.providerReferenceId : undefined,
    payoutMode: w.payoutMode,
    upiId: w.upiId,
    remarks: w.remarks,
    bankAccount: w.bankAccount,
    bankName: w.bankName,
    ifscCode: w.ifscCode,
    accountHolder: w.accountHolder,
    rejectionReason: w.rejectionReason,
    rejectedAt: isAdmin ? (w.rejectedAt?.toISOString() ?? null) : null,
    rejectedByAdminId: isAdmin ? (w.rejectedByAdminId ?? null) : null,
    approvedAt: w.approvedAt?.toISOString() ?? null,
    completedAt: w.completedAt?.toISOString() ?? null,
    approvalType: w.approvalType,
    approvedBySystem: w.approvedBySystem,
    approvedBy: isAdmin ? (w.approvedBy ?? null) : (w.approvalType === "AUTO" ? "AUTO" : null),
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

// ── Auto-payout eligibility check ─────────────────────────────────────────
// Returns { eligible, reason, snapshot } — never throws; all DB failures
// fall through to the manual-approval path.
async function checkAutoPayoutEligibility(
  merchantId: number,
  amount: number,
  beneficiaryId: number | null,
  payoutMode: string,
  withdrawalId: number
): Promise<{ eligible: boolean; reason: string; snapshot?: Record<string, unknown> }> {
  const globalKeys = [
    SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_GLOBAL_ENABLED,
    SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_GLOBAL_PAUSED,
    SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_MAX_SINGLE_AMOUNT,
    SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_DAILY_LIMIT,
    SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_MONTHLY_LIMIT,
    SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_ALLOWED_MODES,
    SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_MIN_WALLET_BALANCE,
  ] as string[];
  const cfgRows = await db.select().from(systemConfigTable).where(inArray(systemConfigTable.key, globalKeys));
  const globalCfg = new Map(cfgRows.map(r => [r.key, r.value]));

  if (globalCfg.get(SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_GLOBAL_ENABLED) !== "true") {
    return { eligible: false, reason: "global_disabled" };
  }
  if (globalCfg.get(SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_GLOBAL_PAUSED) === "true") {
    return { eligible: false, reason: "global_paused" };
  }

  const [merchant] = await db.select().from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
  if (!merchant) return { eligible: false, reason: "merchant_not_found" };

  const m = merchant as typeof merchant & {
    autoPayoutEnabled: boolean;
    autoPayoutPaused: boolean;
    autoPayoutMaxSingleAmount: string | null;
    autoPayoutDailyLimit: string | null;
    autoPayoutMonthlyLimit: string | null;
    perBeneficiaryDailyLimit: string | null;
    autoPayoutAllowedModes: unknown;
    autoPayoutOnlyVerifiedBeneficiaries: boolean;
    autoPayoutMinWalletBalanceAfterPayout: string | null;
  };

  if (!m.autoPayoutEnabled) return { eligible: false, reason: "merchant_disabled" };
  if (m.autoPayoutPaused) return { eligible: false, reason: "merchant_paused" };

  const effectiveMaxSingle = Number(m.autoPayoutMaxSingleAmount ?? globalCfg.get(SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_MAX_SINGLE_AMOUNT) ?? 10000);
  const effectiveDailyLimit = Number(m.autoPayoutDailyLimit ?? globalCfg.get(SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_DAILY_LIMIT) ?? 50000);
  const effectiveMonthlyLimit = Number(m.autoPayoutMonthlyLimit ?? globalCfg.get(SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_MONTHLY_LIMIT) ?? 500000);
  const effectiveMinBalance = Number(m.autoPayoutMinWalletBalanceAfterPayout ?? globalCfg.get(SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_MIN_WALLET_BALANCE) ?? 0);

  const rawModes = m.autoPayoutAllowedModes ?? globalCfg.get(SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_ALLOWED_MODES);
  let allowedModes: string[] = ["IMPS", "NEFT", "RTGS", "UPI"];
  try {
    if (rawModes) {
      allowedModes = typeof rawModes === "string" ? JSON.parse(rawModes) : (rawModes as string[]);
    }
  } catch { /* use default */ }

  if (amount > effectiveMaxSingle) return { eligible: false, reason: "amount_exceeds_single_limit" };
  if (!allowedModes.includes(payoutMode)) return { eligible: false, reason: "mode_not_allowed" };

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [dailyAgg] = await db
    .select({ total: sum(withdrawalsTable.amount) })
    .from(withdrawalsTable)
    .where(and(
      eq(withdrawalsTable.merchantId, merchantId),
      eq(withdrawalsTable.status, "approved"),
      sql`${withdrawalsTable.createdAt} >= ${todayStart.toISOString()}::timestamptz`,
      sql`${withdrawalsTable.id} != ${withdrawalId}`
    ));
  if (Number(dailyAgg?.total ?? 0) + amount > effectiveDailyLimit) {
    return { eligible: false, reason: "daily_limit_exceeded" };
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [monthlyAgg] = await db
    .select({ total: sum(withdrawalsTable.amount) })
    .from(withdrawalsTable)
    .where(and(
      eq(withdrawalsTable.merchantId, merchantId),
      eq(withdrawalsTable.status, "approved"),
      sql`${withdrawalsTable.createdAt} >= ${monthStart.toISOString()}::timestamptz`,
      sql`${withdrawalsTable.id} != ${withdrawalId}`
    ));
  if (Number(monthlyAgg?.total ?? 0) + amount > effectiveMonthlyLimit) {
    return { eligible: false, reason: "monthly_limit_exceeded" };
  }

  const perBenLimit = m.perBeneficiaryDailyLimit ? Number(m.perBeneficiaryDailyLimit) : null;
  if (perBenLimit != null && beneficiaryId) {
    const [benAgg] = await db
      .select({ total: sum(withdrawalsTable.amount) })
      .from(withdrawalsTable)
      .where(and(
        eq(withdrawalsTable.merchantId, merchantId),
        eq(withdrawalsTable.beneficiaryId, beneficiaryId),
        eq(withdrawalsTable.status, "approved"),
        sql`${withdrawalsTable.createdAt} >= ${todayStart.toISOString()}::timestamptz`,
        sql`${withdrawalsTable.id} != ${withdrawalId}`
      ));
    if (Number(benAgg?.total ?? 0) + amount > perBenLimit) {
      return { eligible: false, reason: "per_beneficiary_daily_limit_exceeded" };
    }
  }

  const onlyVerified = m.autoPayoutOnlyVerifiedBeneficiaries !== false;
  if (onlyVerified && beneficiaryId) {
    const [ben] = await db
      .select({ providerStatus: payoutBeneficiariesTable.providerStatus })
      .from(payoutBeneficiariesTable)
      .where(eq(payoutBeneficiariesTable.id, beneficiaryId))
      .limit(1);
    if (!ben || ben.providerStatus !== "created") {
      return { eligible: false, reason: "beneficiary_not_verified" };
    }
  }

  if (effectiveMinBalance > 0) {
    const [wallet] = await db
      .select({ available: merchantWalletsTable.availableBalance })
      .from(merchantWalletsTable)
      .where(eq(merchantWalletsTable.merchantId, merchantId))
      .limit(1);
    if (Number(wallet?.available ?? 0) - amount < effectiveMinBalance) {
      return { eligible: false, reason: "min_balance_not_maintained" };
    }
  }

  return {
    eligible: true,
    reason: "eligible",
    snapshot: {
      effectiveMaxSingle,
      effectiveDailyLimit,
      effectiveMonthlyLimit,
      effectiveMinBalance,
      allowedModes,
      onlyVerified,
      perBenLimit,
      checkedAt: new Date().toISOString(),
    },
  };
}

// ── Shared provider dispatch (used by auto-approve path in POST) ──────────
// Same logic as the approve route's inline dispatch; extracted to avoid
// duplicating the error-handling branches. The approve route keeps its own
// inline copy so it can be audited and modified independently.
async function dispatchPayoutTransfer(
  req: any,
  withdrawal: typeof withdrawalsTable.$inferSelect,
  merchantName: string | null,
  merchantContact: { email: string | null; phone: string | null }
): Promise<{ transferStatus: string; providerReferenceId: string | null; utr: string | null; failureReason: string | null }> {
  const cfg = await getPayoutConfig();
  if (!cfg.enabled || !cfg.clientId || !cfg.clientSecret) {
    req.log.warn({ withdrawalId: withdrawal.id }, "auto_payout_skipped_no_config");
    return { transferStatus: "FAILED", providerReferenceId: null, utr: null, failureReason: "PAYOUT_CREDENTIAL_ERROR: Payout gateway disabled or credentials not configured" };
  }

  const amt = Number(withdrawal.amount);
  const transferId = `RKPAY_${withdrawal.id}_${Date.now()}`;
  const mode = withdrawal.payoutMode === "UPI" ? "upi" : "banktransfer";
  const accountMasked = withdrawal.payoutMode === "UPI"
    ? (withdrawal.upiId ? `${withdrawal.upiId.slice(0, 2)}***` : null)
    : (withdrawal.bankAccount ? `****${withdrawal.bankAccount.trim().slice(-4)}` : null);

  const beneficiaryRow = await resolveBeneficiaryRowForWithdrawal(withdrawal, cfg.env, merchantName);
  if (beneficiaryRow.providerStatus === "failed" || beneficiaryRow.providerStatus === "stale") {
    req.log.warn({ withdrawalId: withdrawal.id, merchantId: withdrawal.merchantId, accountMasked, providerStatus: beneficiaryRow.providerStatus }, "auto_payout_beneficiary_stale");
    return { transferStatus: "FAILED", providerReferenceId: null, utr: null, failureReason: BENEFICIARY_NOT_VERIFIED_MESSAGE };
  }

  const bene = await ensureBeneficiaryProviderRegistered(req, beneficiaryRow, cfg.env, cfg.clientId, cfg.clientSecret, withdrawal.id, false, merchantContact, cfg.providerConfig);
  if (!bene.ok) {
    req.log.warn({ withdrawalId: withdrawal.id, merchantId: withdrawal.merchantId, accountMasked }, "auto_payout_beneficiary_not_registered");
    return { transferStatus: "FAILED", providerReferenceId: null, utr: null, failureReason: bene.message ?? BENEFICIARY_NOT_VERIFIED_MESSAGE };
  }

  try {
    req.log.info({ withdrawalId: withdrawal.id, merchantId: withdrawal.merchantId, accountMasked, mode, amount: amt }, "auto_payout_transfer_create_started");
    const result = await cashfreePayoutCreateTransfer(
      cfg.clientId, cfg.clientSecret, cfg.env,
      {
        transferId,
        referenceId: transferId,
        beneficiaryId: bene.providerBeneficiaryId,
        beneficiaryName: withdrawal.accountHolder || merchantName || "Merchant",
        accountNumber: withdrawal.bankAccount || undefined,
        ifsc: withdrawal.ifscCode || undefined,
        upiId: withdrawal.payoutMode === "UPI" ? (withdrawal.upiId ?? undefined) : undefined,
        amount: amt,
        remark: `AutoPayout #${withdrawal.id}`,
      },
      cfg.providerConfig
    );
    req.log.info({ withdrawalId: withdrawal.id, transferId, mode, amount: amt, httpStatus: result.httpStatus, providerStatus: result.parsed?.status, subCode: result.parsed?.subCode }, "auto_payout_transfer_attempted");

    if (isBeneficiaryNotFound(result.parsed, result.httpStatus)) {
      await invalidateBeneficiaryProviderRegistration(beneficiaryRow.id, "Provider reported beneficiary not found on auto-payout create");
      req.log.warn({ withdrawalId: withdrawal.id, merchantId: withdrawal.merchantId, accountMasked, httpStatus: result.httpStatus }, "auto_payout_beneficiary_not_found");
      return { transferStatus: "FAILED", providerReferenceId: null, utr: null, failureReason: SAFE_REASON_BENEFICIARY_NOT_FOUND };
    }

    const providerReferenceId = result.parsed?.referenceId ?? transferId;
    const normalized = normalizeCashfreePayoutStatus(result.parsed?.status);
    if (isPayoutCredentialError(result.parsed, result.httpStatus)) {
      return { transferStatus: "FAILED", providerReferenceId, utr: null, failureReason: `PAYOUT_CREDENTIAL_ERROR: ${result.parsed?.message ?? "Invalid payout Client ID or Secret"}` };
    } else if (normalized === "SUCCESS") {
      return { transferStatus: "SUCCESS", providerReferenceId, utr: result.parsed?.utr ?? null, failureReason: null };
    } else if (normalized === "FAILED") {
      return { transferStatus: "FAILED", providerReferenceId, utr: null, failureReason: SAFE_REASON_BENEFICIARY_NOT_VERIFIED };
    } else {
      return { transferStatus: "PENDING", providerReferenceId, utr: null, failureReason: null };
    }
  } catch (err: any) {
    req.log.warn({ err, withdrawalId: withdrawal.id }, "auto_payout_transfer_create_error");
    return { transferStatus: "FAILED", providerReferenceId: null, utr: null, failureReason: `PAYOUT_CREDENTIAL_ERROR: ${err?.message ?? "Could not reach payout provider"}` };
  }
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
        beneficiaryProviderStatus: payoutBeneficiariesTable.providerStatus,
      })
      .from(withdrawalsTable)
      .leftJoin(merchantsTable, eq(withdrawalsTable.merchantId, merchantsTable.id))
      .leftJoin(payoutBeneficiariesTable, eq(withdrawalsTable.beneficiaryId, payoutBeneficiariesTable.id))
      .where(where)
      .limit(limitNum)
      .offset(offset)
      .orderBy(sql`${withdrawalsTable.createdAt} DESC`),
  ]);

  const agg = aggregates[0]!;
  res.json({
    data: rows.map(r => mapWithdrawal(r.withdrawal, r.merchantName, isAdmin, r.beneficiaryProviderStatus)),
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
    // beneficiaryId — preferred path: pick a previously saved beneficiary
    beneficiaryId: _beneficiaryId, beneficiary_id,
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
    idempotencyKey: _idempotencyKey, idempotency_key,
  } = req.body;

  const requestedBeneficiaryId = _beneficiaryId ?? beneficiary_id ?? null;
  const idempotencyKey: string | null =
    typeof (_idempotencyKey ?? idempotency_key) === "string" && (_idempotencyKey ?? idempotency_key).trim()
      ? (_idempotencyKey ?? idempotency_key).trim().slice(0, 128)
      : null;

  const MIN_PAYOUT_AMOUNT = 100;
  if (!amount || Number(amount) <= 0) {
    res.status(400).json({ error: "amount must be a positive number" });
    return;
  }
  if (Number(amount) < MIN_PAYOUT_AMOUNT) {
    res.status(400).json({ error: `Minimum payout amount is ₹${MIN_PAYOUT_AMOUNT}` });
    return;
  }

  const merchantId = user.merchantId!;

  // ── Idempotency: if this merchant already submitted a payout with this
  // exact key (e.g. a double-click / retried network request), return the
  // existing payout instead of creating a second one.
  if (idempotencyKey) {
    const [existing] = await db
      .select()
      .from(withdrawalsTable)
      .where(and(eq(withdrawalsTable.merchantId, merchantId), eq(withdrawalsTable.idempotencyKey, idempotencyKey)))
      .limit(1);
    if (existing) {
      req.log.info({ merchantId, withdrawalId: existing.id, idempotencyKey }, "payout_idempotent_replay");
      res.status(200).json(mapWithdrawal(existing, null, false));
      return;
    }
  }

  const limitCheck = await checkPlanLimit(user.merchantId!, "payout", user.id);
  if (!limitCheck.allowed) {
    rejectWithLimitError(res, limitCheck.message!);
    return;
  }

  const amt = Number(amount);

  let payoutMode: string;
  let bankAccount: string | null;
  let bankName: string | null;
  let ifscCode: string | null;
  let accountHolder: string | null;
  let upiId: string | null;
  let resolvedBeneficiaryId: number | null = null;

  if (requestedBeneficiaryId) {
    // Preferred path — a saved beneficiary was selected.
    const [beneficiary] = await db
      .select()
      .from(payoutBeneficiariesTable)
      .where(eq(payoutBeneficiariesTable.id, parseInt(requestedBeneficiaryId)))
      .limit(1);

    if (!beneficiary || beneficiary.merchantId !== merchantId) {
      res.status(404).json({ error: "Beneficiary not found" });
      return;
    }
    if (beneficiary.localStatus !== "active") {
      res.status(400).json({ error: "This beneficiary is disabled and cannot be used for new payouts" });
      return;
    }
    if (beneficiary.providerStatus !== "created") {
      // Beneficiary must be verified with the provider before it can be
      // used for a new payout — never dispatch against an unverified/failed
      // beneficiary and never re-run registration here (that's a separate,
      // explicit Beneficiaries-page action).
      res.status(400).json({ error: "Add and verify a beneficiary first." });
      return;
    }

    payoutMode = beneficiary.payoutMode;
    bankAccount = beneficiary.bankAccount;
    bankName = beneficiary.bankName;
    ifscCode = beneficiary.ifscCode;
    accountHolder = beneficiary.accountHolder;
    upiId = beneficiary.upiId;
    resolvedBeneficiaryId = beneficiary.id;
  } else {
    // Legacy path — raw destination fields supplied inline. Dedup/auto-create
    // a saved beneficiary behind the scenes so future payouts (and
    // approve/retry) reuse the same provider registration.
    payoutMode = _pm ?? mode ?? payout_mode ?? "IMPS";
    bankAccount = accountNumber ?? account_number ?? _bankAccount ?? null;
    bankName = _bankName ?? bank_name ?? null;
    ifscCode = _ifscCode ?? ifsc_code ?? null;
    accountHolder = accountHolderName ?? account_holder_name ?? _accountHolder ?? null;
    upiId = _upiId ?? upi_id ?? null;

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

    const cfgForCreate = await getPayoutConfig();
    const destination: BeneficiaryDestinationInput = { payoutMode, bankAccount, bankName, ifscCode, accountHolder, upiId };
    const beneficiaryRow = await resolveOrCreateBeneficiary(merchantId, cfgForCreate.env, destination);
    resolvedBeneficiaryId = beneficiaryRow.id;
  }

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
          beneficiaryId: resolvedBeneficiaryId,
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
          idempotencyKey,
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
    // Unique violation on (merchant_id, idempotency_key) — a concurrent
    // double-click/retry raced us to the insert. Return the row it created
    // instead of a 500, so the client still gets a single successful result.
    if (idempotencyKey && (e?.code === "23505" || /idempotency_key/.test(String(e?.message ?? "")))) {
      const [existing] = await db
        .select()
        .from(withdrawalsTable)
        .where(and(eq(withdrawalsTable.merchantId, merchantId), eq(withdrawalsTable.idempotencyKey, idempotencyKey)))
        .limit(1);
      if (existing) {
        req.log.info({ merchantId, withdrawalId: existing.id, idempotencyKey }, "payout_idempotent_replay_race");
        res.status(200).json(mapWithdrawal(existing, null, false));
        return;
      }
    }
    throw e;
  }

  req.log.info({ merchantId, withdrawalId: createdWithdrawal.id, amount: amt }, "payout_requested");

  // ── Auto-payout decision engine ─────────────────────────────────────────
  let autoCheck: { eligible: boolean; reason: string; snapshot?: Record<string, unknown> };
  try {
    autoCheck = await checkAutoPayoutEligibility(merchantId, amt, resolvedBeneficiaryId, payoutMode, createdWithdrawal.id);
  } catch (e: any) {
    req.log.warn({ err: e, withdrawalId: createdWithdrawal.id }, "auto_payout_eligibility_check_failed_fallback_manual");
    autoCheck = { eligible: false, reason: "eligibility_check_error" };
  }

  if (!autoCheck.eligible) {
    // ── A: Manual admin approval path ──────────────────────────────────────
    await db.insert(auditLogsTable).values({
      adminId: 0,   // 0 = system/merchant-submitted — no admin involved
      adminEmail: user.email,
      action: "PAYOUT_SENT_TO_MANUAL_APPROVAL",
      targetType: "withdrawal",
      targetId: createdWithdrawal.id,
      details: JSON.stringify({ amount: amt, reason: autoCheck.reason }),
      ipAddress: (req as any).ip ?? null,
    });
    req.log.info({ merchantId, withdrawalId: createdWithdrawal.id, reason: autoCheck.reason }, "payout_sent_to_manual_approval");
    res.status(201).json(mapWithdrawal(createdWithdrawal, null, false));
    return;
  }

  // ── B: Auto-approve — atomically claim pending → approved ───────────────
  const autoNow = new Date();
  const [autoApproved] = await db
    .update(withdrawalsTable)
    .set({
      status: "approved",
      transferStatus: "INITIATED",
      approvedBySystem: true,
      approvalType: "AUTO",
      approvedBy: "SYSTEM_AUTO",
      approvedAt: autoNow,
      autoApprovalRuleSnapshot: (autoCheck.snapshot ?? {}) as any,
    })
    .where(and(eq(withdrawalsTable.id, createdWithdrawal.id), eq(withdrawalsTable.status, "pending")))
    .returning();

  if (!autoApproved) {
    // Concurrent state change — respond with pending state, admin will handle
    req.log.warn({ withdrawalId: createdWithdrawal.id }, "auto_payout_claim_lost_concurrent_change");
    res.status(201).json(mapWithdrawal(createdWithdrawal, null, false));
    return;
  }

  // Fetch merchant contact for beneficiary registration
  const [autoMerchantRow] = await db
    .select({ businessName: merchantsTable.businessName, email: merchantsTable.email, phone: merchantsTable.phone })
    .from(merchantsTable)
    .where(eq(merchantsTable.id, merchantId))
    .limit(1);
  const autoMerchantName = autoMerchantRow?.businessName ?? null;
  const autoMerchantContact = { email: autoMerchantRow?.email ?? null, phone: autoMerchantRow?.phone ?? null };

  // Dispatch to provider
  const dispatch = await dispatchPayoutTransfer(req, autoApproved, autoMerchantName, autoMerchantContact);
  const isAutoTerminal = ["SUCCESS", "FAILED", "REVERSED"].includes(dispatch.transferStatus);

  const [finalWithdrawal] = await db
    .update(withdrawalsTable)
    .set({
      transferStatus: dispatch.transferStatus,
      providerReferenceId: dispatch.providerReferenceId,
      utr: dispatch.utr,
      failureReason: dispatch.failureReason,
      completedAt: isAutoTerminal ? new Date() : null,
    })
    .where(eq(withdrawalsTable.id, autoApproved.id))
    .returning();

  // Wallet mutations on terminal provider result
  if (dispatch.transferStatus === "SUCCESS") {
    await mutateWallet(
      merchantId,
      { holdDelta: -amt, totalPayoutDelta: amt },
      { txnType: "payout_success", bucket: "hold", amount: -amt, referenceType: "withdrawal", referenceId: autoApproved.id, description: `Auto-payout #${autoApproved.id} successful — ₹${fmtAmt(amt)} settled`, createdBy: null }
    );
  } else if (dispatch.transferStatus === "FAILED" || dispatch.transferStatus === "REVERSED") {
    await mutateWallet(
      merchantId,
      { holdDelta: -amt, availableDelta: amt, totalReversalsDelta: amt },
      { txnType: "payout_failed_release", bucket: "hold", amount: amt, referenceType: "withdrawal", referenceId: autoApproved.id, description: `Auto-payout #${autoApproved.id} failed — ₹${fmtAmt(amt)} released back`, createdBy: null }
    );
  }

  await db.insert(auditLogsTable).values({
    adminId: 0,   // 0 = system auto-approval — no admin involved
    adminEmail: user.email,
    action: "PAYOUT_AUTO_APPROVED",
    targetType: "withdrawal",
    targetId: autoApproved.id,
    details: JSON.stringify({ amount: amt, transferStatus: dispatch.transferStatus, providerReferenceId: dispatch.providerReferenceId, snapshot: autoCheck.snapshot }),
    ipAddress: (req as any).ip ?? null,
  });
  req.log.info({ merchantId, withdrawalId: autoApproved.id, transferStatus: dispatch.transferStatus }, "payout_auto_approved");

  res.status(201).json(mapWithdrawal(finalWithdrawal ?? autoApproved, autoMerchantName, false));
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

  // Step 2: Fetch merchant name + real contact details (used for beneficiary
  // registration — Cashfree live mode validates contact info more strictly
  // than sandbox, so a hardcoded placeholder can cause silent create failures)
  const [merchantRow] = await db
    .select({ businessName: merchantsTable.businessName, email: merchantsTable.email, phone: merchantsTable.phone })
    .from(merchantsTable)
    .where(eq(merchantsTable.id, claimed.merchantId))
    .limit(1);
  const merchantName = merchantRow?.businessName ?? null;
  const merchantContact = { email: merchantRow?.email ?? null, phone: merchantRow?.phone ?? null };

  const amt = Number(claimed.amount);
  const cfg = await getPayoutConfig();

  // Step 3: Call provider (row is already committed as "approved/INITIATED")
  let transferStatus = "INITIATED";
  let providerReferenceId: string | null = null;
  let utr: string | null = null;
  let failureReason: string | null = null;

  // If provider is disabled or credentials are missing, mark FAILED immediately
  // so the payout does not remain stranded as approved/INITIATED with no dispatch path.
  if (!cfg.enabled || !cfg.clientId || !cfg.clientSecret) {
    transferStatus = "FAILED";
    failureReason = "PAYOUT_CREDENTIAL_ERROR: Payout gateway disabled or credentials not configured";
    req.log.warn({ withdrawalId: id }, "cashfree_payout_skipped_no_config");
  } else {
    const transferId = `RKPAY_${id}_${Date.now()}`;
    const mode = claimed.payoutMode === "UPI" ? "upi" : "banktransfer";
    const beneficiaryRow = await resolveBeneficiaryRowForWithdrawal(claimed, cfg.env, merchantName);
    const accountMasked = claimed.payoutMode === "UPI"
      ? (claimed.upiId ? `${claimed.upiId.slice(0, 2)}***` : null)
      : (claimed.bankAccount ? `****${claimed.bankAccount.trim().slice(-4)}` : null);

    // First-ever registration for a brand-new beneficiary is allowed inline
    // (it has never been attempted with the provider yet). Once a beneficiary
    // has already been attempted and is FAILED/stale (a previously-reported
    // not-found/invalid state), we never silently retry provider calls here —
    // require an explicit admin "Re-register Beneficiary" action first so a
    // transfer is never dispatched against a beneficiary we already know is bad.
    let bene: { ok: boolean; providerBeneficiaryId?: string; message?: string };
    if (beneficiaryRow.providerStatus === "failed" || beneficiaryRow.providerStatus === "stale") {
      bene = { ok: false, message: BENEFICIARY_NOT_VERIFIED_MESSAGE };
      req.log.warn(
        { withdrawalId: id, merchantId: claimed.merchantId, accountMasked, providerStatus: beneficiaryRow.providerStatus },
        "payout_beneficiary_not_found"
      );
    } else {
      bene = await ensureBeneficiaryProviderRegistered(req, beneficiaryRow, cfg.env, cfg.clientId, cfg.clientSecret, id, false, merchantContact, cfg.providerConfig);
    }
    if (!bene.ok) {
      transferStatus = "FAILED";
      failureReason = bene.message ?? BENEFICIARY_NOT_VERIFIED_MESSAGE;
      req.log.warn(
        { withdrawalId: id, merchantId: claimed.merchantId, accountMasked },
        "payout_transfer_skipped_beneficiary_not_verified"
      );
    } else {
    try {
      req.log.info(
        { withdrawalId: id, merchantId: claimed.merchantId, accountMasked, mode, amount: amt },
        "payout_transfer_create_started"
      );

      const result = await cashfreePayoutCreateTransfer(
        cfg.clientId,
        cfg.clientSecret,
        cfg.env,
        {
          transferId,
          referenceId: transferId,
          beneficiaryId: bene.providerBeneficiaryId,
          beneficiaryName: claimed.accountHolder || merchantName || "Merchant",
          accountNumber: claimed.bankAccount || undefined,
          ifsc: claimed.ifscCode || undefined,
          upiId: claimed.payoutMode === "UPI" ? (claimed.upiId ?? undefined) : undefined,
          amount: amt,
          remark: `Payout #${id}`,
        },
        cfg.providerConfig
      );

      // Safe log only — transferId, mode, amount, httpStatus, providerStatus,
      // subCode, providerMessage. NEVER clientSecret, token, or raw response.
      req.log.info({
        withdrawalId: id,
        transferId,
        mode,
        amount: amt,
        httpStatus: result.httpStatus,
        providerStatus: result.parsed?.status,
        subCode: result.parsed?.subCode,
        providerMessage: result.parsed?.message,
      }, "payout_transfer_attempted");

      if (isBeneficiaryNotFound(result.parsed, result.httpStatus)) {
        // The provider rejected the transfer outright — no real transfer was
        // ever created on Cashfree's side, so we must NOT persist a
        // providerReferenceId (it would make a later refresh-status call
        // fail with "transfer_id does not exist"). Invalidate the
        // beneficiary so the next retry re-registers it and dispatches a
        // brand-new transfer_id.
        await invalidateBeneficiaryProviderRegistration(
          beneficiaryRow.id,
          "Provider reported beneficiary not found on transfer create — will re-register on next attempt"
        );
        transferStatus = "FAILED";
        failureReason = SAFE_REASON_BENEFICIARY_NOT_FOUND;
        req.log.warn(
          {
            withdrawalId: id,
            merchantId: claimed.merchantId,
            accountMasked,
            httpStatus: result.httpStatus,
            subCode: result.parsed?.subCode,
          },
          "payout_beneficiary_not_found"
        );
      } else {
      // Prefer the provider's own reference (cf_transfer_id) when returned;
      // fall back to our own transfer_id if the provider didn't echo one.
      providerReferenceId = result.parsed?.referenceId ?? transferId;
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
        failureReason = SAFE_REASON_BENEFICIARY_NOT_VERIFIED;
      } else {
        transferStatus = "PENDING";
      }
      }
    } catch (err: any) {
      req.log.warn({ err, withdrawalId: id }, "cashfree_payout_create_error");
      // Network/connection error — release hold by marking FAILED
      transferStatus = "FAILED";
      failureReason = `PAYOUT_CREDENTIAL_ERROR: ${err?.message ?? "Could not reach payout provider"}`;
    }
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
// Rejects a payout with a mandatory reason. Allowed for:
//   - pending rows (hold still locked → release it)
//   - approved rows with non-SUCCESS transferStatus and no UTR (cleanup / failed rows)
//     For FAILED/REVERSED rows the hold was already released — skip wallet mutation.
//     For NOT_STARTED/INITIATED/PENDING rows the hold is still locked — release it.
// Atomically guards against concurrent state changes via a conditional UPDATE.
router.post("/:id/reject", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params["id"] as string);
  const { reason } = req.body;
  if (!reason?.trim() || reason.trim().length < 3) {
    res.status(400).json({ error: "Rejection reason is required (minimum 3 characters)" });
    return;
  }

  // Step 1: Fetch current state to validate and determine wallet action.
  const [existing] = await db
    .select({ w: withdrawalsTable, merchantName: merchantsTable.businessName })
    .from(withdrawalsTable)
    .leftJoin(merchantsTable, eq(withdrawalsTable.merchantId, merchantsTable.id))
    .where(eq(withdrawalsTable.id, id))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Payout not found" });
    return;
  }

  const w = existing.w;

  if (w.status === "rejected") {
    res.status(409).json({ error: "Payout is already rejected" });
    return;
  }
  if (w.transferStatus === "SUCCESS" || w.utr) {
    res.status(409).json({ error: "Cannot reject a payout that has already been sent successfully" });
    return;
  }
  if (w.status !== "pending" && w.status !== "approved") {
    res.status(409).json({ error: `Payout is in status '${w.status}' — cannot reject` });
    return;
  }

  // Step 2: Atomically claim: conditional UPDATE guards against concurrent state changes.
  const [claimed] = await db
    .update(withdrawalsTable)
    .set({
      status: "rejected",
      rejectionReason: reason.trim(),
      rejectedByAdminId: user.id,
      rejectedAt: new Date(),
    })
    .where(and(
      eq(withdrawalsTable.id, id),
      inArray(withdrawalsTable.status, ["pending", "approved"]),
      ne(withdrawalsTable.transferStatus, "SUCCESS"),
      isNull(withdrawalsTable.utr),
    ))
    .returning();

  if (!claimed) {
    res.status(409).json({ error: "Payout state changed concurrently — please refresh and try again" });
    return;
  }

  const merchantName = existing.merchantName ?? null;
  const amt = Number(w.amount);

  // Step 3: Wallet mutation — only release hold if it was still locked.
  // FAILED/REVERSED rows already had the hold released when the transfer failed.
  const holdAlreadyReleased = ["FAILED", "REVERSED"].includes(w.transferStatus);

  if (!holdAlreadyReleased) {
    await mutateWallet(
      w.merchantId,
      { holdDelta: -amt, availableDelta: amt },
      {
        txnType: "payout_rejected_release",
        bucket: "hold",
        amount: amt,
        referenceType: "withdrawal",
        referenceId: id,
        description: `Payout #${id} rejected — ₹${fmtAmt(amt)} released back`,
        createdBy: user.id,
      }
    );
  }

  await db.insert(auditLogsTable).values({
    adminId: user.id,
    adminEmail: user.email,
    action: "payout_rejected",
    targetType: "withdrawal",
    targetId: id,
    details: JSON.stringify({
      amount: amt,
      reason: reason.trim(),
      oldStatus: w.status,
      oldTransferStatus: w.transferStatus,
      holdReleased: !holdAlreadyReleased,
    }),
    ipAddress: (req as any).ip ?? null,
  });

  req.log.info(
    { withdrawalId: id, adminId: user.id, oldStatus: w.status, oldTransferStatus: w.transferStatus, holdAlreadyReleased },
    "payout_rejected"
  );
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
  // SUCCESS is already correct — no need to re-check.
  // REVERSED means it was manually handled — don't re-check.
  // FAILED rows with a providerReferenceId may have succeeded on the provider side
  // and need a re-check (that is the core fix for withdrawn #31).
  if (w.transferStatus === "SUCCESS" || w.transferStatus === "REVERSED") {
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
    w.providerReferenceId,
    cfg.providerConfig
  );
  const normalized = normalizeCashfreePayoutStatus(result.parsed?.status);
  const amt = Number(w.amount);
  const now = new Date();

  const newTransferStatus =
    normalized === "SUCCESS" ? "SUCCESS" : normalized === "FAILED" ? "FAILED" : w.transferStatus;
  const newUtr = normalized === "SUCCESS" ? (result.parsed?.utr ?? w.utr) : w.utr;
  // Clear failureReason on SUCCESS — provider confirmed it went through.
  // On FAILED keep the existing reason if set (avoids overwriting a more specific
  // beneficiary or credential error), or fall back to a safe generic constant.
  const newFailureReason =
    normalized === "SUCCESS" ? null :
    normalized === "FAILED" ? (w.failureReason ?? "payout_provider_failed") :
    w.failureReason;
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
    if (["FAILED", "REVERSED"].includes(w.transferStatus)) {
      // Correction path — funds were already released back to available when the
      // payout was recorded as FAILED. Pull them back and credit total payouts,
      // reversing the totalReversals increment that happened at that time.
      await mutateWallet(
        w.merchantId,
        { availableDelta: -amt, totalPayoutDelta: amt, totalReversalsDelta: -amt },
        {
          txnType: "payout_success_correction",
          bucket: "available",
          amount: -amt,
          referenceType: "withdrawal",
          referenceId: id,
          description: `Payout #${id} — provider confirmed SUCCESS (was locally ${w.transferStatus}) — ₹${fmtAmt(amt)} corrected`,
          createdBy: user.id,
        }
      );
    } else {
      // Normal path — funds are still in hold
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
    }
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

  const logEvent =
    normalized === "SUCCESS" && w.transferStatus !== "SUCCESS" ? "provider_success_local_updated" :
    normalized === "FAILED" && !["FAILED", "REVERSED"].includes(w.transferStatus) ? "provider_failed_local_updated" :
    "payout_status_refreshed";

  req.log.info(
    { withdrawalId: id, prevTransferStatus: w.transferStatus, newTransferStatus, logEvent },
    logEvent
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
    .select({
      withdrawal: withdrawalsTable,
      merchantName: merchantsTable.businessName,
      merchantEmail: merchantsTable.email,
      merchantPhone: merchantsTable.phone,
    })
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
  const merchantContact = { email: row.merchantEmail ?? null, phone: row.merchantPhone ?? null };

  if (w.status !== "approved") {
    res.status(400).json({ error: "Can only retry approved payouts" });
    return;
  }
  if (!["FAILED", "REVERSED"].includes(w.transferStatus)) {
    res.status(400).json({
      error: `Payout transfer status is ${w.transferStatus} — only FAILED or REVERSED payouts can be retried`,
    });
    return;
  }
  // Block retry when a provider reference ID exists: the payout reached the provider
  // and may have succeeded even though the local record shows FAILED. Retrying without
  // first confirming the outcome would risk a duplicate payment to the merchant.
  // Admin must run "Check Payout Status" first to clear this gate.
  if (w.providerReferenceId) {
    res.status(409).json({
      error: "This payout has a provider reference ID — it may have succeeded on the provider side. Run 'Check Payout Status' first before retrying to avoid a duplicate payment.",
      hasProviderReference: true,
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
  // Claim only from FAILED or REVERSED — these are the states where funds were
  // released back. Once claimed, the row becomes INITIATED, so any subsequent
  // concurrent request will see INITIATED in the predicate and return 0 rows.
  // INITIATED payouts are rejected here (409) because they are either already
  // in-flight or have already been claimed by a concurrent retry request.
  const claimed = await db
    .update(withdrawalsTable)
    .set({ transferStatus: "INITIATED" })
    .where(
      and(
        eq(withdrawalsTable.id, id),
        inArray(withdrawalsTable.transferStatus, ["FAILED", "REVERSED"]),
      )
    )
    .returning({ id: withdrawalsTable.id });

  if (claimed.length === 0) {
    res.status(409).json({ error: "A retry is already in progress for this payout, or the payout is not in a retryable state. Please refresh and try again." });
    return;
  }

  const amt = Number(w.amount);
  // Claim only succeeds from FAILED/REVERSED — funds were already released back.
  // Keep the original status so we can restore it if re-lock fails.
  const originalTransferStatus = w.transferStatus;

  {
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
      // Re-lock failed — restore the row to its original status so it remains retryable.
      await db
        .update(withdrawalsTable)
        .set({ transferStatus: originalTransferStatus })
        .where(eq(withdrawalsTable.id, id));
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

  const retryMode = w.payoutMode === "UPI" ? "upi" : "banktransfer";
  // Only set once a transfer is genuinely dispatched to the provider — never
  // defaults to the locally-generated transfer_id, or a later refresh-status
  // call would query a transfer that was never actually created on Cashfree.
  let providerReferenceId: string | null = null;

  const retryAccountMasked = w.payoutMode === "UPI"
    ? (w.upiId ? `${w.upiId.slice(0, 2)}***` : null)
    : (w.bankAccount ? `****${w.bankAccount.trim().slice(-4)}` : null);
  const retryBeneficiaryRow = await resolveBeneficiaryRowForWithdrawal(w, cfg.env, merchantName);

  // Retry never silently re-attempts provider registration for a beneficiary
  // already known to be FAILED/stale — require explicit admin "Re-register
  // Beneficiary" first. Only a brand-new (never-attempted) beneficiary is
  // registered inline here.
  let retryBene: { ok: boolean; providerBeneficiaryId?: string; message?: string };
  if (retryBeneficiaryRow.providerStatus === "failed" || retryBeneficiaryRow.providerStatus === "stale") {
    retryBene = { ok: false, message: BENEFICIARY_NOT_VERIFIED_MESSAGE };
    req.log.warn(
      { withdrawalId: id, merchantId: w.merchantId, accountMasked: retryAccountMasked, providerStatus: retryBeneficiaryRow.providerStatus },
      "payout_beneficiary_not_found"
    );
  } else {
    retryBene = await ensureBeneficiaryProviderRegistered(req, retryBeneficiaryRow, cfg.env, cfg.clientId, cfg.clientSecret, id, false, merchantContact, cfg.providerConfig);
  }

  if (!retryBene.ok) {
    transferStatus = "FAILED";
    failureReason = retryBene.message ?? BENEFICIARY_NOT_VERIFIED_MESSAGE;
    req.log.warn(
      { withdrawalId: id, merchantId: w.merchantId, accountMasked: retryAccountMasked },
      "payout_transfer_skipped_beneficiary_not_verified"
    );
  } else {
  try {
    req.log.info(
      { withdrawalId: id, merchantId: w.merchantId, accountMasked: retryAccountMasked, mode: retryMode, amount: amt },
      "payout_transfer_create_started"
    );

    const result = await cashfreePayoutCreateTransfer(
      cfg.clientId,
      cfg.clientSecret,
      cfg.env,
      {
        transferId: newTransferId,
        referenceId: newTransferId,
        beneficiaryId: retryBene.providerBeneficiaryId,
        beneficiaryName: w.accountHolder || merchantName || "Merchant",
        accountNumber: w.bankAccount || undefined,
        ifsc: w.ifscCode || undefined,
        upiId: w.payoutMode === "UPI" ? (w.upiId ?? undefined) : undefined,
        amount: amt,
        remark: `Payout #${id} retry`,
      },
      cfg.providerConfig
    );

    // Safe log only — transferId, mode, amount, httpStatus, providerStatus,
    // subCode, providerMessage. NEVER clientSecret, token, or raw response.
    req.log.info({
      withdrawalId: id,
      transferId: newTransferId,
      mode: retryMode,
      amount: amt,
      httpStatus: result.httpStatus,
      providerStatus: result.parsed?.status,
      subCode: result.parsed?.subCode,
      providerMessage: result.parsed?.message,
    }, "payout_transfer_attempted");

    if (isBeneficiaryNotFound(result.parsed, result.httpStatus)) {
      // No real transfer was created at the provider — do not persist a
      // providerReferenceId. Invalidate the beneficiary so the next retry
      // re-registers it and dispatches a brand-new transfer_id.
      await invalidateBeneficiaryProviderRegistration(
        retryBeneficiaryRow.id,
        "Provider reported beneficiary not found on transfer create (retry) — will re-register on next attempt"
      );
      transferStatus = "FAILED";
      failureReason = SAFE_REASON_BENEFICIARY_NOT_FOUND;
      req.log.warn(
        {
          withdrawalId: id,
          merchantId: w.merchantId,
          accountMasked: retryAccountMasked,
          httpStatus: result.httpStatus,
          subCode: result.parsed?.subCode,
        },
        "payout_beneficiary_not_found"
      );
    } else {
    // Prefer the provider's own reference (cf_transfer_id) when returned;
    // fall back to our own transfer_id if the provider didn't echo one.
    providerReferenceId = result.parsed?.referenceId ?? newTransferId;
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
      failureReason = SAFE_REASON_BENEFICIARY_NOT_VERIFIED;
    } else {
      transferStatus = "PENDING";
    }
    }
  } catch (err: any) {
    req.log.warn({ err, withdrawalId: id }, "cashfree_payout_retry_error");
    // Network/connection error — release any re-locked hold by marking FAILED
    transferStatus = "FAILED";
    failureReason = `PAYOUT_CREDENTIAL_ERROR: ${err?.message ?? "Could not reach payout provider"}`;
  }
  }

  const now = new Date();
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

// POST /api/withdrawals/:id/reregister-beneficiary — admin only.
// Forces a fresh provider registration for this payout's beneficiary,
// clearing any stale/invalid provider_beneficiary_id. Does NOT create a
// transfer or touch wallet balances — it only fixes the beneficiary so a
// subsequent retry can dispatch a brand-new transfer_id.
router.post("/:id/reregister-beneficiary", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params["id"] as string);

  const [row] = await db
    .select({
      withdrawal: withdrawalsTable,
      merchantName: merchantsTable.businessName,
      merchantEmail: merchantsTable.email,
      merchantPhone: merchantsTable.phone,
    })
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
  const merchantContact = { email: row.merchantEmail ?? null, phone: row.merchantPhone ?? null };

  const cfg = await getPayoutConfig();
  if (!cfg.enabled || !cfg.clientId || !cfg.clientSecret) {
    res.status(400).json({
      error: "Payout provider credentials invalid. Check payout Client ID / Secret in Gateway Settings.",
    });
    return;
  }

  const beneficiaryRow = await resolveBeneficiaryRowForWithdrawal(w, cfg.env, merchantName);
  const result = await reregisterBeneficiaryWithProvider(
    req,
    beneficiaryRow,
    cfg.env,
    cfg.clientId,
    cfg.clientSecret,
    id,
    "Admin manual re-registration from payout row",
    merchantContact,
    cfg.providerConfig
  );

  const [freshBeneficiary] = await db
    .select()
    .from(payoutBeneficiariesTable)
    .where(eq(payoutBeneficiariesTable.id, beneficiaryRow.id))
    .limit(1);

  await db.insert(auditLogsTable).values({
    adminId: user.id,
    adminEmail: user.email,
    action: "payout_beneficiary_reregistered",
    targetType: "withdrawal",
    targetId: id,
    details: JSON.stringify({ beneficiaryId: beneficiaryRow.id, success: result.ok }),
    ipAddress: (req as any).ip ?? null,
  });

  req.log.info(
    { withdrawalId: id, beneficiaryId: beneficiaryRow.id, adminId: user.id, success: result.ok },
    "payout_beneficiary_reregistered"
  );

  res.json({
    success: result.ok,
    providerStatus: freshBeneficiary?.providerStatus ?? "failed",
    beneficiaryStatus: toBeneficiaryStatus(freshBeneficiary?.providerStatus ?? "failed"),
    message: result.ok ? null : result.message,
  });
});

// POST /api/withdrawals/:id/repair-beneficiary-mapping — admin only.
// Non-destructive repair: finds the beneficiary on the provider side (by
// providerBeneficiaryId or by bank account+IFSC) and syncs the result back
// to our local row. Unlike re-register, this never creates anything new —
// it only reads from the provider and updates the local providerBeneficiaryId
// if a confirmed beneficiary is found. Use this first when a payout fails
// with beneficiary_not_found; only use re-register if repair also fails.
router.post("/:id/repair-beneficiary-mapping", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params["id"] as string);

  const [row] = await db
    .select({
      withdrawal: withdrawalsTable,
      merchantName: merchantsTable.businessName,
    })
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

  const cfg = await getPayoutConfig();
  if (!cfg.enabled || !cfg.clientId || !cfg.clientSecret) {
    res.status(400).json({
      error: "Payout provider credentials invalid. Check payout Client ID / Secret in Gateway Settings.",
    });
    return;
  }

  const beneficiaryRow = await resolveBeneficiaryRowForWithdrawal(w, cfg.env, merchantName);
  const repair = await repairBeneficiaryMappingFromProvider(
    req,
    beneficiaryRow,
    cfg.env,
    cfg.clientId,
    cfg.clientSecret,
    id,
    cfg.providerConfig
  );

  const [freshBeneficiary] = await db
    .select()
    .from(payoutBeneficiariesTable)
    .where(eq(payoutBeneficiariesTable.id, beneficiaryRow.id))
    .limit(1);

  await db.insert(auditLogsTable).values({
    adminId: user.id,
    adminEmail: user.email,
    action: "payout_beneficiary_mapping_repaired",
    targetType: "withdrawal",
    targetId: id,
    details: JSON.stringify({
      beneficiaryId: beneficiaryRow.id,
      foundOnProvider: repair.foundOnProvider,
      providerBeneficiaryId: repair.providerBeneficiaryId ?? null,
    }),
    ipAddress: (req as any).ip ?? null,
  });

  req.log.info(
    {
      withdrawalId: id,
      beneficiaryId: beneficiaryRow.id,
      adminId: user.id,
      foundOnProvider: repair.foundOnProvider,
      ok: repair.ok,
    },
    "payout_beneficiary_mapping_repair_completed"
  );

  res.json({
    ok: repair.ok,
    foundOnProvider: repair.foundOnProvider,
    providerBeneficiaryId: repair.providerBeneficiaryId ?? null,
    beneficiaryStatus: repair.beneficiaryStatus,
    message: repair.message ?? null,
  });
});

// POST /api/withdrawals/:id/beneficiary-status — admin only.
// Read-only "Check Status" action: queries the provider for the current
// beneficiary state without creating/mutating anything. Only updates our
// local record on a confirmed 200 (VERIFIED) or 404 (not found) response —
// never guesses from an ambiguous/error response.
router.post("/:id/beneficiary-status", requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string);

  const [row] = await db
    .select({
      withdrawal: withdrawalsTable,
      merchantName: merchantsTable.businessName,
    })
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

  const cfg = await getPayoutConfig();
  if (!cfg.enabled || !cfg.clientId || !cfg.clientSecret) {
    res.status(400).json({
      error: "Payout provider credentials invalid. Check payout Client ID / Secret in Gateway Settings.",
    });
    return;
  }

  const beneficiaryRow = await resolveBeneficiaryRowForWithdrawal(w, cfg.env, merchantName);
  const status = await checkBeneficiaryProviderStatus(
    req,
    beneficiaryRow,
    cfg.env,
    cfg.clientId,
    cfg.clientSecret,
    cfg.providerConfig
  );

  res.json({
    beneficiaryId: beneficiaryRow.id,
    providerStatus: status.providerStatus,
    beneficiaryStatus: status.beneficiaryStatus,
    checkedAt: new Date().toISOString(),
  });
});

// ── Payout slip helpers ────────────────────────────────────────────────────────
function maskAccount(acct: string | null | undefined): string | null {
  if (!acct || acct.length === 0) return null;
  return acct.length <= 4 ? "****" : "****" + acct.slice(-4);
}

function maskUpi(upi: string | null | undefined): string | null {
  if (!upi) return null;
  const at = upi.indexOf("@");
  if (at < 0) return upi.slice(0, 2) + "***";
  const user = upi.slice(0, at);
  const domain = upi.slice(at);
  return (user.length <= 2 ? user : user.slice(0, 2)) + "***" + domain;
}

function getSlipDisplayStatus(w: typeof withdrawalsTable.$inferSelect): {
  displayStatus: PayoutDisplayStatus;
  statusLabel: string;
  isNotFinal: boolean;
} {
  if (w.status === "rejected")
    return { displayStatus: "REJECTED", statusLabel: "Payout Rejected", isNotFinal: false };
  if (w.status === "pending")
    return { displayStatus: "PROCESSING", statusLabel: "Payout Processing", isNotFinal: true };
  if (w.transferStatus === "SUCCESS")
    return { displayStatus: "SUCCESS", statusLabel: "Payout Sent", isNotFinal: false };
  if (w.transferStatus === "FAILED" || w.transferStatus === "REVERSED")
    return { displayStatus: "FAILED", statusLabel: "Payout Failed", isNotFinal: false };
  return { displayStatus: "PROCESSING", statusLabel: "Payout Processing", isNotFinal: true };
}

export function buildSlipData(
  w: typeof withdrawalsTable.$inferSelect,
  merchantName: string | null,
): PayoutSlipData {
  const { displayStatus, statusLabel, isNotFinal } = getSlipDisplayStatus(w);
  const walletRefunded = w.transferStatus === "FAILED" || w.transferStatus === "REVERSED";

  const rawFailure = w.failureReason ?? null;
  const safeFailureReason = walletRefunded
    ? (rawFailure?.startsWith("PAYOUT_CREDENTIAL_ERROR")
        ? "Payout credentials invalid. Please contact support."
        : (rawFailure ?? "Transfer could not be completed. Please contact support."))
    : null;

  const fmt = (d: Date | null | undefined): string | null =>
    d ? d.toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          dateStyle: "medium",
          timeStyle: "short",
        }) + " IST"
      : null;

  const processedAt = w.completedAt ?? w.approvedAt ?? w.rejectedAt ?? null;

  return {
    id: w.id,
    receiptId: `RK-PO-${String(w.id).padStart(6, "0")}`,
    generatedAt: fmt(new Date()) ?? new Date().toISOString(),
    merchant: { businessName: merchantName ?? `Merchant #${w.merchantId}` },
    amount: Number(w.amount),
    currency: w.currency ?? "INR",
    payoutMode: w.payoutMode,
    displayStatus,
    statusLabel,
    utr: displayStatus === "SUCCESS" ? (w.utr ?? null) : null,
    safeFailureReason,
    rejectionReason: w.rejectionReason ?? null,
    requestedAt: fmt(w.createdAt) ?? "—",
    processedAt: fmt(processedAt),
    beneficiary: {
      name: w.accountHolder ?? null,
      bankName: w.bankName ?? null,
      maskedAccount: maskAccount(w.bankAccount),
      ifscCode: w.ifscCode ?? null,
      maskedUpi: maskUpi(w.upiId),
    },
    remarks: w.remarks ?? null,
    isNotFinal,
    walletRefunded,
  };
}

// POST /api/withdrawals/:id/slip/share-link — create a 24-hour signed share link
router.post("/:id/slip/share-link", async (req, res, next) => {
  try {
    const user = (req as any).user as { id: number; email: string; role: string; merchantId?: number };
    const id   = parseInt(req.params["id"] as string);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const isAdmin = user.role === "admin";
    const conditions: ReturnType<typeof eq>[] = [eq(withdrawalsTable.id, id)];
    if (!isAdmin && user.merchantId) conditions.push(eq(withdrawalsTable.merchantId, user.merchantId));

    const [row] = await db
      .select({ id: withdrawalsTable.id })
      .from(withdrawalsTable)
      .where(and(...conditions))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Payout not found" }); return; }

    const shareToken = signSlipShareToken(id);
    const expiresAt  = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const url        = `/payout-slip/${shareToken}`;

    await db.insert(auditLogsTable).values({
      adminId:    user.id,
      adminEmail: user.email,
      action:     "payout_slip_shared",
      targetType: "withdrawal",
      targetId:   id,
      details:    JSON.stringify({ payoutId: id, role: user.role, expiresAt }),
      ipAddress:  req.ip ?? null,
    }).catch(err => req.log.warn({ err }, "audit_log_insert_failed"));

    res.json({ url, expiresAt });
  } catch (err) { next(err); }
});

// GET /api/withdrawals/:id/slip — JSON slip data for modal preview
router.get("/:id/slip", async (req, res, next) => {
  try {
    const user = (req as any).user as { id: number; email: string; role: string; merchantId?: number };
    const id   = parseInt(req.params["id"] as string);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const isAdmin = user.role === "admin";
    const conditions: ReturnType<typeof eq>[] = [eq(withdrawalsTable.id, id)];
    if (!isAdmin && user.merchantId) conditions.push(eq(withdrawalsTable.merchantId, user.merchantId));

    const [row] = await db
      .select({ withdrawal: withdrawalsTable, merchantName: merchantsTable.businessName })
      .from(withdrawalsTable)
      .leftJoin(merchantsTable, eq(withdrawalsTable.merchantId, merchantsTable.id))
      .where(and(...conditions))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Payout not found" }); return; }

    await db.insert(auditLogsTable).values({
      adminId:     user.id,
      adminEmail:  user.email,
      action:      "payout_slip_viewed",
      targetType:  "withdrawal",
      targetId:    id,
      details:     JSON.stringify({ payoutId: id, role: user.role }),
      ipAddress:   req.ip ?? null,
    }).catch(err => req.log.warn({ err }, "audit_log_insert_failed"));

    res.json(buildSlipData(row.withdrawal, row.merchantName ?? null));
  } catch (err) { next(err); }
});

// GET /api/withdrawals/:id/slip.pdf — PDF download
router.get("/:id/slip.pdf", async (req, res, next) => {
  try {
    const user = (req as any).user as { id: number; email: string; role: string; merchantId?: number };
    const id   = parseInt(req.params["id"] as string);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const isAdmin = user.role === "admin";
    const conditions: ReturnType<typeof eq>[] = [eq(withdrawalsTable.id, id)];
    if (!isAdmin && user.merchantId) conditions.push(eq(withdrawalsTable.merchantId, user.merchantId));

    const [row] = await db
      .select({ withdrawal: withdrawalsTable, merchantName: merchantsTable.businessName })
      .from(withdrawalsTable)
      .leftJoin(merchantsTable, eq(withdrawalsTable.merchantId, merchantsTable.id))
      .where(and(...conditions))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Payout not found" }); return; }

    await db.insert(auditLogsTable).values({
      adminId:     user.id,
      adminEmail:  user.email,
      action:      "payout_slip_downloaded",
      targetType:  "withdrawal",
      targetId:    id,
      details:     JSON.stringify({ payoutId: id, role: user.role, format: "pdf" }),
      ipAddress:   req.ip ?? null,
    }).catch(err => req.log.warn({ err }, "audit_log_insert_failed"));

    const slip   = buildSlipData(row.withdrawal, row.merchantName ?? null);
    const pdfBuf = await buildPayoutSlipPdf(slip);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="rasokart-payout-slip-${id}.pdf"`);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.send(pdfBuf);
  } catch (err) { next(err); }
});

export default router;
