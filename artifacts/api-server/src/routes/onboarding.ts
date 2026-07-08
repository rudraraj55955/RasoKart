import { Router } from "express";
import { db, secureIdSettingsTable, merchantOnboardingSessionsTable, merchantKycDataTable, merchantsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { encryptValue, safeDecrypt } from "../helpers/encryptionHelper";
import { hashIdentifier } from "../helpers/otp";
import {
  loadSecureIdConfig,
  checkDataAvailability,
  createSecureIdSession,
  exchangeAuthCode,
  fetchUserData,
  verifyPan,
  verifyGst,
  verifyCin,
  verifyBankAccount,
} from "../helpers/secureidProvider";
import crypto from "crypto";

const router = Router();
router.use(requireAuth);

function merchantOnly(req: any, res: any, next: any) {
  if (!req.user || req.user.role !== "merchant" || !req.user.merchantId) {
    return res.status(403).json({ error: "Merchant access required" });
  }
  next();
}

function maskAccount(acct: string): string {
  if (acct.length <= 4) return "****";
  return "*".repeat(Math.max(acct.length - 4, 4)) + acct.slice(-4);
}
function maskGstin(g: string): string {
  if (!g || g.length < 6) return g;
  return g.slice(0, 2) + "****" + g.slice(-4);
}

// GET /api/onboarding/status
router.get("/status", merchantOnly, async (req, res, next) => {
  try {
    const merchantId: number = (req as any).user.merchantId;
    const [settings] = await db.select({ onboardingEnabled: secureIdSettingsTable.onboardingEnabled })
      .from(secureIdSettingsTable).where(eq(secureIdSettingsTable.id, 1)).limit(1);

    const [session] = await db.select({
      id: merchantOnboardingSessionsTable.id,
      verificationId: merchantOnboardingSessionsTable.verificationId,
      status: merchantOnboardingSessionsTable.status,
      consentStatus: merchantOnboardingSessionsTable.consentStatus,
      dataAvailable: merchantOnboardingSessionsTable.dataAvailable,
      mobileLast4: merchantOnboardingSessionsTable.mobileLast4,
      createdAt: merchantOnboardingSessionsTable.createdAt,
      updatedAt: merchantOnboardingSessionsTable.updatedAt,
    }).from(merchantOnboardingSessionsTable)
      .where(eq(merchantOnboardingSessionsTable.merchantId, merchantId))
      .orderBy(desc(merchantOnboardingSessionsTable.createdAt))
      .limit(1);

    const [kyc] = await db.select({
      fullName: merchantKycDataTable.fullName,
      panMasked: merchantKycDataTable.panMasked,
      aadhaarLast4: merchantKycDataTable.aadhaarLast4,
      businessName: merchantKycDataTable.businessName,
      gstinMasked: merchantKycDataTable.gstinMasked,
      bankAccountMasked: merchantKycDataTable.bankAccountMasked,
      bankIfsc: merchantKycDataTable.bankIfsc,
      bankName: merchantKycDataTable.bankName,
      city: merchantKycDataTable.city,
      stateName: merchantKycDataTable.stateName,
      panStatus: merchantKycDataTable.panStatus,
      gstStatus: merchantKycDataTable.gstStatus,
      cinStatus: merchantKycDataTable.cinStatus,
      bankStatus: merchantKycDataTable.bankStatus,
      riskScore: merchantKycDataTable.riskScore,
      mismatchFlags: merchantKycDataTable.mismatchFlags,
      adminDecision: merchantKycDataTable.adminDecision,
      rejectionReason: merchantKycDataTable.rejectionReason,
    }).from(merchantKycDataTable)
      .where(eq(merchantKycDataTable.merchantId, merchantId))
      .limit(1);

    res.json({
      onboardingEnabled: settings?.onboardingEnabled ?? false,
      session: session ?? null,
      kyc: kyc ?? null,
    });
  } catch (err) { next(err); }
});

// POST /api/onboarding/initiate
router.post("/initiate", merchantOnly, async (req, res, next) => {
  try {
    const merchantId: number = (req as any).user.merchantId;
    const { mobile } = req.body as { mobile?: string };
    if (!mobile || typeof mobile !== "string") {
      res.status(400).json({ error: "mobile is required" }); return;
    }
    const digits = mobile.replace(/\D/g, "");
    if (digits.length < 10) {
      res.status(400).json({ error: "Enter a valid 10-digit mobile number" }); return;
    }

    const cfg = await loadSecureIdConfig();
    if (!cfg) {
      res.status(503).json({ error: "Secure onboarding is not configured. Contact support." }); return;
    }

    const [settings] = await db.select({ onboardingEnabled: secureIdSettingsTable.onboardingEnabled })
      .from(secureIdSettingsTable).where(eq(secureIdSettingsTable.id, 1)).limit(1);
    if (!settings?.onboardingEnabled) {
      res.status(503).json({ error: "Secure onboarding is currently unavailable. Contact support." }); return;
    }

    const mobileHash = hashIdentifier(digits);
    const verificationId = crypto.randomUUID();
    const state = crypto.randomBytes(16).toString("hex");

    const dataResult = await checkDataAvailability(cfg, digits);
    const session = await createSecureIdSession(cfg, digits, state);
    if (!session) {
      res.status(502).json({ error: "Unable to start secure onboarding. Please try again." }); return;
    }

    const sessionEnc = encryptValue(session.sessionId);
    await db.insert(merchantOnboardingSessionsTable).values({
      merchantId,
      mobileLast4: digits.slice(-4),
      mobileHash,
      verificationId,
      sessionIdEncrypted: sessionEnc.encrypted,
      sessionIdIv: sessionEnc.iv,
      sessionIdTag: sessionEnc.tag,
      status: "AWAITING_CONSENT",
      consentStatus: "PENDING",
      dataAvailable: dataResult.available,
      expiresAt: session.expiresAt,
    });

    req.log.info({ merchantId, verificationId, dataAvailable: dataResult.available }, "onboarding_session_initiated");

    res.json({
      verificationId,
      sessionToken: session.sessionId,
      dataAvailable: dataResult.available,
      mode: cfg.mode === "live" ? "production" : "sandbox",
      expiresAt: session.expiresAt,
    });
  } catch (err) { next(err); }
});

// POST /api/onboarding/consent — called after SDK success
router.post("/consent", merchantOnly, async (req, res, next) => {
  try {
    const merchantId: number = (req as any).user.merchantId;
    const { verificationId, authCode } = req.body as { verificationId?: string; authCode?: string };
    if (!verificationId || !authCode) {
      res.status(400).json({ error: "verificationId and authCode are required" }); return;
    }

    const [sessionRow] = await db.select().from(merchantOnboardingSessionsTable)
      .where(and(
        eq(merchantOnboardingSessionsTable.verificationId, verificationId),
        eq(merchantOnboardingSessionsTable.merchantId, merchantId),
      )).limit(1);

    if (!sessionRow) {
      res.status(404).json({ error: "Session not found" }); return;
    }
    if (sessionRow.status !== "AWAITING_CONSENT") {
      res.status(409).json({ error: "Session is not awaiting consent" }); return;
    }
    if (sessionRow.expiresAt && sessionRow.expiresAt < new Date()) {
      res.status(410).json({ error: "Session has expired. Please restart onboarding." }); return;
    }

    const sessionId = safeDecrypt(sessionRow.sessionIdEncrypted, sessionRow.sessionIdIv, sessionRow.sessionIdTag);
    if (!sessionId) {
      res.status(500).json({ error: "Session data unavailable. Please restart onboarding." }); return;
    }

    const cfg = await loadSecureIdConfig();
    if (!cfg) {
      res.status(503).json({ error: "Onboarding provider not available" }); return;
    }

    const authEnc = encryptValue(authCode);
    await db.update(merchantOnboardingSessionsTable).set({
      authCodeEncrypted: authEnc.encrypted, authCodeIv: authEnc.iv, authCodeTag: authEnc.tag,
      status: "CONSENTED", consentStatus: "GIVEN",
    }).where(eq(merchantOnboardingSessionsTable.id, sessionRow.id));

    const accessToken = await exchangeAuthCode(cfg, authCode, sessionId);
    if (!accessToken) {
      await db.update(merchantOnboardingSessionsTable).set({ status: "AWAITING_CONSENT", consentStatus: "DENIED" })
        .where(eq(merchantOnboardingSessionsTable.id, sessionRow.id));
      res.status(502).json({ error: "Consent could not be completed. Please try again." }); return;
    }

    const atEnc = encryptValue(accessToken);
    await db.update(merchantOnboardingSessionsTable).set({
      accessTokenEncrypted: atEnc.encrypted, accessTokenIv: atEnc.iv, accessTokenTag: atEnc.tag,
      authCodeEncrypted: null, authCodeIv: null, authCodeTag: null,
      status: "DATA_FETCHED",
    }).where(eq(merchantOnboardingSessionsTable.id, sessionRow.id));

    const userData = await fetchUserData(cfg, accessToken);

    const mismatchFlags: string[] = [];
    const [merchant] = await db.select({ businessName: merchantsTable.businessName })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, merchantId)).limit(1);
    if (merchant?.businessName && userData.businessName && !userData.businessName.toLowerCase().includes(merchant.businessName.toLowerCase())) {
      mismatchFlags.push("business_name_mismatch");
    }

    const kycPayload = {
      merchantId,
      onboardingSessionId: sessionRow.id,
      fullName: userData.fullName ?? null,
      dob: userData.dob ?? null,
      gender: userData.gender ?? null,
      email: userData.email ?? null,
      panMasked: userData.panMasked ?? null,
      aadhaarLast4: userData.aadhaarLast4 ?? null,
      addressLine1: userData.addressLine1 ?? null,
      addressLine2: userData.addressLine2 ?? null,
      city: userData.city ?? null,
      stateName: userData.state ?? null,
      pincode: userData.pincode ?? null,
      businessName: userData.businessName ?? null,
      mismatchFlags: mismatchFlags.length ? mismatchFlags : null,
      riskScore: mismatchFlags.length > 0 ? 40 : 0,
    };

    await db.insert(merchantKycDataTable).values(kycPayload as any)
      .onConflictDoUpdate({ target: merchantKycDataTable.merchantId, set: kycPayload as any });

    await db.update(merchantOnboardingSessionsTable).set({
      accessTokenEncrypted: null, accessTokenIv: null, accessTokenTag: null,
      status: "KYC_PENDING",
    }).where(eq(merchantOnboardingSessionsTable.id, sessionRow.id));

    req.log.info({ merchantId, verificationId }, "onboarding_consent_completed");

    res.json({
      status: "KYC_PENDING",
      kycData: {
        fullName: userData.fullName,
        panMasked: userData.panMasked,
        aadhaarLast4: userData.aadhaarLast4 ? `****${userData.aadhaarLast4}` : null,
        businessName: userData.businessName,
        city: userData.city,
        state: userData.state,
        mismatchFlags,
      },
    });
  } catch (err) { next(err); }
});

