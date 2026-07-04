import { Router } from "express";
import { db, payoutBeneficiariesTable, merchantsTable, systemConfigTable, SYSTEM_CONFIG_KEYS } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { decryptSecret } from "../helpers/cryptoUtils";
import {
  beneficiaryKeyFor,
  resolveOrCreateBeneficiary,
  ensureBeneficiaryProviderRegistered,
  beneficiaryUsedInSuccessfulPayout,
  mapBeneficiary,
} from "../helpers/payoutBeneficiaryStore";
import type { CashfreePayoutEnv } from "../helpers/cashfreePayout";

const router = Router();
router.use(requireAuth);

async function getPayoutConfig() {
  const keys = [
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_ID,
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_SECRET,
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENV,
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENABLED,
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
    env: (cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENV) ?? "test") as CashfreePayoutEnv,
    enabled: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENABLED) === "true",
    providerConfig: {
      baseUrl: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_BASE_URL) ?? "",
      apiVersion: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_API_VERSION) ?? "",
    },
  };
}

function parseDestinationInput(body: any) {
  const payoutMode = body.payoutMode ?? body.mode ?? "IMPS";
  const bankAccount = body.accountNumber ?? body.bankAccount ?? body.account_number ?? null;
  const bankName = body.bankName ?? body.bank_name ?? null;
  const ifscCode = body.ifscCode ?? body.ifsc_code ?? null;
  const accountHolder = body.accountHolderName ?? body.accountHolder ?? body.account_holder_name ?? null;
  const upiId = body.upiId ?? body.upi_id ?? null;
  const label = body.label ?? null;
  return { payoutMode, bankAccount, bankName, ifscCode, accountHolder, upiId, label };
}

function validateDestination(input: ReturnType<typeof parseDestinationInput>): string | null {
  if (!["IMPS", "NEFT", "RTGS", "UPI"].includes(input.payoutMode)) {
    return "payoutMode must be one of IMPS, NEFT, RTGS, UPI";
  }
  if (input.payoutMode === "UPI") {
    if (!input.upiId?.trim()) return "upiId required for UPI mode";
  } else {
    if (!input.bankAccount?.trim() || !input.bankName?.trim() || !input.ifscCode?.trim() || !input.accountHolder?.trim()) {
      return "accountNumber, bankName, ifscCode and accountHolderName are required for bank transfer";
    }
  }
  return null;
}

// GET /api/payout-beneficiaries — merchant sees own, admin sees all (optionally filtered)
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const isAdmin = user.role === "admin";
  const { merchantId } = req.query as Record<string, string>;

  const conditions = [];
  if (!isAdmin) {
    conditions.push(eq(payoutBeneficiariesTable.merchantId, user.merchantId!));
  } else if (merchantId) {
    conditions.push(eq(payoutBeneficiariesTable.merchantId, parseInt(merchantId)));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      beneficiary: payoutBeneficiariesTable,
      merchantName: merchantsTable.businessName,
    })
    .from(payoutBeneficiariesTable)
    .leftJoin(merchantsTable, eq(payoutBeneficiariesTable.merchantId, merchantsTable.id))
    .where(where)
    .orderBy(desc(payoutBeneficiariesTable.createdAt));

  const data = await Promise.all(
    rows.map(async r => {
      const used = await beneficiaryUsedInSuccessfulPayout(r.beneficiary.id);
      return mapBeneficiary(r.beneficiary, used, isAdmin ? r.merchantName : null);
    })
  );

  res.json({ data });
});

// POST /api/payout-beneficiaries — merchant saves a new beneficiary
router.post("/", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "merchant") {
    res.status(403).json({ error: "Only merchants can save beneficiaries" });
    return;
  }

  const input = parseDestinationInput(req.body);
  const validationError = validateDestination(input);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const cfg = await getPayoutConfig();
  const beneficiaryRow = await resolveOrCreateBeneficiary(user.merchantId!, cfg.env, input);

  if (cfg.enabled && cfg.clientId && cfg.clientSecret) {
    await ensureBeneficiaryProviderRegistered(req, beneficiaryRow, cfg.env, cfg.clientId, cfg.clientSecret, null, false, undefined, cfg.providerConfig);
  }

  const [fresh] = await db.select().from(payoutBeneficiariesTable).where(eq(payoutBeneficiariesTable.id, beneficiaryRow.id)).limit(1);
  const used = await beneficiaryUsedInSuccessfulPayout(fresh!.id);
  res.status(201).json(mapBeneficiary(fresh!, used));
});

