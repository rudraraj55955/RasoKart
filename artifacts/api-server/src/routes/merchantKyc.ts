import { Router } from "express";
import { db, merchantKycVerificationsTable, merchantsTable, auditLogsTable, usersTable, merchantAuthOtpsTable } from "@workspace/db";
import { eq, and, ne, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { DbRateLimitStore } from "../lib/rateLimitStore";
import { makeRateLimiter, safeIpKey } from "../helpers/makeRateLimiter";
import { encryptValue, safeDecrypt, hashValue } from "../helpers/encryptionHelper";
import { generateOtp, hashOtp, verifyOtpHash, hashIdentifier, isEmailIdentifier, OTP_EXPIRY_MS, OTP_MAX_ATTEMPTS } from "../helpers/otp";
import { sendMerchantOtpEmail } from "../helpers/merchantOtpEmail";
import { sendOtpSms } from "../helpers/sendOtpSms";
import {
  loadAutoKycConfig,
  verifyPanAuto,
  startAadhaarDigilockerSession,
  completeAadhaarDigilockerSession,
  computeNameMatchScore,
  maskPan,
  AutoKycConfig,
} from "../helpers/merchantAutoKycProvider";

const router = Router();
router.use(requireAuth);

function requireMerchant(req: any, res: any, next: any) {
  const user = req.user;
  if (!user || user.role !== "merchant" || !user.merchantId) {
    res.status(403).json({ error: "Merchant access required" });
    return;
  }
  next();
}
router.use(requireMerchant);

const attemptLimiter = makeRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  store: new DbRateLimitStore(),
  message: { error: "Too many KYC attempts. Please try again later." },
  keyGenerator: (req: any) => `merchant-kyc:${safeIpKey(req)}:${req.user?.merchantId ?? "anon"}`,
});

const otpLimiter = makeRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  store: new DbRateLimitStore(),
  message: { error: "Too many OTP requests. Please try again later." },
  keyGenerator: (req: any) => `merchant-kyc-otp:${safeIpKey(req)}:${req.user?.merchantId ?? "anon"}`,
});