// POST /api/onboarding/verify — run individual verification
router.post("/verify", merchantOnly, async (req, res, next) => {
  try {
    const merchantId: number = (req as any).user.merchantId;
    const { type, verificationId, pan, name, gstin, cin, accountNumber, ifsc } = req.body as Record<string, string>;

    if (!type || !verificationId) {
      res.status(400).json({ error: "type and verificationId are required" }); return;
    }

    const [sessionRow] = await db.select({ id: merchantOnboardingSessionsTable.id })
      .from(merchantOnboardingSessionsTable)
      .where(and(eq(merchantOnboardingSessionsTable.verificationId, verificationId), eq(merchantOnboardingSessionsTable.merchantId, merchantId)))
      .limit(1);
    if (!sessionRow) { res.status(404).json({ error: "Session not found" }); return; }

    const cfg = await loadSecureIdConfig();
    if (!cfg) { res.status(503).json({ error: "Verification provider not available" }); return; }

    const [settings] = await db.select().from(secureIdSettingsTable).where(eq(secureIdSettingsTable.id, 1)).limit(1);

    let result;
    let kycUpdate: Record<string, unknown> = {};

    switch (type) {
      case "PAN":
        if (!settings?.panEnabled) { res.json({ status: "SKIPPED" }); return; }
        if (!pan || !name) { res.status(400).json({ error: "pan and name required for PAN verification" }); return; }
        result = await verifyPan(cfg, pan, name, merchantId, sessionRow.id);
        kycUpdate = { panStatus: result.status, panMasked: `${pan.slice(0, 2)}${"*".repeat(pan.length - 4)}${pan.slice(-2)}` };
        break;
      case "GST":
        if (!settings?.gstEnabled) { res.json({ status: "SKIPPED" }); return; }
        if (!gstin) { res.status(400).json({ error: "gstin required" }); return; }
        result = await verifyGst(cfg, gstin, merchantId, sessionRow.id);
        kycUpdate = { gstStatus: result.status, gstinMasked: maskGstin(gstin) };
        break;
      case "CIN":
        if (!settings?.cinEnabled) { res.json({ status: "SKIPPED" }); return; }
        if (!cin) { res.status(400).json({ error: "cin required" }); return; }
        result = await verifyCin(cfg, cin, merchantId, sessionRow.id);
        kycUpdate = { cinStatus: result.status, cinNumber: cin };
        break;
      case "BANK":
        if (!settings?.bankEnabled) { res.json({ status: "SKIPPED" }); return; }
        if (!accountNumber || !ifsc) { res.status(400).json({ error: "accountNumber and ifsc required" }); return; }
        result = await verifyBankAccount(cfg, accountNumber, ifsc, merchantId, sessionRow.id);
        kycUpdate = { bankStatus: result.status, bankAccountMasked: maskAccount(accountNumber), bankIfsc: ifsc };
        break;
      default:
        res.status(400).json({ error: "Invalid verification type" }); return;
    }

    if (Object.keys(kycUpdate).length > 0) {
      await db.update(merchantKycDataTable).set(kycUpdate as any)
        .where(eq(merchantKycDataTable.merchantId, merchantId));
    }

    req.log.info({ merchantId, type, status: result.status }, "onboarding_verification");
    res.json({ type, status: result.status });
  } catch (err) { next(err); }
});

