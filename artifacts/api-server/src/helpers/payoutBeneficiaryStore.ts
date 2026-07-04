import { db, payoutBeneficiariesTable, withdrawalsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  cashfreePayoutEnsureBeneficiary,
  type CashfreePayoutEnv,
  type PayoutProviderConfig,
} from "./cashfreePayout";

export type BeneficiaryDestinationInput = {
  payoutMode: string;
  bankAccount?: string | null;
  bankName?: string | null;
  ifscCode?: string | null;
  upiId?: string | null;
  accountHolder?: string | null;
  label?: string | null;
};

/**
 * Deterministic fingerprint of a payout destination (bank account+IFSC, or
 * UPI VPA), scoped to merchant+env by the caller via the unique index. Used
 * to dedup saved beneficiaries and to look up an already-registered one
 * before creating a new one at the provider.
 */
export function beneficiaryKeyFor(input: BeneficiaryDestinationInput): string {
  const isUpi = input.payoutMode === "UPI" && !!input.upiId?.trim();
  return isUpi
    ? `upi:${input.upiId!.trim().toLowerCase()}`
    : `bank:${(input.bankAccount ?? "").trim()}:${(input.ifscCode ?? "").trim().toUpperCase()}`;
}

export function maskBankAccountLast4(bankAccount?: string | null): string | null {
  if (!bankAccount) return null;
  const digits = bankAccount.trim();
  if (digits.length <= 4) return digits;
  return digits.slice(-4);
}

export function maskUpiId(upiId?: string | null): string | null {
  if (!upiId) return null;
  const [user, domain] = upiId.split("@");
  if (!domain) return upiId.length > 3 ? `${upiId.slice(0, 2)}***` : "***";
  const visible = user.slice(0, 2);
  return `${visible}***@${domain}`;
}

type BeneficiaryRow = typeof payoutBeneficiariesTable.$inferSelect;

/**
 * Find an existing beneficiary row for this merchant+env+destination, or
 * create a new one (provider_status = not_created — provider registration
 * happens separately via `ensureBeneficiaryProviderRegistered`).
 */
