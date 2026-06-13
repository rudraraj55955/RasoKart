export type CashfreePayoutEnv = "test" | "live";

const PAYOUT_BASE_URLS: Record<CashfreePayoutEnv, string> = {
  test: "https://sandbox.cashfree.com/payout",
  live: "https://api.cashfree.com/payout",
};

type PayoutCreateInput = {
  referenceId?: string;
  transferId?: string;
  beneficiaryName?: string;
  accountNumber?: string;
  ifsc?: string;
  upiId?: string;
  amount: number;
  remark?: string;
};

export function normalizeCashfreePayoutStatus(status?: string | null): "PENDING" | "SUCCESS" | "FAILED" {
  const s = String(status ?? "").trim().toUpperCase();
  if (["SUCCESS", "COMPLETED", "PROCESSED", "TRANSFER_SUCCESS", "ACKNOWLEDGED", "RECEIVED"].includes(s)) return "SUCCESS";
  if (["PENDING", "PROCESSING", "IN_PROGRESS", "QUEUED", "APPROVAL_PENDING", "VALIDATION_PENDING"].includes(s)) return "PENDING";
  return "FAILED";
}

async function readJson(res: any) {
  const raw = await res.text();
  let parsed: any = {};
  try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { status: "ERROR", message: raw }; }
  return { raw, parsed, httpStatus: res.status };
}

function cleanId(v: string, max = 40) {
  return v.replace(/[^A-Za-z0-9_]/g, "_").slice(0, max);
}

function cleanName(v?: string) {
  return (v || "Test User").replace(/[^A-Za-z ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Test User";
}

function flattenV2Response(parsed: any) {
  return {
    ...parsed,
    status: parsed?.status,
    subCode: parsed?.status_code ?? parsed?.code ?? parsed?.subCode,
    message: parsed?.status_description ?? parsed?.message,
    transferId: parsed?.cf_transfer_id ?? parsed?.transfer_id,
    referenceId: parsed?.cf_transfer_id ?? parsed?.transfer_id,
    utr: parsed?.transfer_utr ?? parsed?.utr,
  };
}

async function createBeneficiaryIfNeeded(
  clientId: string,
  clientSecret: string,
  env: CashfreePayoutEnv,
  beneficiaryId: string,
  input: PayoutCreateInput
) {
  const baseUrl = PAYOUT_BASE_URLS[env] ?? PAYOUT_BASE_URLS.test;
  const isUpi = Boolean(input.upiId?.trim());

  const body: any = {
    beneficiary_id: beneficiaryId,
    beneficiary_name: cleanName(input.beneficiaryName),
    beneficiary_instrument_details: isUpi
      ? { vpa: input.upiId?.trim() }
      : { bank_account_number: input.accountNumber?.trim(), bank_ifsc: input.ifsc?.trim() },
    beneficiary_contact_details: {
      beneficiary_email: "test@rasokart.com",
      beneficiary_phone: "9999999999",
      beneficiary_country_code: "+91",
      beneficiary_address: "RasoKart",
      beneficiary_city: "Jaipur",
      beneficiary_state: "Rajasthan",
      beneficiary_postal_code: "302001"
    }
  };

  const res = await fetch(`${baseUrl}/beneficiary`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-version": "2024-01-01",
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
    },
    body: JSON.stringify(body),
  });

  const out = await readJson(res);

  if (out.httpStatus === 201 || out.httpStatus === 200 || out.httpStatus === 409) {
    return { ok: true, raw: out.raw, parsed: out.parsed };
  }

  return {
    ok: false,
    raw: out.raw,
    parsed: {
      ...out.parsed,
      status: "ERROR",
      message: out.parsed?.message ?? "Cashfree beneficiary create failed",
    },
  };
}

export async function cashfreePayoutCreateTransfer(
  clientId: string,
  clientSecret: string,
  env: CashfreePayoutEnv,
  input: PayoutCreateInput
) {
  const baseUrl = PAYOUT_BASE_URLS[env] ?? PAYOUT_BASE_URLS.test;

  const isUpi = Boolean(input.upiId?.trim());
  const beneficiarySeed = isUpi
    ? input.upiId!.trim()
    : `${input.accountNumber ?? ""}_${input.ifsc ?? ""}`;

  const beneficiaryId = cleanId(`BENE_${beneficiarySeed}`, 50);

  const bene = await createBeneficiaryIfNeeded(clientId, clientSecret, env, beneficiaryId, input);
  if (!bene.ok) {
    return { raw: bene.raw, parsed: flattenV2Response(bene.parsed) };
  }

  const transferId = cleanId(
    input.transferId ?? input.referenceId ?? `RKPAY_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );

  const body: any = {
    transfer_id: transferId,
    transfer_amount: Number(input.amount),
    transfer_currency: "INR",
    transfer_mode: isUpi ? "upi" : "banktransfer",
    transfer_remarks: (input.remark ?? "RasoKart payout").replace(/[^A-Za-z0-9 ]/g, " ").slice(0, 70),
    beneficiary_details: {
      beneficiary_id: beneficiaryId,
    },
  };

  const res = await fetch(`${baseUrl}/transfers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-version": "2024-01-01",
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
    },
    body: JSON.stringify(body),
  });

  const { raw, parsed } = await readJson(res);
  return { raw, parsed: flattenV2Response(parsed) };
}

export async function cashfreePayoutGetTransferStatus(
  clientId: string,
  clientSecret: string,
  env: CashfreePayoutEnv,
  referenceId: string
) {
  const baseUrl = PAYOUT_BASE_URLS[env] ?? PAYOUT_BASE_URLS.test;
  const url = new URL(`${baseUrl}/transfers`);
  url.searchParams.set("transfer_id", referenceId);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-api-version": "2024-01-01",
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
    },
  });

  const { raw, parsed } = await readJson(res);
  return { raw, parsed: flattenV2Response(parsed) };
}