// POST /api/onboarding/submit — submit for admin review
router.post("/submit", merchantOnly, async (req, res, next) => {
  try {
    const merchantId: number = (req as any).user.merchantId;
    const { verificationId, businessName, gstin, cin, bankAccountNumber, bankIfsc, additionalNotes } = req.body as Record<string, string>;

    const [sessionRow] = await db.select({ id: merchantOnboardingSessionsTable.id, status: merchantOnboardingSessionsTable.status })
      .from(merchantOnboardingSessionsTable)
      .where(and(eq(merchantOnboardingSessionsTable.verificationId, verificationId ?? ""), eq(merchantOnboardingSessionsTable.merchantId, merchantId)))
      .limit(1);

    if (!sessionRow) { res.status(404).json({ error: "Session not found" }); return; }
    if (sessionRow.status === "SUBMITTED" || sessionRow.status === "APPROVED") {
      res.status(409).json({ error: "Already submitted" }); return;
    }

    const updatePayload: Record<string, unknown> = { adminDecision: "PENDING" };
    if (businessName) updatePayload["businessName"] = businessName;
    if (gstin) updatePayload["gstinMasked"] = maskGstin(gstin);
    if (cin) updatePayload["cinNumber"] = cin;
    if (bankAccountNumber) updatePayload["bankAccountMasked"] = maskAccount(bankAccountNumber);
    if (bankIfsc) updatePayload["bankIfsc"] = bankIfsc;

    await db.update(merchantKycDataTable).set(updatePayload as any)
      .where(eq(merchantKycDataTable.merchantId, merchantId));

    await db.update(merchantOnboardingSessionsTable).set({ status: "SUBMITTED" })
      .where(eq(merchantOnboardingSessionsTable.id, sessionRow.id));

    req.log.info({ merchantId, verificationId }, "onboarding_submitted");
    res.json({ status: "SUBMITTED", message: "Your application has been submitted for review." });
  } catch (err) { next(err); }
});

// POST /api/onboarding/consent-denied — SDK failure callback
router.post("/consent-denied", merchantOnly, async (req, res, next) => {
  try {
    const merchantId: number = (req as any).user.merchantId;
    const { verificationId } = req.body as { verificationId?: string };
    if (!verificationId) { res.status(400).json({ error: "verificationId required" }); return; }
    await db.update(merchantOnboardingSessionsTable)
      .set({ consentStatus: "DENIED", status: "AWAITING_CONSENT" })
      .where(and(eq(merchantOnboardingSessionsTable.verificationId, verificationId), eq(merchantOnboardingSessionsTable.merchantId, merchantId)));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