function publicRow(row: any) {
  if (!row) {
    return {
      status: "PENDING",
      panVerified: false,
      aadhaarVerified: false,
      mobileVerified: false,
      emailVerified: false,
      nameMatchScore: null,
      failureReason: null,
    };
  }
  return {
    status: row.verificationStatus,
    panVerified: row.panVerified,
    panNumberMasked: row.panNumberMasked,
    aadhaarVerified: row.aadhaarVerified,
    aadhaarLast4: row.aadhaarLast4,
    mobileVerified: row.mobileVerified,
    emailVerified: row.emailVerified,
    nameMatchScore: row.nameMatchScore,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function getOrCreateRow(merchantId: number) {
  const [existing] = await db.select().from(merchantKycVerificationsTable).where(eq(merchantKycVerificationsTable.merchantId, merchantId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(merchantKycVerificationsTable).values({ merchantId, verificationStatus: "PENDING" }).returning();
  return created;
}

/**
 * Final auto-approval condition (single source of truth):
 * PAN verified + DigiLocker Aadhaar verified + name-match score pass +
 * mobile verified + email verified => merchant auto approved.
 * Called after every individual verification step completes so approval
 * fires the moment the last outstanding requirement is satisfied.
 */
async function evaluateFinalApproval(req: any, merchantId: number, cfg: AutoKycConfig) {
  const [row] = await db.select().from(merchantKycVerificationsTable).where(eq(merchantKycVerificationsTable.merchantId, merchantId)).limit(1);
  if (!row) return;
  if (["APPROVED", "REJECTED", "BLOCKED"].includes(row.verificationStatus)) return;

  const identityVerified = row.panVerified && row.aadhaarVerified;
  const nameMatchPassed = row.nameMatchScore != null && row.nameMatchScore >= cfg.minNameMatchScore;
  const contactVerified = row.mobileVerified && row.emailVerified;

  if (!identityVerified) return;

  if (!nameMatchPassed) {
    await db.update(merchantKycVerificationsTable).set({
      verificationStatus: "NAME_MISMATCH" as any,
      failureReason: "Name on PAN/Aadhaar does not sufficiently match the registered business owner name.",
      updatedAt: new Date(),
    }).where(eq(merchantKycVerificationsTable.merchantId, merchantId));
    return;
  }

  if (!contactVerified) {
    await db.update(merchantKycVerificationsTable).set({
      verificationStatus: "CONTACT_PENDING" as any,
      failureReason: null,
      updatedAt: new Date(),
    }).where(eq(merchantKycVerificationsTable.merchantId, merchantId));
    return;
  }

  if (!cfg.autoApproveEnabled) {
    await db.update(merchantKycVerificationsTable).set({
      verificationStatus: "MANUAL_REVIEW" as any,
      failureReason: null,
      updatedAt: new Date(),
    }).where(eq(merchantKycVerificationsTable.merchantId, merchantId));
    return;
  }

  await db.update(merchantKycVerificationsTable).set({
    verificationStatus: "APPROVED" as any,
    failureReason: null,
    updatedAt: new Date(),
  }).where(eq(merchantKycVerificationsTable.merchantId, merchantId));

  await db.update(merchantsTable).set({ status: "approved", verificationStatus: "approved", rejectionReason: null } as any).where(eq(merchantsTable.id, merchantId));
  const [merchantRow] = await db.select({ email: merchantsTable.email }).from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
  if (merchantRow) {
    await db.update(usersTable).set({ isActive: true }).where(eq(usersTable.email, merchantRow.email));
  }
  await db.insert(auditLogsTable).values({
    adminEmail: "auto-kyc@rasokart.com",
    action: "merchant_auto_kyc_approved",
    targetType: "merchant",
    targetId: merchantId,
    details: JSON.stringify({ nameMatchScore: row.nameMatchScore }),
    ipAddress: req.ip ?? null,
  } as any);
  req.log.info({ merchantId, nameMatchScore: row.nameMatchScore }, "merchant_auto_kyc_approved");
}

// GET /api/merchant-kyc/status
router.get("/status", async (req: any, res, next) => {
  try {
    const [row] = await db.select().from(merchantKycVerificationsTable).where(eq(merchantKycVerificationsTable.merchantId, req.user.merchantId)).limit(1);
    res.json(publicRow(row));
  } catch (err) { next(err); }
});

// POST /api/merchant-kyc/pan/verify — Cashfree Secure ID PAN API
router.post("/pan/verify", attemptLimiter, async (req: any, res, next) => {
  try {
    const merchantId = req.user.merchantId as number;
    const { panNumber } = req.body as Record<string, unknown>;
    if (!panNumber || typeof panNumber !== "string") {
      res.status(400).json({ error: "PAN number is required" });
      return;
    }
    const pan = panNumber.trim().toUpperCase();

    const cfg = await loadAutoKycConfig();
    if (!cfg || !cfg.panApiEnabled) {
      res.status(503).json({ error: "RasoKart KYC Verification is temporarily unavailable. Please try again later." });
      return;
    }

    const row = await getOrCreateRow(merchantId);
    if (row.verificationStatus === "APPROVED") {
      res.status(400).json({ error: "KYC is already approved for this account." });
      return;
    }

    const panHash = hashValue(pan);
    if (cfg.duplicateCheckEnabled) {
      const [dup] = await db
        .select({ merchantId: merchantKycVerificationsTable.merchantId })
        .from(merchantKycVerificationsTable)
        .where(and(eq(merchantKycVerificationsTable.panNumberHash, panHash), ne(merchantKycVerificationsTable.merchantId, merchantId)))
        .limit(1);
      if (dup) {
        res.status(409).json({ error: "This PAN is already linked to another merchant account." });
        return;
      }
    }

    const [merchant] = await db.select({ contactName: merchantsTable.contactName }).from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
    const result = await verifyPanAuto(cfg, pan, merchantId, merchant?.contactName ?? undefined);
    if (!result.ok) {
      await db.update(merchantKycVerificationsTable).set({
        verificationStatus: "PAN_FAILED" as any,
        failureReason: result.status === "INVALID" ? "PAN details could not be verified." : "Verification provider unavailable. Please try again.",
        updatedAt: new Date(),
      }).where(eq(merchantKycVerificationsTable.merchantId, merchantId));
      res.status(422).json({ error: result.status === "INVALID" ? "PAN details could not be verified." : "Verification provider unavailable. Please try again." });
      return;
    }

    const enc = result.requestId ? encryptValue(result.requestId) : null;
    await db.update(merchantKycVerificationsTable).set({
      panNumberMasked: maskPan(pan),
      panNumberHash: panHash,
      panName: result.registeredName ?? null,
      panType: result.panType ?? null,
      panVerified: true,
      panVerifiedAt: new Date(),
      panReferenceIdEncrypted: enc?.encrypted ?? null,
      panReferenceIdIv: enc?.iv ?? null,
      panReferenceIdTag: enc?.tag ?? null,
      verificationStatus: "PAN_VERIFIED" as any,
      failureReason: null,
      updatedAt: new Date(),
    }).where(eq(merchantKycVerificationsTable.merchantId, merchantId));

    req.log.info({ merchantId }, "merchant_kyc_pan_verified");
    res.json({ ok: true, panType: result.panType });
  } catch (err) { next(err); }
});

// POST /api/merchant-kyc/aadhaar/digilocker/start — Cashfree Secure ID DigiLocker session
router.post("/aadhaar/digilocker/start", attemptLimiter, async (req: any, res, next) => {
  try {
    const merchantId = req.user.merchantId as number;
    const cfg = await loadAutoKycConfig();
    if (!cfg || !cfg.aadhaarApiEnabled) {
      res.status(503).json({ error: "RasoKart KYC Verification is temporarily unavailable. Please try again later." });
      return;
    }

    const [row] = await db.select().from(merchantKycVerificationsTable).where(eq(merchantKycVerificationsTable.merchantId, merchantId)).limit(1);
    if (!row || !row.panVerified) {
      res.status(400).json({ error: "Please complete PAN verification first." });
      return;
    }

    const [merchant] = await db.select({ phone: merchantsTable.phone }).from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
    const result = await startAadhaarDigilockerSession(cfg, merchantId, merchant?.phone ?? "");
    if (!result.ok || !result.sessionId) {
      res.status(422).json({ error: "Could not start Aadhaar DigiLocker verification. Please try again." });
      return;
    }

    const enc = encryptValue(result.sessionId);
    await db.update(merchantKycVerificationsTable).set({
      aadhaarDigilockerSessionEncrypted: enc.encrypted,
      aadhaarDigilockerSessionIv: enc.iv,
      aadhaarDigilockerSessionTag: enc.tag,
      consentIp: req.ip ?? null,
      consentUserAgent: req.headers["user-agent"] ?? null,
      consentAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(merchantKycVerificationsTable.merchantId, merchantId));

    req.log.info({ merchantId }, "merchant_kyc_aadhaar_digilocker_session_started");
    res.json({ ok: true, sessionId: result.sessionId, mode: result.mode });
  } catch (err) { next(err); }
});

// POST /api/merchant-kyc/aadhaar/digilocker/complete
router.post("/aadhaar/digilocker/complete", attemptLimiter, async (req: any, res, next) => {
  try {
    const merchantId = req.user.merchantId as number;
    const { authCode } = req.body as Record<string, unknown>;
    const cfg = await loadAutoKycConfig();
    if (!cfg) {
      res.status(503).json({ error: "RasoKart KYC Verification is temporarily unavailable. Please try again later." });
      return;
    }

    const [row] = await db.select().from(merchantKycVerificationsTable).where(eq(merchantKycVerificationsTable.merchantId, merchantId)).limit(1);
    const sessionId = row ? safeDecrypt(row.aadhaarDigilockerSessionEncrypted, row.aadhaarDigilockerSessionIv, row.aadhaarDigilockerSessionTag) : null;
    if (!row || !sessionId) {
      res.status(400).json({ error: "Please start Aadhaar verification first." });
      return;
    }
    if (!authCode || typeof authCode !== "string") {
      res.status(400).json({ error: "authCode is required" });
      return;
    }

    const result = await completeAadhaarDigilockerSession(cfg, sessionId, authCode, merchantId);
    if (!result.ok) {
      await db.update(merchantKycVerificationsTable).set({
        verificationStatus: "AADHAAR_FAILED" as any,
        failureReason: "Aadhaar DigiLocker verification failed. Please try again.",
        updatedAt: new Date(),
      }).where(eq(merchantKycVerificationsTable.merchantId, merchantId));
      res.status(422).json({ error: "Aadhaar DigiLocker verification failed. Please try again." });
      return;
    }

    const [merchant] = await db.select({ contactName: merchantsTable.contactName }).from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
    const aadhaarName = result.name ?? "";
    const panName = row.panName ?? "";
    const merchantOwnerName = merchant?.contactName ?? "";

    const scorePanAadhaar = computeNameMatchScore(panName, aadhaarName);
    const scorePanOwner = computeNameMatchScore(panName, merchantOwnerName);
    const scoreAadhaarOwner = computeNameMatchScore(aadhaarName, merchantOwnerName);
    const finalScore = Math.min(scorePanAadhaar, scorePanOwner, scoreAadhaarOwner);

    await db.update(merchantKycVerificationsTable).set({
      aadhaarLast4: result.last4 ?? null,
      aadhaarName,
      aadhaarVerified: true,
      aadhaarVerifiedAt: new Date(),
      aadhaarDigilockerSessionEncrypted: null,
      aadhaarDigilockerSessionIv: null,
      aadhaarDigilockerSessionTag: null,
      nameMatchScore: finalScore,
      verificationStatus: "AADHAAR_VERIFIED" as any,
      failureReason: null,
      updatedAt: new Date(),
    }).where(eq(merchantKycVerificationsTable.merchantId, merchantId));

    await evaluateFinalApproval(req, merchantId, cfg);

    const [finalRow] = await db.select().from(merchantKycVerificationsTable).where(eq(merchantKycVerificationsTable.merchantId, merchantId)).limit(1);
    req.log.info({ merchantId, finalScore, status: finalRow?.verificationStatus }, "merchant_kyc_aadhaar_digilocker_completed");
    res.json({ ok: true, status: finalRow?.verificationStatus, nameMatchScore: finalScore });
  } catch (err) { next(err); }
});

async function requireIdentityStepsDone(req: any, res: any): Promise<any | null> {
  const merchantId = req.user.merchantId as number;
  const [row] = await db.select().from(merchantKycVerificationsTable).where(eq(merchantKycVerificationsTable.merchantId, merchantId)).limit(1);
  if (!row || !row.panVerified || !row.aadhaarVerified) {
    res.status(400).json({ error: "Please complete PAN and Aadhaar verification first." });
    return null;
  }
  return row;
}

// POST /api/merchant-kyc/mobile/verify/request
router.post("/mobile/verify/request", otpLimiter, async (req: any, res, next) => {
  try {
    const row = await requireIdentityStepsDone(req, res);
    if (!row) return;
    const merchantId = req.user.merchantId as number;
    const [merchant] = await db.select({ phone: merchantsTable.phone }).from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
    if (!merchant?.phone) {
      res.status(400).json({ error: "No mobile number on file for this merchant." });
      return;
    }

    const identifierHash = hashIdentifier(merchant.phone);
    const otp = generateOtp();
    const otpHash = await hashOtp(otp);
    await db.insert(merchantAuthOtpsTable).values({
      merchantId,
      identifierHash,
      otpHash,
      purpose: "KYC_MOBILE",
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
      attempts: 0,
      resendCount: 0,
      ipHash: null,
    });

    const smsResult = await sendOtpSms({ mobile: merchant.phone.replace(/\D/g, ""), otp, purpose: "KYC_MOBILE", merchantId }).catch((err: unknown) => {
      req.log.warn({ err }, "merchant_kyc_mobile_otp_sms_error");
      return { sent: false, provider: null, fallbackUsed: false };
    });
    req.log.info({ merchantId, smsSent: smsResult.sent }, "merchant_kyc_mobile_otp_sent");
    res.json({ ok: true, message: "OTP sent to your registered mobile number." });
  } catch (err) { next(err); }
});

// POST /api/merchant-kyc/mobile/verify/confirm
router.post("/mobile/verify/confirm", otpLimiter, async (req: any, res, next) => {
  try {
    const merchantId = req.user.merchantId as number;
    const { otp } = req.body as Record<string, unknown>;
    if (!otp || typeof otp !== "string") {
      res.status(400).json({ error: "OTP is required" });
      return;
    }
    const [merchant] = await db.select({ phone: merchantsTable.phone }).from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
    if (!merchant?.phone) {
      res.status(400).json({ error: "No mobile number on file for this merchant." });
      return;
    }
    const identifierHash = hashIdentifier(merchant.phone);
    const [otpRow] = await db.select().from(merchantAuthOtpsTable)
      .where(and(eq(merchantAuthOtpsTable.identifierHash, identifierHash), eq(merchantAuthOtpsTable.purpose, "KYC_MOBILE")))
      .orderBy(desc(merchantAuthOtpsTable.createdAt)).limit(1);

    if (!otpRow || otpRow.consumedAt || otpRow.expiresAt.getTime() < Date.now()) {
      res.status(400).json({ error: "Invalid or expired code. Please request a new one." });
      return;
    }
    if (otpRow.attempts >= OTP_MAX_ATTEMPTS) {
      res.status(429).json({ error: "Too many attempts. Please request a new code." });
      return;
    }
    const valid = await verifyOtpHash(otp, otpRow.otpHash);
    if (!valid) {
      await db.update(merchantAuthOtpsTable).set({ attempts: otpRow.attempts + 1 }).where(eq(merchantAuthOtpsTable.id, otpRow.id));
      res.status(400).json({ error: "Invalid or expired code. Please request a new one." });
      return;
    }
    await db.update(merchantAuthOtpsTable).set({ consumedAt: new Date() }).where(eq(merchantAuthOtpsTable.id, otpRow.id));

    await db.update(merchantKycVerificationsTable).set({
      mobileVerified: true,
      mobileVerifiedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(merchantKycVerificationsTable.merchantId, merchantId));

    const cfg = await loadAutoKycConfig();
    if (cfg) await evaluateFinalApproval(req, merchantId, cfg);

    const [finalRow] = await db.select().from(merchantKycVerificationsTable).where(eq(merchantKycVerificationsTable.merchantId, merchantId)).limit(1);
    req.log.info({ merchantId }, "merchant_kyc_mobile_verified");
    res.json({ ok: true, status: finalRow?.verificationStatus });
  } catch (err) { next(err); }
});

// POST /api/merchant-kyc/email/verify/request
router.post("/email/verify/request", otpLimiter, async (req: any, res, next) => {
  try {
    const row = await requireIdentityStepsDone(req, res);
    if (!row) return;
    const merchantId = req.user.merchantId as number;
    const [merchant] = await db.select({ email: merchantsTable.email }).from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
    if (!merchant?.email) {
      res.status(400).json({ error: "No email on file for this merchant." });
      return;
    }

    const identifierHash = hashIdentifier(merchant.email);
    const otp = generateOtp();
    const otpHash = await hashOtp(otp);
    await db.insert(merchantAuthOtpsTable).values({
      merchantId,
      identifierHash,
      otpHash,
      purpose: "KYC_EMAIL",
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
      attempts: 0,
      resendCount: 0,
      ipHash: null,
    });

    const sent = await sendMerchantOtpEmail({ to: merchant.email, otp, purpose: "KYC_EMAIL" }).catch((err: unknown) => {
      req.log.warn({ err }, "merchant_kyc_email_otp_send_error");
      return false;
    });
    req.log.info({ merchantId, sent }, "merchant_kyc_email_otp_sent");
    res.json({ ok: true, message: "OTP sent to your registered email address." });
  } catch (err) { next(err); }
});

// POST /api/merchant-kyc/email/verify/confirm
router.post("/email/verify/confirm", otpLimiter, async (req: any, res, next) => {
  try {
    const merchantId = req.user.merchantId as number;
    const { otp } = req.body as Record<string, unknown>;
    if (!otp || typeof otp !== "string") {
      res.status(400).json({ error: "OTP is required" });
      return;
    }
    const [merchant] = await db.select({ email: merchantsTable.email }).from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
    if (!merchant?.email) {
      res.status(400).json({ error: "No email on file for this merchant." });
      return;
    }
    const identifierHash = hashIdentifier(merchant.email);
    const [otpRow] = await db.select().from(merchantAuthOtpsTable)
      .where(and(eq(merchantAuthOtpsTable.identifierHash, identifierHash), eq(merchantAuthOtpsTable.purpose, "KYC_EMAIL")))
      .orderBy(desc(merchantAuthOtpsTable.createdAt)).limit(1);

    if (!otpRow || otpRow.consumedAt || otpRow.expiresAt.getTime() < Date.now()) {
      res.status(400).json({ error: "Invalid or expired code. Please request a new one." });
      return;
    }
    if (otpRow.attempts >= OTP_MAX_ATTEMPTS) {
      res.status(429).json({ error: "Too many attempts. Please request a new code." });
      return;
    }
    const valid = await verifyOtpHash(otp, otpRow.otpHash);
    if (!valid) {
      await db.update(merchantAuthOtpsTable).set({ attempts: otpRow.attempts + 1 }).where(eq(merchantAuthOtpsTable.id, otpRow.id));
      res.status(400).json({ error: "Invalid or expired code. Please request a new one." });
      return;
    }
    await db.update(merchantAuthOtpsTable).set({ consumedAt: new Date() }).where(eq(merchantAuthOtpsTable.id, otpRow.id));

    await db.update(merchantKycVerificationsTable).set({
      emailVerified: true,
      emailVerifiedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(merchantKycVerificationsTable.merchantId, merchantId));

    const cfg = await loadAutoKycConfig();
    if (cfg) await evaluateFinalApproval(req, merchantId, cfg);

    const [finalRow] = await db.select().from(merchantKycVerificationsTable).where(eq(merchantKycVerificationsTable.merchantId, merchantId)).limit(1);
    req.log.info({ merchantId }, "merchant_kyc_email_verified");
    res.json({ ok: true, status: finalRow?.verificationStatus });
  } catch (err) { next(err); }
});

export default router;
