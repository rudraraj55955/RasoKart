import { Router } from "express";
import { db, merchantOnboardingSessionsTable, merchantKycDataTable, verificationLogsTable, auditLogsTable, usersTable, merchantsTable } from "@workspace/db";
import { eq, desc, and, count, or, ilike } from "drizzle-orm";
import { requireAuth, requireAdmin, requireSuperAdmin } from "../middlewares/auth";
import { safeDecrypt } from "../helpers/encryptionHelper";

const router = Router();
router.use(requireAuth, requireAdmin);

// GET /api/admin/onboarding — list all onboarding applications
router.get("/", async (req, res, next) => {
  try {
    const { page = "1", limit = "25", decision, search } = req.query as Record<string, string>;
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
        gstStatus: merchantKycDataTable.gstStatus,
        bankStatus: merchantKycDataTable.bankStatus,
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
      ? await db.select({ id: usersTable.id, email: usersTable.email, merchantId: usersTable.merchantId })
          .from(usersTable)
          .where(and(eq(usersTable.role, "merchant")))
      : [];
    const userMap = new Map(merchantUsers.map((u) => [u.merchantId, u.email]));

    res.json({
      applications: rows.map((r) => ({
        ...r,
        merchantEmail: userMap.get(r.merchantId) ?? null,
        mobileMasked: r.mobileLast4 ? `****${r.mobileLast4}` : null,
        mobileLast4: undefined,
      })),
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) { next(err); }
});

// GET /api/admin/onboarding/:merchantId — get specific merchant's full KYC data
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

    res.json({
      kyc: { ...kyc, mismatchFlags: Array.isArray(kyc.mismatchFlags) ? kyc.mismatchFlags : [] },
      session: session ? { ...session, mobileMasked: session.mobileLast4 ? `****${session.mobileLast4}` : null, mobileLast4: undefined } : null,
      merchantEmail: user?.email ?? null,
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

    const [kyc] = await db.select({ id: merchantKycDataTable.id, adminDecision: merchantKycDataTable.adminDecision })
      .from(merchantKycDataTable).where(eq(merchantKycDataTable.merchantId, merchantId)).limit(1);
    if (!kyc) { res.status(404).json({ error: "KYC record not found" }); return; }

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

    if (decision === "APPROVED") {
      await db.update(merchantOnboardingSessionsTable)
        .set({ status: "APPROVED" })
        .where(eq(merchantOnboardingSessionsTable.merchantId, merchantId));
    } else if (decision === "REJECTED") {
      await db.update(merchantOnboardingSessionsTable)
        .set({ status: "REJECTED" })
        .where(eq(merchantOnboardingSessionsTable.merchantId, merchantId));
    } else if (decision === "RE_UPLOAD_REQUIRED") {
      await db.update(merchantOnboardingSessionsTable)
        .set({ status: "RE_UPLOAD_REQUIRED" })
        .where(eq(merchantOnboardingSessionsTable.merchantId, merchantId));
    }

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

// GET /api/admin/onboarding/:merchantId/logs — admin-only raw verification logs
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
        id: log.id,
        verificationType: log.verificationType,
        status: log.status,
        requestId: log.requestId,
        createdAt: log.createdAt,
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
