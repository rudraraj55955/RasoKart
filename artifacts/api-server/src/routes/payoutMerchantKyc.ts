/**
 * Payout Merchant KYC routes — /api/payout-merchant/kyc/*
 *
 * Uses the same Secure ID credentials configured in merchant_kyc_settings
 * (separate from Cashfree Payout API credentials and Payment Gateway credentials).
 *
 * On PAN + Aadhaar + name-match approval:
 *   - sets merchantsTable.payoutServiceEnabled = true
 *   - sets merchantsTable.approvedForPayoutAt = now()
 *
 * Security:
 *   - Rate-limited (10 attempts/hour per IP+merchant)
 *   - PAN number hashed before storage; reference IDs encrypted at rest
 *   - Full Aadhaar number is NEVER stored; only last 4 digits
 *   - Consent IP + user-agent logged
 *   - Auto-approval audit trail written to audit_logs
 */
import { Router } from "express";
import { db, merchantKycVerificationsTable, merchantsTable, auditLogsTable } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { DbRateLimitStore } from "../lib/rateLimitStore";
import { makeRateLimiter, safeIpKey } from "../helpers/makeRateLimiter";
import { encryptValue, safeDecrypt, hashValue } from "../helpers/encryptionHelper";
import {
  loadAutoKycConfig,
  verifyPanAuto,
  startAadhaarDigilockerSession,
  completeAadhaarDigilockerSession,
  computeNameMatchScore,
  maskPan,
  type AutoKycConfig,
} from "../helpers/merchantAutoKycProvider";

const router = Router();
router.use(requireAuth);

// ── Guard: payout merchant only ─────────────────────────────────────────────
async function requirePayoutMerchant(req: any, res: any, next: any) {
  const user = req.user;
  if (!user || user.role !== "merchant" || !user.merchantId) {
    res.status(403).json({ error: "Payout merchant access required" });
    return;
  }
  const [m] = await db
    .select({ merchantType: merchantsTable.merchantType })
    .from(merchantsTable)
    .where(eq(merchantsTable.id, user.merchantId))
    .limit(1);
  if (!m || (m.merchantType !== "PAYOUT_ONLY" && m.merchantType !== "BOTH")) {
    res.status(403).json({ error: "Payout merchant access required" });
    return;
  }
  next();
}

const attemptLimiter = makeRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  store: new DbRateLimitStore(),
  message: { error: "Too many KYC attempts. Please try again later." },
  keyGenerator: (req: any) =>
    `payout-kyc:${safeIpKey(req)}:${req.user?.merchantId ?? "anon"}`,
});