export async function resolveOrCreateBeneficiary(
  merchantId: number,
  env: CashfreePayoutEnv,
  input: BeneficiaryDestinationInput
): Promise<BeneficiaryRow> {
  const beneficiaryKey = beneficiaryKeyFor(input);

  const [existing] = await db
    .select()
    .from(payoutBeneficiariesTable)
    .where(
      and(
        eq(payoutBeneficiariesTable.merchantId, merchantId),
        eq(payoutBeneficiariesTable.env, env),
        eq(payoutBeneficiariesTable.beneficiaryKey, beneficiaryKey)
      )
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(payoutBeneficiariesTable)
    .values({
      merchantId,
      env,
      label: input.label ?? null,
      payoutMode: input.payoutMode,
      bankAccount: input.bankAccount ?? null,
      bankName: input.bankName ?? null,
      ifscCode: input.ifscCode ?? null,
      accountHolder: input.accountHolder ?? null,
      upiId: input.payoutMode === "UPI" ? (input.upiId ?? null) : null,
      beneficiaryKey,
      providerBeneficiaryId: null,
      localStatus: "active",
      providerStatus: "not_created",
      lastProviderError: null,
      // legacy columns kept in sync for backward compat
      status: "active",
      lastError: null,
    })
    .onConflictDoNothing({
      target: [
        payoutBeneficiariesTable.merchantId,
        payoutBeneficiariesTable.env,
        payoutBeneficiariesTable.beneficiaryKey,
      ],
    })
    .returning();

  if (created) return created;

  // Lost a race with a concurrent insert — fetch the row the other request created.
  const [raced] = await db
    .select()
    .from(payoutBeneficiariesTable)
    .where(
      and(
        eq(payoutBeneficiariesTable.merchantId, merchantId),
        eq(payoutBeneficiariesTable.env, env),
        eq(payoutBeneficiariesTable.beneficiaryKey, beneficiaryKey)
      )
    )
    .limit(1);
  return raced!;
}

export type EnsureProviderResult = {
  ok: boolean;
  providerBeneficiaryId?: string;
  message?: string;
};

/**
 * Ensure a beneficiary row is actually registered with the payout provider.
 * Trusts a prior `provider_status = 'created'` unless `forceRefresh` is set
 * (used when the provider reports beneficiary_not_found on a transfer).
 *
 * Uses an opaque, deterministic local ID derived from the row's own primary
 * key (never from raw bank/UPI details), and persists the outcome so future
 * approve/retry calls skip the network round trip.
 */
export async function ensureBeneficiaryProviderRegistered(
  req: any,
  beneficiaryRow: BeneficiaryRow,
  env: CashfreePayoutEnv,
  clientId: string,
  clientSecret: string,
  withdrawalId?: number | null,
  forceRefresh = false,
  merchantContact?: { email?: string | null; phone?: string | null },
  providerConfig?: PayoutProviderConfig
): Promise<EnsureProviderResult> {
  if (!forceRefresh && beneficiaryRow.providerStatus === "created" && beneficiaryRow.providerBeneficiaryId) {
    return { ok: true, providerBeneficiaryId: beneficiaryRow.providerBeneficiaryId };
  }

  const localBeneficiaryId = `BENE_M${beneficiaryRow.merchantId}_${beneficiaryRow.id}`.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 50);

  // Safe log fields only — payoutId/merchantId/masked account, never
  // bank/secret/token/raw provider response.
  const accountMasked = beneficiaryRow.payoutMode === "UPI"
    ? maskUpiId(beneficiaryRow.upiId)
    : `****${maskBankAccountLast4(beneficiaryRow.bankAccount) ?? ""}`;
  const logCtx = {
    payoutId: withdrawalId ?? null,
    merchantId: beneficiaryRow.merchantId,
    accountMasked,
    mode: beneficiaryRow.payoutMode,
  };

  req.log.info(logCtx, "payout_beneficiary_create_request_started");

  const ensured = await cashfreePayoutEnsureBeneficiary(clientId, clientSecret, env, localBeneficiaryId, {
    beneficiaryName: beneficiaryRow.accountHolder ?? undefined,
    accountNumber: beneficiaryRow.bankAccount ?? undefined,
    ifsc: beneficiaryRow.ifscCode ?? undefined,
    upiId: beneficiaryRow.payoutMode === "UPI" ? (beneficiaryRow.upiId ?? undefined) : undefined,
    amount: 0,
    beneficiaryEmail: merchantContact?.email ?? undefined,
    beneficiaryPhone: merchantContact?.phone ?? undefined,
  }, providerConfig);

  // Logged unconditionally right after the create call returns, before any
  // pass/fail decision is made — records only the safe httpStatus/subCode,
  // never the raw provider response body.
  req.log.info(
    { ...logCtx, httpStatus: ensured.httpStatus, subCode: ensured.subCode },
    "payout_beneficiary_create_response_received"
  );

  if (!ensured.ok && ensured.stage === "create") {
    if (ensured.likelyEndpointOrPayloadIssue) {
      // A 404 on CREATE is never a legitimate "beneficiary not found" — it
      // means the request hit the wrong route or the payload was rejected.
      // Logged as a distinct event so it is never confused with a genuine
      // provider-side not-found on GET/transfer calls.
      req.log.error(
        { ...logCtx, httpStatus: ensured.httpStatus, subCode: ensured.subCode, endpointPath: ensured.endpointPath },
        "payout_beneficiary_create_failed_endpoint_or_payload"
      );
    }
    req.log.warn(
      { ...logCtx, httpStatus: ensured.httpStatus, subCode: ensured.subCode },
      "payout_beneficiary_create_failed"
    );
    const safeMessage = "Beneficiary setup failed. Please re-register beneficiary.";
    await db
      .update(payoutBeneficiariesTable)
      .set({
        providerStatus: "failed",
        lastProviderError: safeMessage,
        status: "failed",
        lastError: safeMessage,
      })
      .where(eq(payoutBeneficiariesTable.id, beneficiaryRow.id));
    return { ok: false, message: safeMessage };
  }

  req.log.info(logCtx, "payout_beneficiary_verify_started");

  if (!ensured.ok && ensured.stage === "verify") {
    req.log.warn(
      { ...logCtx, httpStatus: ensured.httpStatus, subCode: ensured.subCode },
      "payout_beneficiary_verify_failed"
    );
    const safeMessage = "Beneficiary setup could not be verified. Please retry later.";
    await db
      .update(payoutBeneficiariesTable)
      .set({
        providerStatus: "failed",
        lastProviderError: safeMessage,
        status: "failed",
        lastError: safeMessage,
      })
      .where(eq(payoutBeneficiariesTable.id, beneficiaryRow.id));
    return { ok: false, message: safeMessage };
  }

  req.log.info({ ...logCtx, httpStatus: ensured.httpStatus }, "payout_beneficiary_verify_success");

  await db
    .update(payoutBeneficiariesTable)
    .set({
      providerBeneficiaryId: ensured.beneficiaryId,
      providerStatus: "created",
      lastProviderError: null,
      status: "active",
      lastError: null,
    })
    .where(eq(payoutBeneficiariesTable.id, beneficiaryRow.id));

  return { ok: true, providerBeneficiaryId: ensured.beneficiaryId };
}

