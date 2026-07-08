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
function maskPan(pan: string): string {
  if (!pan || pan.length < 4) return pan;
  return pan.slice(0, 2) + "*".repeat(pan.length - 4) + pan.slice(-2);
}

// Approval eligibility: PAN + Aadhaar + Bank must all be VERIFIED
function isEligibleForApproval(kyc: { panStatus?: string | null; aadhaarStatus?: string | null; bankStatus?: string | null }): boolean {
  return kyc.panStatus === "VERIFIED" && kyc.aadhaarStatus === "VERIFIED" && kyc.bankStatus === "VERIFIED";
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
      udyamNumber: merchantKycDataTable.udyamNumber,
      bankAccountMasked: merchantKycDataTable.bankAccountMasked,
      bankIfsc: merchantKycDataTable.bankIfsc,
      bankName: merchantKycDataTable.bankName,
      bankHolderName: merchantKycDataTable.bankHolderName,
      city: merchantKycDataTable.city,
      stateName: merchantKycDataTable.stateName,
      panStatus: merchantKycDataTable.panStatus,
      aadhaarStatus: merchantKycDataTable.aadhaarStatus,
      gstStatus: merchantKycDataTable.gstStatus,
      cinStatus: merchantKycDataTable.cinStatus,
      udyamStatus: merchantKycDataTable.udyamStatus,
      bankStatus: merchantKycDataTable.bankStatus,
      riskScore: merchantKycDataTable.riskScore,
      mismatchFlags: merchantKycDataTable.mismatchFlags,
      adminDecision: merchantKycDataTable.adminDecision,
      rejectionReason: merchantKycDataTable.rejectionReason,
    }).from(merchantKycDataTable)
      .where(eq(merchantKycDataTable.merchantId, merchantId))
      .limit(1);

    const approvalEligible = kyc ? isEligibleForApproval(kyc) : false;

    res.json({
      onboardingEnabled: settings?.onboardingEnabled ?? false,
      session: session ?? null,
      kyc: kyc ?? null,
      approvalEligible,
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
      .where(and(eq(merchantOnboardingSessionsTable.verificationId, verificationId), eq(merchantOnboardingSessionsTable.merchantId, merchantId)))
      .limit(1);

    if (!sessionRow) { res.status(404).json({ error: "Session not found" }); return; }
    if (sessionRow.status !== "AWAITING_CONSENT") { res.status(409).json({ error: "Session is not awaiting consent" }); return; }
    if (sessionRow.expiresAt && sessionRow.expiresAt < new Date()) {
      res.status(410).json({ error: "Session has expired. Please restart onboarding." }); return;
    }

    const sessionId = safeDecrypt(sessionRow.sessionIdEncrypted, sessionRow.sessionIdIv, sessionRow.sessionIdTag);
    if (!sessionId) { res.status(500).json({ error: "Session data unavailable. Please restart." }); return; }

    const cfg = await loadSecureIdConfig();
    if (!cfg) { res.status(503).json({ error: "Onboarding provider not available" }); return; }

    // Encrypt auth code briefly
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

    const userData = await fetchUserData(cfg, accessToken);

    // Clear tokens immediately after use
    await db.update(merchantOnboardingSessionsTable).set({
      authCodeEncrypted: null, authCodeIv: null, authCodeTag: null,
      accessTokenEncrypted: null, accessTokenIv: null, accessTokenTag: null,
      status: "KYC_PENDING",
    }).where(eq(merchantOnboardingSessionsTable.id, sessionRow.id));

    // Aadhaar is VERIFIED if SDK returned aadhaarLast4 (SDK performed Aadhaar-based auth)
    const aadhaarStatus = userData.aadhaarLast4 ? "VERIFIED" : "PENDING";

    const mismatchFlags: string[] = [];
    const [merchant] = await db.select({ businessName: merchantsTable.businessName })
      .from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
    if (merchant?.businessName && userData.businessName &&
        !userData.businessName.toLowerCase().includes(merchant.businessName.toLowerCase())) {
      mismatchFlags.push("business_name_mismatch");
    }
    // Info flag: no GSTIN provided (not an error)
    if (!userData.businessName) mismatchFlags.push("gstin_cin_not_provided");

    const kycPayload = {
      merchantId,
      onboardingSessionId: sessionRow.id,
      fullName: userData.fullName ?? null,
      dob: userData.dob ?? null,
      gender: userData.gender ?? null,
      email: userData.email ?? null,
      panMasked: userData.panMasked ?? null,
      aadhaarLast4: userData.aadhaarLast4 ?? null,
      aadhaarStatus,
      addressLine1: userData.addressLine1 ?? null,
      addressLine2: userData.addressLine2 ?? null,
      city: userData.city ?? null,
      stateName: userData.state ?? null,
      pincode: userData.pincode ?? null,
      businessName: userData.businessName ?? null,
      gstStatus: "SKIPPED",
      cinStatus: "SKIPPED",
      udyamStatus: "SKIPPED",
      mismatchFlags: mismatchFlags.length ? mismatchFlags : null,
      riskScore: mismatchFlags.filter((f) => f !== "gstin_cin_not_provided").length > 0 ? 40 : 0,
    };

    await db.insert(merchantKycDataTable).values(kycPayload as any)
      .onConflictDoUpdate({ target: merchantKycDataTable.merchantId, set: kycPayload as any });

    req.log.info({ merchantId, verificationId, aadhaarStatus }, "onboarding_consent_completed");

    res.json({
      status: "KYC_PENDING",
      kycData: {
        fullName: userData.fullName,
        panMasked: userData.panMasked,
        aadhaarLast4: userData.aadhaarLast4 ? `****${userData.aadhaarLast4}` : null,
        aadhaarStatus,
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
    const {
      type, verificationId,
      pan, name,
      aadhaarLast4Input,
      gstin, cin,
      udyamNumber,
      accountNumber, ifsc, holderName,
    } = req.body as Record<string, string>;

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

    let kycUpdate: Record<string, unknown> = {};
    let verifyStatus: string;

    switch (type) {
      case "PAN": {
        if (!pan || !name) { res.status(400).json({ error: "pan and name required" }); return; }
        const result = await verifyPan(cfg, pan.toUpperCase(), name, merchantId, sessionRow.id);
        kycUpdate = { panStatus: result.status, panMasked: maskPan(pan.toUpperCase()), fullName: name };
        verifyStatus = result.status;
        break;
      }
      case "AADHAAR": {
        // For Aadhaar: we store only last 4 digits (never full number).
        // If SDK already verified, this path handles manual re-confirmation.
        // Store last 4 only; set status to PENDING (admin reviews uploaded document).
        const last4 = aadhaarLast4Input?.replace(/\D/g, "").slice(-4);
        if (!last4 || last4.length !== 4) { res.status(400).json({ error: "Last 4 digits of Aadhaar required" }); return; }
        kycUpdate = { aadhaarLast4: last4, aadhaarStatus: "PENDING" };
        verifyStatus = "PENDING";
        req.log.info({ merchantId, type: "AADHAAR", note: "manual_last4_provided" }, "onboarding_aadhaar_manual");
        break;
      }
      case "GST": {
        if (!settings?.gstEnabled) { kycUpdate = { gstStatus: "SKIPPED" }; verifyStatus = "SKIPPED"; break; }
        if (!gstin) { res.status(400).json({ error: "gstin required" }); return; }
        const result = await verifyGst(cfg, gstin.toUpperCase(), merchantId, sessionRow.id);
        kycUpdate = { gstStatus: result.status, gstinMasked: maskGstin(gstin.toUpperCase()) };
        verifyStatus = result.status;
        break;
      }
      case "CIN": {
        if (!settings?.cinEnabled) { kycUpdate = { cinStatus: "SKIPPED" }; verifyStatus = "SKIPPED"; break; }
        if (!cin) { res.status(400).json({ error: "cin required" }); return; }
        const result = await verifyCin(cfg, cin.toUpperCase(), merchantId, sessionRow.id);
        kycUpdate = { cinStatus: result.status, cinNumber: cin.toUpperCase() };
        verifyStatus = result.status;
        break;
      }
      case "UDYAM": {
        if (!udyamNumber) { res.status(400).json({ error: "udyamNumber required" }); return; }
        // Udyam is always optional; store number and mark as PENDING for admin review
        kycUpdate = { udyamNumber: udyamNumber.toUpperCase(), udyamStatus: "PENDING" };
        verifyStatus = "PENDING";
        req.log.info({ merchantId, udyamNumber: udyamNumber.slice(0, 8) + "***" }, "onboarding_udyam_provided");
        break;
      }
      case "BANK": {
        if (!settings?.bankEnabled) { kycUpdate = { bankStatus: "SKIPPED" }; verifyStatus = "SKIPPED"; break; }
        if (!accountNumber || !ifsc) { res.status(400).json({ error: "accountNumber and ifsc required" }); return; }
        const result = await verifyBankAccount(cfg, accountNumber, ifsc.toUpperCase(), merchantId, sessionRow.id);
        kycUpdate = {
          bankStatus: result.status,
          bankAccountMasked: maskAccount(accountNumber),
          bankIfsc: ifsc.toUpperCase(),
          bankHolderName: holderName ?? null,
        };
        verifyStatus = result.status;
        break;
      }
      default:
        res.status(400).json({ error: "Invalid verification type" }); return;
    }

    if (Object.keys(kycUpdate).length > 0) {
      await db.update(merchantKycDataTable).set(kycUpdate as any)
        .where(eq(merchantKycDataTable.merchantId, merchantId));
    }

    req.log.info({ merchantId, type, status: verifyStatus }, "onboarding_verification");
    res.json({ type, status: verifyStatus });
  } catch (err) { next(err); }
});

// POST /api/onboarding/submit — submit for admin review
router.post("/submit", merchantOnly, async (req, res, next) => {
  try {
    const merchantId: number = (req as any).user.merchantId;
    const { verificationId, businessName, gstin, cin, udyamNumber } = req.body as Record<string, string>;

    const [sessionRow] = await db.select({ id: merchantOnboardingSessionsTable.id, status: merchantOnboardingSessionsTable.status })
      .from(merchantOnboardingSessionsTable)
      .where(and(eq(merchantOnboardingSessionsTable.verificationId, verificationId ?? ""), eq(merchantOnboardingSessionsTable.merchantId, merchantId)))
      .limit(1);

    if (!sessionRow) { res.status(404).json({ error: "Session not found" }); return; }
    if (sessionRow.status === "SUBMITTED" || sessionRow.status === "APPROVED") {
      res.status(409).json({ error: "Already submitted" }); return;
    }

    // Validate mandatory checks
    const [kyc] = await db.select({
      panStatus: merchantKycDataTable.panStatus,
      aadhaarStatus: merchantKycDataTable.aadhaarStatus,
      bankStatus: merchantKycDataTable.bankStatus,
    }).from(merchantKycDataTable).where(eq(merchantKycDataTable.merchantId, merchantId)).limit(1);

    if (!kyc) { res.status(400).json({ error: "KYC data not found. Please complete the verification steps." }); return; }

    const missing: string[] = [];
    if (kyc.panStatus !== "VERIFIED") missing.push("PAN verification");
    if (kyc.bankStatus !== "VERIFIED") missing.push("Bank account verification");
    // Aadhaar: VERIFIED or PENDING (pending = manual upload, admin reviews)
    if (!kyc.aadhaarStatus || kyc.aadhaarStatus === "FAILED") missing.push("Aadhaar verification");

    if (missing.length > 0) {
      res.status(400).json({
        error: `Please complete mandatory verification: ${missing.join(", ")}`,
        missing,
      }); return;
    }

    // Optional fields update
    const updatePayload: Record<string, unknown> = { adminDecision: "PENDING" };
    if (businessName) updatePayload["businessName"] = businessName;
    if (gstin) updatePayload["gstinMasked"] = maskGstin(gstin.toUpperCase());
    if (cin) updatePayload["cinNumber"] = cin.toUpperCase();
    if (udyamNumber) updatePayload["udyamNumber"] = udyamNumber.toUpperCase();

    await db.update(merchantKycDataTable).set(updatePayload as any)
      .where(eq(merchantKycDataTable.merchantId, merchantId));

    await db.update(merchantOnboardingSessionsTable).set({ status: "SUBMITTED" })
      .where(eq(merchantOnboardingSessionsTable.id, sessionRow.id));

    req.log.info({ merchantId, verificationId }, "onboarding_submitted");
    res.json({ status: "SUBMITTED", message: "Your application has been submitted for review." });
  } catch (err) { next(err); }
});

// POST /api/onboarding/consent-denied
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