// ── Serialisation helper ────────────────────────────────────────────────────
function publicRow(row: typeof merchantKycVerificationsTable.$inferSelect | null) {
  if (!row) {
    return {
      status: "PENDING",
      panVerified: false,
      aadhaarVerified: false,
      nameMatchScore: null,
      failureReason: null,
    };
  }
  return {
    status: row.verificationStatus,
    panVerified: row.panVerified,
    panNumberMasked: row.panNumberMasked,
    panType: row.panType,
    aadhaarVerified: row.aadhaarVerified,
    aadhaarLast4: row.aadhaarLast4,
    nameMatchScore: row.nameMatchScore,
    failureReason: row.failureReason,
    consentAt: row.consentAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function getOrCreateRow(merchantId: number) {
  const [existing] = await db
    .select()
    .from(merchantKycVerificationsTable)
    .where(eq(merchantKycVerificationsTable.merchantId, merchantId))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(merchantKycVerificationsTable)
    .values({ merchantId, verificationStatus: "PENDING" })
    .returning();
  return created!;
}

/**
 * Payout merchant KYC auto-approval:
 *   PAN verified + Aadhaar DigiLocker AUTHENTICATED + name-match ≥ threshold
 *   => payoutServiceEnabled = true, approvedForPayoutAt = now()
 *
 * Mobile/email OTP verification is NOT required for payout merchant KYC
 * (handled separately during merchant onboarding).
 */
async function evaluatePayoutMerchantApproval(
  req: any,
  merchantId: number,
  cfg: AutoKycConfig,
) {
  const [row] = await db
    .select()
    .from(merchantKycVerificationsTable)
    .where(eq(merchantKycVerificationsTable.merchantId, merchantId))
    .limit(1);
  if (!row) return;
  if (["APPROVED", "REJECTED", "BLOCKED"].includes(row.verificationStatus)) return;

  const identityVerified = row.panVerified && row.aadhaarVerified;
  if (!identityVerified) return;

  const nameMatchPassed =
    row.nameMatchScore != null && row.nameMatchScore >= cfg.minNameMatchScore;

  if (!nameMatchPassed) {
    await db
      .update(merchantKycVerificationsTable)
      .set({
        verificationStatus: "NAME_MISMATCH" as any,
        failureReason:
          "Name on PAN/Aadhaar does not match the registered business owner name. Please contact support.",
        updatedAt: new Date(),
      })
      .where(eq(merchantKycVerificationsTable.merchantId, merchantId));
    return;
  }

  if (!cfg.autoApproveEnabled) {
    await db
      .update(merchantKycVerificationsTable)
      .set({
        verificationStatus: "MANUAL_REVIEW" as any,
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(eq(merchantKycVerificationsTable.merchantId, merchantId));
    return;
  }

  // Auto-approve: activate payout service for this merchant
  await db
    .update(merchantKycVerificationsTable)
    .set({
      verificationStatus: "APPROVED" as any,
      failureReason: null,
      updatedAt: new Date(),
    })
    .where(eq(merchantKycVerificationsTable.merchantId, merchantId));

  await db
    .update(merchantsTable)
    .set({
      payoutServiceEnabled: true,
      approvedForPayoutAt: new Date(),
      status: "approved",
    } as any)
    .where(eq(merchantsTable.id, merchantId));

  await db.insert(auditLogsTable).values({
    adminEmail: "auto-kyc@rasokart.com",
    action: "payout_merchant_auto_kyc_approved",
    targetType: "merchant",
    targetId: merchantId,
    details: JSON.stringify({ nameMatchScore: row.nameMatchScore }),
    ipAddress: req.ip ?? null,
  } as any);

  req.log.info(
    { merchantId, nameMatchScore: row.nameMatchScore },
    "payout_merchant_auto_kyc_approved",
  );
}

// ── GET /api/payout-merchant/kyc/status ─────────────────────────────────────
router.get("/status", requirePayoutMerchant, async (req: any, res, next) => {
  try {
    const [row] = await db
      .select()
      .from(merchantKycVerificationsTable)
      .where(eq(merchantKycVerificationsTable.merchantId, req.user.merchantId))
      .limit(1);
    res.json(publicRow(row ?? null));
  } catch (err) {
    next(err);
  }
});

// ── POST /api/payout-merchant/kyc/pan/verify ────────────────────────────────
router.post(
  "/pan/verify",
  requirePayoutMerchant,
  attemptLimiter,
  async (req: any, res, next) => {
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
        res
          .status(503)
          .json({ error: "KYC verification is temporarily unavailable. Please try again later." });
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
          .where(
            and(
              eq(merchantKycVerificationsTable.panNumberHash, panHash),
              ne(merchantKycVerificationsTable.merchantId, merchantId),
            ),
          )
          .limit(1);
        if (dup) {
          res.status(409).json({ error: "This PAN is already linked to another account." });
          return;
        }
      }

      const [merchant] = await db
        .select({ contactName: merchantsTable.contactName })
        .from(merchantsTable)
        .where(eq(merchantsTable.id, merchantId))
        .limit(1);

      const result = await verifyPanAuto(
        cfg,
        pan,
        merchantId,
        merchant?.contactName ?? undefined,
      );

      if (!result.ok) {
        await db
          .update(merchantKycVerificationsTable)
          .set({
            verificationStatus: "PAN_FAILED" as any,
            failureReason:
              result.status === "INVALID"
                ? "PAN details could not be verified."
                : "Verification provider unavailable. Please try again.",
            updatedAt: new Date(),
          })
          .where(eq(merchantKycVerificationsTable.merchantId, merchantId));
        res.status(422).json({
          error:
            result.status === "INVALID"
              ? "PAN details could not be verified."
              : "Verification provider unavailable. Please try again.",
        });
        return;
      }

      const enc = result.requestId ? encryptValue(result.requestId) : null;
      await db
        .update(merchantKycVerificationsTable)
        .set({
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
        })
        .where(eq(merchantKycVerificationsTable.merchantId, merchantId));

      req.log.info({ merchantId }, "payout_merchant_kyc_pan_verified");
      res.json({
        ok: true,
        panType: result.panType,
        panNumberMasked: maskPan(pan),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /api/payout-merchant/kyc/aadhaar/start ─────────────────────────────
router.post(
  "/aadhaar/start",
  requirePayoutMerchant,
  attemptLimiter,
  async (req: any, res, next) => {
    try {
      const merchantId = req.user.merchantId as number;

      const cfg = await loadAutoKycConfig();
      if (!cfg || !cfg.aadhaarApiEnabled) {
        res
          .status(503)
          .json({ error: "KYC verification is temporarily unavailable. Please try again later." });
        return;
      }

      const [row] = await db
        .select()
        .from(merchantKycVerificationsTable)
        .where(eq(merchantKycVerificationsTable.merchantId, merchantId))
        .limit(1);
      if (!row || !row.panVerified) {
        res.status(400).json({ error: "Please complete PAN verification first." });
        return;
      }

      const [merchant] = await db
        .select({ phone: merchantsTable.phone })
        .from(merchantsTable)
        .where(eq(merchantsTable.id, merchantId))
        .limit(1);

      const result = await startAadhaarDigilockerSession(
        cfg,
        merchantId,
        merchant?.phone ?? "",
      );
      if (!result.ok || !result.sessionId) {
        res
          .status(422)
          .json({ error: "Could not start Aadhaar verification. Please try again." });
        return;
      }

      const enc = encryptValue(result.sessionId);
      await db
        .update(merchantKycVerificationsTable)
        .set({
          aadhaarDigilockerSessionEncrypted: enc.encrypted,
          aadhaarDigilockerSessionIv: enc.iv,
          aadhaarDigilockerSessionTag: enc.tag,
          consentIp: req.ip ?? null,
          consentUserAgent: (req.headers["user-agent"] as string) ?? null,
          consentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(merchantKycVerificationsTable.merchantId, merchantId));

      req.log.info({ merchantId }, "payout_merchant_kyc_aadhaar_session_started");
      res.json({ ok: true, sessionId: result.sessionId, mode: result.mode });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /api/payout-merchant/kyc/aadhaar/complete ──────────────────────────
router.post(
  "/aadhaar/complete",
  requirePayoutMerchant,
  attemptLimiter,
  async (req: any, res, next) => {
    try {
      const merchantId = req.user.merchantId as number;
      const { authCode } = req.body as Record<string, unknown>;

      const cfg = await loadAutoKycConfig();
      if (!cfg) {
        res
          .status(503)
          .json({ error: "KYC verification is temporarily unavailable. Please try again later." });
        return;
      }

      const [row] = await db
        .select()
        .from(merchantKycVerificationsTable)
        .where(eq(merchantKycVerificationsTable.merchantId, merchantId))
        .limit(1);

      const sessionId = row
        ? safeDecrypt(
            row.aadhaarDigilockerSessionEncrypted,
            row.aadhaarDigilockerSessionIv,
            row.aadhaarDigilockerSessionTag,
          )
        : null;

      if (!row || !sessionId) {
        res.status(400).json({ error: "Please start Aadhaar verification first." });
        return;
      }
      if (!authCode || typeof authCode !== "string") {
        res.status(400).json({ error: "authCode is required" });
        return;
      }

      const result = await completeAadhaarDigilockerSession(
        cfg,
        sessionId,
        authCode,
        merchantId,
      );

      if (!result.ok) {
        await db
          .update(merchantKycVerificationsTable)
          .set({
            verificationStatus: "AADHAAR_FAILED" as any,
            failureReason: "Aadhaar DigiLocker verification failed. Please try again.",
            updatedAt: new Date(),
          })
          .where(eq(merchantKycVerificationsTable.merchantId, merchantId));
        res.status(422).json({ error: "Aadhaar DigiLocker verification failed. Please try again." });
        return;
      }

      const [merchant] = await db
        .select({ contactName: merchantsTable.contactName })
        .from(merchantsTable)
        .where(eq(merchantsTable.id, merchantId))
        .limit(1);

      const aadhaarName = result.name ?? "";
      const panName = row.panName ?? "";
      const merchantOwnerName = merchant?.contactName ?? "";

      const scorePanAadhaar = computeNameMatchScore(panName, aadhaarName);
      const scorePanOwner = computeNameMatchScore(panName, merchantOwnerName);
      const scoreAadhaarOwner = computeNameMatchScore(aadhaarName, merchantOwnerName);
      const finalScore = Math.min(scorePanAadhaar, scorePanOwner, scoreAadhaarOwner);

      await db
        .update(merchantKycVerificationsTable)
        .set({
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
        })
        .where(eq(merchantKycVerificationsTable.merchantId, merchantId));

      req.log.info(
        { merchantId, nameMatchScore: finalScore },
        "payout_merchant_kyc_aadhaar_verified",
      );

      await evaluatePayoutMerchantApproval(req, merchantId, cfg);

      const [updatedRow] = await db
        .select()
        .from(merchantKycVerificationsTable)
        .where(eq(merchantKycVerificationsTable.merchantId, merchantId))
        .limit(1);

      res.json({
        ok: true,
        aadhaarLast4: result.last4,
        nameMatchScore: finalScore,
        kycStatus: updatedRow?.verificationStatus ?? "AADHAAR_VERIFIED",
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /api/payout-merchant/kyc/aadhaar/status — polling for Aadhaar state ─
router.get("/aadhaar/status", requirePayoutMerchant, async (req: any, res, next) => {
  try {
    const merchantId = req.user.merchantId as number;
    const [row] = await db
      .select()
      .from(merchantKycVerificationsTable)
      .where(eq(merchantKycVerificationsTable.merchantId, merchantId))
      .limit(1);
    res.json({
      aadhaarVerified: row?.aadhaarVerified ?? false,
      aadhaarLast4: row?.aadhaarLast4 ?? null,
      status: row?.verificationStatus ?? "PENDING",
    });
  } catch (err) {
    next(err);
  }
});

export default router;
