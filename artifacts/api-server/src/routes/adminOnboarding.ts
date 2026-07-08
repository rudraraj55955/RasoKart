import { Router } from "express";
import { db, merchantOnboardingSessionsTable, merchantKycDataTable, verificationLogsTable, auditLogsTable, usersTable } from "@workspace/db";
import { eq, desc, and, count } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { safeDecrypt } from "../helpers/encryptionHelper";

const router = Router();
router.use(requireAuth, requireAdmin);

function mandatoryChecksPassed(kyc: { panStatus?: string | null; aadhaarStatus?: string | null; bankStatus?: string | null }): boolean {
  return (
    kyc.panStatus === "VERIFIED" &&
    (kyc.aadhaarStatus === "VERIFIED" || kyc.aadhaarStatus === "PENDING") && // PENDING = manual upload pending admin review
    kyc.bankStatus === "VERIFIED"
  );
}

function buildInfoFlags(kyc: {
  panStatus?: string | null;
  aadhaarStatus?: string | null;
  bankStatus?: string | null;
  gstinMasked?: string | null;
  cinNumber?: string | null;
  udyamNumber?: string | null;
  mismatchFlags?: any;
}): { type: "error" | "warning" | "info"; message: string }[] {
  const flags: { type: "error" | "warning" | "info"; message: string }[] = [];

  // Mandatory checks
  if (kyc.panStatus !== "VERIFIED") flags.push({ type: "error", message: "PAN not verified" });
  if (!kyc.aadhaarStatus || kyc.aadhaarStatus === "FAILED") flags.push({ type: "error", message: "Aadhaar not verified" });
  if (kyc.aadhaarStatus === "PENDING") flags.push({ type: "warning", message: "Aadhaar pending document review" });
  if (kyc.bankStatus !== "VERIFIED") flags.push({ type: "error", message: "Bank account not verified" });

  // Optional checks — info only, never block approval
  if (!kyc.gstinMasked) flags.push({ type: "info", message: "GSTIN not provided (optional)" });
  if (!kyc.cinNumber) flags.push({ type: "info", message: "CIN not provided (optional)" });
  if (!kyc.udyamNumber) flags.push({ type: "info", message: "Udyam number not provided (optional)" });

  // Mismatch flags
  const mismatches = Array.isArray(kyc.mismatchFlags) ? kyc.mismatchFlags as string[] : [];
  for (const f of mismatches) {
    if (f === "business_name_mismatch") flags.push({ type: "warning", message: "Business name mismatch detected" });
    if (f === "gstin_cin_not_provided") {} // already handled above as info
  }
  return flags;
}