// PATCH /api/payout-beneficiaries/:id — edit, only if never used in a successful payout
router.patch("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params["id"] as string);

  const [existing] = await db.select().from(payoutBeneficiariesTable).where(eq(payoutBeneficiariesTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Beneficiary not found" });
    return;
  }
  if (user.role !== "admin" && existing.merchantId !== user.merchantId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const used = await beneficiaryUsedInSuccessfulPayout(id);
  if (used) {
    res.status(409).json({
      error: "This beneficiary has already been used in a successful payout and cannot be edited. Save a new beneficiary instead.",
    });
    return;
  }

  const input = parseDestinationInput(req.body);
  const validationError = validateDestination(input);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const newKey = beneficiaryKeyFor(input);
  const [updated] = await db
    .update(payoutBeneficiariesTable)
    .set({
      label: input.label ?? existing.label,
      payoutMode: input.payoutMode,
      bankAccount: input.bankAccount ?? null,
      bankName: input.bankName ?? null,
      ifscCode: input.ifscCode ?? null,
      accountHolder: input.accountHolder ?? null,
      upiId: input.payoutMode === "UPI" ? (input.upiId ?? null) : null,
      beneficiaryKey: newKey,
      // Destination may have changed — force re-registration with the provider.
      providerBeneficiaryId: null,
      providerStatus: "not_created",
      lastProviderError: null,
    })
    .where(eq(payoutBeneficiariesTable.id, id))
    .returning();

  const cfg = await getPayoutConfig();
  if (cfg.enabled && cfg.clientId && cfg.clientSecret) {
    await ensureBeneficiaryProviderRegistered(req, updated!, cfg.env, cfg.clientId, cfg.clientSecret, null, true, undefined, cfg.providerConfig);
  }

  const [fresh] = await db.select().from(payoutBeneficiariesTable).where(eq(payoutBeneficiariesTable.id, id)).limit(1);
  res.json(mapBeneficiary(fresh!, false));
});

// POST /api/payout-beneficiaries/:id/disable
router.post("/:id/disable", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params["id"] as string);
  const [existing] = await db.select().from(payoutBeneficiariesTable).where(eq(payoutBeneficiariesTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Beneficiary not found" });
    return;
  }
  if (user.role !== "admin" && existing.merchantId !== user.merchantId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const [updated] = await db
    .update(payoutBeneficiariesTable)
    .set({ localStatus: "disabled" })
    .where(eq(payoutBeneficiariesTable.id, id))
    .returning();
  const used = await beneficiaryUsedInSuccessfulPayout(id);
  res.json(mapBeneficiary(updated!, used));
});

// POST /api/payout-beneficiaries/:id/enable
router.post("/:id/enable", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params["id"] as string);
  const [existing] = await db.select().from(payoutBeneficiariesTable).where(eq(payoutBeneficiariesTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Beneficiary not found" });
    return;
  }
  if (user.role !== "admin" && existing.merchantId !== user.merchantId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const [updated] = await db
    .update(payoutBeneficiariesTable)
    .set({ localStatus: "active" })
    .where(eq(payoutBeneficiariesTable.id, id))
    .returning();
  const used = await beneficiaryUsedInSuccessfulPayout(id);
  res.json(mapBeneficiary(updated!, used));
});

// POST /api/payout-beneficiaries/:id/retry-provider — admin only
router.post("/:id/retry-provider", requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [existing] = await db.select().from(payoutBeneficiariesTable).where(eq(payoutBeneficiariesTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Beneficiary not found" });
    return;
  }

  const cfg = await getPayoutConfig();
  if (!cfg.enabled || !cfg.clientId || !cfg.clientSecret) {
    res.status(400).json({ error: "Payout provider is disabled or not configured" });
    return;
  }

  await ensureBeneficiaryProviderRegistered(req, existing, cfg.env, cfg.clientId, cfg.clientSecret, null, true, undefined, cfg.providerConfig);

  const [fresh] = await db.select().from(payoutBeneficiariesTable).where(eq(payoutBeneficiariesTable.id, id)).limit(1);
  const used = await beneficiaryUsedInSuccessfulPayout(id);
  res.json(mapBeneficiary(fresh!, used));
});

export default router;