/**
 * Reset a beneficiary's provider registration after the provider reports
 * beneficiary_not_found (or another stale/invalid signal) on a transfer, so
 * the next attempt re-creates it instead of retrying against an ID Cashfree
 * says doesn't exist. Marks the row `provider_status = 'stale'` — distinct
 * from `'failed'` (a genuine registration failure) — so the UI/admin can
 * tell "we know this ID is bad, will re-register" apart from "registration
 * itself failed at the provider".
 */
export async function invalidateBeneficiaryProviderRegistration(
  beneficiaryId: number,
  reason = "Provider reported beneficiary not found on transfer — will re-register on next attempt"
) {
  await db
    .update(payoutBeneficiariesTable)
    .set({
      providerBeneficiaryId: null,
      providerStatus: "stale",
      lastProviderError: reason,
      status: "failed",
      lastError: reason,
    })
    .where(eq(payoutBeneficiariesTable.id, beneficiaryId));
}

/**
 * Force a fresh provider registration for a beneficiary — used by the admin
 * "Re-register Beneficiary" action and by the automatic invalid-beneficiary
 * recovery path. Always clears the existing (possibly stale/invalid)
 * provider_beneficiary_id first and only persists a new one after the
 * provider confirms it was created — never reuses the old id.
 */
export async function reregisterBeneficiaryWithProvider(
  req: any,
  beneficiaryRow: BeneficiaryRow,
  env: CashfreePayoutEnv,
  clientId: string,
  clientSecret: string,
  withdrawalId?: number | null,
  reason = "Manual re-registration requested",
  merchantContact?: { email?: string | null; phone?: string | null },
  providerConfig?: PayoutProviderConfig
): Promise<EnsureProviderResult> {
  req.log.info(
    { withdrawalId: withdrawalId ?? null, beneficiaryId: beneficiaryRow.id, reason },
    "payout_beneficiary_reregister_started"
  );

  await invalidateBeneficiaryProviderRegistration(beneficiaryRow.id, reason);

  const staleRow: BeneficiaryRow = {
    ...beneficiaryRow,
    providerBeneficiaryId: null,
    providerStatus: "stale",
  };

  const result = await ensureBeneficiaryProviderRegistered(
    req,
    staleRow,
    env,
    clientId,
    clientSecret,
    withdrawalId,
    true,
    merchantContact,
    providerConfig
  );

  if (result.ok) {
    req.log.info(
      { withdrawalId: withdrawalId ?? null, beneficiaryId: beneficiaryRow.id },
      "payout_beneficiary_reregister_success"
    );
  } else {
    req.log.warn(
      { withdrawalId: withdrawalId ?? null, beneficiaryId: beneficiaryRow.id, message: result.message },
      "payout_beneficiary_reregister_failed"
    );
  }

  return result;
}

/**
 * True once any withdrawal referencing this beneficiary reached
 * transferStatus = SUCCESS. Used to lock direct edits (audit integrity) —
 * callers should create a new beneficiary record instead.
 */
export async function beneficiaryUsedInSuccessfulPayout(beneficiaryId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: withdrawalsTable.id })
    .from(withdrawalsTable)
    .where(
      and(
        eq(withdrawalsTable.beneficiaryId, beneficiaryId),
        eq(withdrawalsTable.transferStatus, "SUCCESS")
      )
    )
    .limit(1);
  return !!row;
}

export function mapBeneficiary(
  row: BeneficiaryRow,
  usedInSuccessfulPayout: boolean,
  merchantName?: string | null
) {
  return {
    id: row.id,
    merchantId: row.merchantId,
    merchantName: merchantName ?? null,
    label: row.label,
    payoutMode: row.payoutMode,
    bankName: row.bankName,
    bankAccountLast4: maskBankAccountLast4(row.bankAccount),
    ifscCode: row.ifscCode,
    accountHolder: row.accountHolder,
    upiIdMasked: maskUpiId(row.upiId),
    localStatus: row.localStatus,
    providerStatus: row.providerStatus,
    lastProviderError: row.lastProviderError,
    usedInSuccessfulPayout,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