// GET /api/admin/onboarding
router.get("/", async (req, res, next) => {
  try {
    const { page = "1", limit = "25", decision } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];
    if (decision) conditions.push(eq(merchantKycDataTable.adminDecision, decision));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db.select({
        merchantId: merchantKycDataTable.merchantId,
        fullName: merchantKycDataTable.fullName,
        businessName: merchantKycDataTable.businessName,
        panStatus: merchantKycDataTable.panStatus,
        aadhaarStatus: merchantKycDataTable.aadhaarStatus,
        gstStatus: merchantKycDataTable.gstStatus,
        bankStatus: merchantKycDataTable.bankStatus,
        gstinMasked: merchantKycDataTable.gstinMasked,
        cinNumber: merchantKycDataTable.cinNumber,
        udyamNumber: merchantKycDataTable.udyamNumber,
        riskScore: merchantKycDataTable.riskScore,
        mismatchFlags: merchantKycDataTable.mismatchFlags,
        adminDecision: merchantKycDataTable.adminDecision,
        rejectionReason: merchantKycDataTable.rejectionReason,
        approvedBy: merchantKycDataTable.approvedBy,
        approvedAt: merchantKycDataTable.approvedAt,
        kycUpdatedAt: merchantKycDataTable.updatedAt,
        sessionStatus: merchantOnboardingSessionsTable.status,
        verificationId: merchantOnboardingSessionsTable.verificationId,
        mobileLast4: merchantOnboardingSessionsTable.mobileLast4,
        sessionCreatedAt: merchantOnboardingSessionsTable.createdAt,
      })
        .from(merchantKycDataTable)
        .leftJoin(merchantOnboardingSessionsTable, eq(merchantOnboardingSessionsTable.id, merchantKycDataTable.onboardingSessionId))
        .where(where)
        .orderBy(desc(merchantKycDataTable.updatedAt))
        .limit(limitNum)
        .offset(offset),
      db.select({ total: count() }).from(merchantKycDataTable).where(where),
    ]);

    const merchantIds = rows.map((r) => r.merchantId);
    const merchantUsers = merchantIds.length > 0
      ? await db.select({ email: usersTable.email, merchantId: usersTable.merchantId })
          .from(usersTable).where(eq(usersTable.role, "merchant"))
      : [];
    const userMap = new Map(merchantUsers.map((u) => [u.merchantId, u.email]));

    res.json({
      applications: rows.map((r) => ({
        ...r,
        merchantEmail: userMap.get(r.merchantId) ?? null,
        mobileMasked: r.mobileLast4 ? `****${r.mobileLast4}` : null,
        mobileLast4: undefined,
        mandatoryChecksPassed: mandatoryChecksPassed(r),
        infoFlags: buildInfoFlags(r),
      })),
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) { next(err); }
});

// GET /api/admin/onboarding/:merchantId
router.get("/:merchantId", async (req, res, next) => {
  try {
    const merchantId = parseInt(req.params["merchantId"] as string);
    if (!merchantId) { res.status(400).json({ error: "Invalid merchantId" }); return; }

    const [kyc] = await db.select().from(merchantKycDataTable)
      .where(eq(merchantKycDataTable.merchantId, merchantId)).limit(1);
    if (!kyc) { res.status(404).json({ error: "KYC data not found" }); return; }

    const [session] = await db.select({
      id: merchantOnboardingSessionsTable.id,
      verificationId: merchantOnboardingSessionsTable.verificationId,
      status: merchantOnboardingSessionsTable.status,
      consentStatus: merchantOnboardingSessionsTable.consentStatus,
      mobileLast4: merchantOnboardingSessionsTable.mobileLast4,
      dataAvailable: merchantOnboardingSessionsTable.dataAvailable,
      createdAt: merchantOnboardingSessionsTable.createdAt,
    }).from(merchantOnboardingSessionsTable)
      .where(eq(merchantOnboardingSessionsTable.merchantId, merchantId))
      .orderBy(desc(merchantOnboardingSessionsTable.createdAt))
      .limit(1);

    const [user] = await db.select({ email: usersTable.email })
      .from(usersTable)
      .where(and(eq(usersTable.merchantId, merchantId), eq(usersTable.role, "merchant")))
      .limit(1);

    const mismatchFlagsArr = Array.isArray(kyc.mismatchFlags) ? kyc.mismatchFlags as string[] : [];

    res.json({
      kyc: { ...kyc, mismatchFlags: mismatchFlagsArr },
      session: session ? { ...session, mobileMasked: session.mobileLast4 ? `****${session.mobileLast4}` : null, mobileLast4: undefined } : null,
      merchantEmail: user?.email ?? null,
      mandatoryChecksPassed: mandatoryChecksPassed(kyc),
      infoFlags: buildInfoFlags({ ...kyc, mismatchFlags: mismatchFlagsArr }),
    });
  } catch (err) { next(err); }
});

// POST /api/admin/onboarding/:merchantId/decision
router.post("/:merchantId/decision", async (req, res, next) => {
  try {
    const admin = (req as any).user;
    const merchantId = parseInt(req.params["merchantId"] as string);
    const { decision, rejectionReason } = req.body as { decision?: string; rejectionReason?: string };

    if (!decision || !["APPROVED", "REJECTED", "RE_UPLOAD_REQUIRED"].includes(decision)) {
      res.status(400).json({ error: "decision must be APPROVED, REJECTED, or RE_UPLOAD_REQUIRED" }); return;
    }
    if ((decision === "REJECTED" || decision === "RE_UPLOAD_REQUIRED") && !rejectionReason?.trim()) {
      res.status(400).json({ error: "rejectionReason is required for this decision" }); return;
    }

    const [kyc] = await db.select({
      id: merchantKycDataTable.id,
      panStatus: merchantKycDataTable.panStatus,
      aadhaarStatus: merchantKycDataTable.aadhaarStatus,
      bankStatus: merchantKycDataTable.bankStatus,
    }).from(merchantKycDataTable).where(eq(merchantKycDataTable.merchantId, merchantId)).limit(1);
    if (!kyc) { res.status(404).json({ error: "KYC record not found" }); return; }

    // Prevent approval if mandatory checks are not met (super admin can override)
    if (decision === "APPROVED" && !admin.isSuperAdmin) {
      if (!mandatoryChecksPassed(kyc)) {
        res.status(400).json({
          error: "Cannot approve: mandatory verifications (PAN, Aadhaar, Bank) are not complete",
          hint: "Super Admin can override this restriction",
        }); return;
      }
    }

    const updatePayload: Record<string, unknown> = { adminDecision: decision };
    if (decision === "REJECTED" || decision === "RE_UPLOAD_REQUIRED") {
      updatePayload["rejectionReason"] = rejectionReason!.trim();
    }
    if (decision === "APPROVED") {
      updatePayload["approvedBy"] = admin.email;
      updatePayload["approvedAt"] = new Date();
      updatePayload["rejectionReason"] = null;
    }

    await db.update(merchantKycDataTable).set(updatePayload as any)
      .where(eq(merchantKycDataTable.merchantId, merchantId));

    const sessionStatusMap: Record<string, string> = {
      APPROVED: "APPROVED", REJECTED: "REJECTED", RE_UPLOAD_REQUIRED: "RE_UPLOAD_REQUIRED",
    };
    await db.update(merchantOnboardingSessionsTable)
      .set({ status: sessionStatusMap[decision] })
      .where(eq(merchantOnboardingSessionsTable.merchantId, merchantId));

    await db.insert(auditLogsTable).values({
      userId: admin.id,
      action: `onboarding_kyc_${decision.toLowerCase()}`,
      targetType: "merchant",
      targetId: String(merchantId),
      details: { decision, rejectionReason: rejectionReason ?? null, adminEmail: admin.email },
    } as any).catch(() => {});

    req.log.info({ merchantId, decision, adminId: admin.id }, "onboarding_admin_decision");
    res.json({ ok: true, decision });
  } catch (err) { next(err); }
});

// GET /api/admin/onboarding/:merchantId/logs
router.get("/:merchantId/logs", async (req, res, next) => {
  try {
    const merchantId = parseInt(req.params["merchantId"] as string);
    const isSuperAdmin = !!(req as any).user?.isSuperAdmin;

    const logs = await db.select().from(verificationLogsTable)
      .where(eq(verificationLogsTable.merchantId, merchantId))
      .orderBy(desc(verificationLogsTable.createdAt))
      .limit(100);

    const result = logs.map((log) => {
      const base = {
        id: log.id, verificationType: log.verificationType, status: log.status,
        requestId: log.requestId, createdAt: log.createdAt,
      };
      if (isSuperAdmin) {
        const rawResponse = safeDecrypt(log.rawResponseEncrypted, log.rawResponseIv, log.rawResponseTag);
        const error = safeDecrypt(log.errorEncrypted, log.errorIv, log.errorTag);
        return { ...base, rawResponse: rawResponse ? JSON.parse(rawResponse) : null, error };
      }
      return base;
    });

    res.json({ logs: result });
  } catch (err) { next(err); }
});

export default router;
