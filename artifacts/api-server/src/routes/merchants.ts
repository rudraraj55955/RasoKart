import { Router } from "express";
import { db, merchantsTable, usersTable, merchantPlansTable, plansTable, planHistoryTable, auditLogsTable, invoicesTable, apiKeysTable, credentialEventsTable, webhooksTable, webhookFailureAlertLogsTable, merchantKycTable } from "@workspace/db";
import { eq, ilike, and, or, count, sql, desc, lt, lte, gte, isNotNull, inArray } from "drizzle-orm";
import { maskIp } from "../helpers/apiKeyEmail";
import { loadWebhookRetryConfig } from "../helpers/callbackRetry";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { getMerchantPlanUsage } from "../helpers/planLimits";
import { sendRejectionEmail } from "../helpers/rejectionEmail";
import { sendCallbackSecretResetEmail } from "../helpers/callbackSecretResetEmail";
import { buildPlanAssignedHtml, buildPlanSuspendedHtml, buildPlanReinstatedHtml } from "../helpers/merchantNotifyEmail";
import { ObjectStorageService, ObjectNotFoundError, InvalidImageError } from "../lib/objectStorage";
import { consumeUploadIntent } from "../lib/uploadIntentStore";

const objectStorageService = new ObjectStorageService();

const router = Router();

router.use(requireAuth);

function serializeMerchant(m: typeof merchantsTable.$inferSelect) {
  return {
    ...m,
    totalDeposits: Number(m.totalDeposits),
    totalWithdrawals: Number(m.totalWithdrawals),
    balance: Number(m.balance),
  };
}

function buildPlanResponse(mp: typeof merchantPlansTable.$inferSelect, plan: typeof plansTable.$inferSelect) {
  const isExpired = mp.expiresAt ? new Date() > mp.expiresAt : false;
  const daysUntilExpiry = mp.expiresAt
    ? Math.max(0, Math.ceil((mp.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;
  return {
    id: mp.id, merchantId: mp.merchantId, planId: mp.planId,
    planName: plan.name, description: plan.description ?? null,
    price: plan.price, monthlyFee: plan.monthlyFee, yearlyFee: plan.yearlyFee, setupFee: plan.setupFee,
    pricing: plan.pricing, features: plan.features, customFeatures: plan.customFeatures,
    dynamicQrLimit: plan.dynamicQrLimit, staticQrLimit: plan.staticQrLimit,
    virtualAccountLimit: plan.virtualAccountLimit, paymentLinkLimit: plan.paymentLinkLimit,
    payoutLimit: plan.payoutLimit, dailyTransactionLimit: plan.dailyTransactionLimit,
    monthlyTransactionLimit: plan.monthlyTransactionLimit,
    settlementFee: plan.settlementFee, depositFee: plan.depositFee,
    apiAccess: plan.apiAccess, webhookAccess: plan.webhookAccess, providerAccess: plan.providerAccess,
    status: mp.status,
    assignedAt: mp.assignedAt, expiresAt: mp.expiresAt ?? null, isExpired,
    scheduledRenewalAt: mp.scheduledRenewalAt?.toISOString() ?? null,
    daysUntilExpiry, notes: mp.notes ?? null,
  };
}

async function logPlanHistory(opts: {
  merchantId: number; fromPlanId: number | null; toPlanId: number | null;
  action: string; adminId?: number; adminEmail?: string; notes?: string; expiresAt?: Date | null;
}) {
  await db.insert(planHistoryTable).values({
    merchantId: opts.merchantId, fromPlanId: opts.fromPlanId ?? null,
    toPlanId: opts.toPlanId ?? null, action: opts.action,
    assignedBy: opts.adminId ?? null, adminEmail: opts.adminEmail ?? null, notes: opts.notes ?? null,
    expiresAt: opts.expiresAt ?? null,
  });
}

// GET /api/merchants
router.get("/", requireAdmin, async (req, res) => {
  const { status, search, page = "1", limit = "20", expiryStatus, rejectionReason, callbackSecretSet, loginAlertEmails, securityEmailsDisabled } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 86400000);

  const conditions = [];
  if (status && status !== "all") conditions.push(eq(merchantsTable.status, status));
  if (search) {
    conditions.push(or(
      ilike(merchantsTable.businessName, `%${search}%`),
      ilike(merchantsTable.email, `%${search}%`),
      ilike(merchantsTable.contactName, `%${search}%`),
    )!);
  }
  if (rejectionReason) {
    conditions.push(ilike(merchantsTable.rejectionReason, `%${rejectionReason}%`));
  }
  if (callbackSecretSet === "true") {
    conditions.push(isNotNull(merchantsTable.callbackSecret));
  } else if (callbackSecretSet === "false") {
    conditions.push(sql`${merchantsTable.callbackSecret} IS NULL`);
  }
  if (loginAlertEmails === "false") {
    conditions.push(eq(usersTable.loginAlertEmails, false));
  } else if (loginAlertEmails === "true") {
    conditions.push(eq(usersTable.loginAlertEmails, true));
  }
  if (securityEmailsDisabled === "true") {
    conditions.push(or(
      eq(usersTable.signatureFailureAlertEmails, false),
      eq(usersTable.webhookFailureEmails, false),
      eq(usersTable.apiKeyGeneratedEmails, false),
      eq(usersTable.apiKeyRevokedEmails, false),
    )!);
  }

  const planConditions = [];
  if (expiryStatus === "expired") {
    planConditions.push(isNotNull(merchantPlansTable.expiresAt));
    planConditions.push(lt(merchantPlansTable.expiresAt, now));
  } else if (expiryStatus === "expiring") {
    planConditions.push(isNotNull(merchantPlansTable.expiresAt));
    planConditions.push(gte(merchantPlansTable.expiresAt, now));
    planConditions.push(lte(merchantPlansTable.expiresAt, sevenDaysLater));
  }

  const allConditions = [...conditions, ...planConditions];
  const where = allConditions.length > 0 ? and(...allConditions) : undefined;

  const needsUserJoin = loginAlertEmails === "true" || loginAlertEmails === "false" || securityEmailsDisabled === "true";

  let total: number;
  if (planConditions.length > 0 || needsUserJoin) {
    const q = db
      .select({ total: count() })
      .from(merchantsTable)
      .leftJoin(usersTable, eq(usersTable.merchantId, merchantsTable.id))
      .leftJoin(merchantPlansTable, eq(merchantPlansTable.merchantId, merchantsTable.id));
    const [{ total: t }] = await q.where(where);
    total = t;
  } else {
    const [{ total: t }] = await db.select({ total: count() }).from(merchantsTable).where(where);
    total = t;
  }

  const rows = await db
    .select({
      merchant: merchantsTable,
      currentPlanName: plansTable.name,
      currentPlanStatus: merchantPlansTable.status,
      currentPlanExpiresAt: merchantPlansTable.expiresAt,
      loginAlertEmails: usersTable.loginAlertEmails,
      signatureFailureAlertEmails: usersTable.signatureFailureAlertEmails,
      webhookFailureEmails: usersTable.webhookFailureEmails,
      apiKeyGeneratedEmails: usersTable.apiKeyGeneratedEmails,
      apiKeyRevokedEmails: usersTable.apiKeyRevokedEmails,
      reportScheduleChangedEmails: usersTable.reportScheduleChangedEmails,
      settlementStateChangedEmails: usersTable.settlementStateChangedEmails,
      planExpiryAlertEmails: usersTable.planExpiryAlertEmails,
    })
    .from(merchantsTable)
    .leftJoin(usersTable, eq(usersTable.merchantId, merchantsTable.id))
    .leftJoin(merchantPlansTable, eq(merchantPlansTable.merchantId, merchantsTable.id))
    .leftJoin(plansTable, eq(plansTable.id, merchantPlansTable.planId))
    .where(where)
    .limit(limitNum).offset(offset)
    .orderBy(sql`${merchantsTable.createdAt} DESC`);

  res.json({
    data: rows.map(r => {
      const expiresAt = r.currentPlanExpiresAt ?? null;
      const isExpired = expiresAt ? now > expiresAt : null;
      return {
        ...serializeMerchant(r.merchant),
        callbackSecretSet: r.merchant.callbackSecret != null,
        currentPlanName: r.currentPlanName ?? null,
        currentPlanStatus: r.currentPlanStatus ?? null,
        currentPlanExpiresAt: expiresAt ? expiresAt.toISOString() : null,
        currentPlanIsExpired: isExpired,
        loginAlertEmails: r.loginAlertEmails ?? true,
        signatureFailureAlertEmails: r.signatureFailureAlertEmails ?? true,
        webhookFailureEmails: r.webhookFailureEmails ?? true,
        apiKeyGeneratedEmails: r.apiKeyGeneratedEmails ?? true,
        apiKeyRevokedEmails: r.apiKeyRevokedEmails ?? true,
        reportScheduleChangedEmails: r.reportScheduleChangedEmails ?? true,
        settlementStateChangedEmails: r.settlementStateChangedEmails ?? true,
        planExpiryAlertEmails: r.planExpiryAlertEmails ?? true,
      };
    }),
    total,
    page: pageNum,
    limit: limitNum,
  });
});

// GET /api/merchants/webhook-failure-counts  (admin only)
// Returns total webhook failure alert counts per merchant for a given list of merchant IDs
router.get("/webhook-failure-counts", requireAdmin, async (req, res, next) => {
  try {
    const raw = (req.query['merchantIds'] as string) ?? "";
    const ids = raw
      .split(",")
      .map(s => parseInt(s.trim()))
      .filter(n => !isNaN(n) && n > 0);

    if (ids.length === 0) {
      res.json({ counts: {} });
      return;
    }

    const rows = await db
      .select({
        merchantId: webhookFailureAlertLogsTable.merchantId,
        total: count(),
      })
      .from(webhookFailureAlertLogsTable)
      .where(inArray(webhookFailureAlertLogsTable.merchantId, ids))
      .groupBy(webhookFailureAlertLogsTable.merchantId);

    const counts: Record<number, number> = {};
    for (const row of rows) {
      counts[row.merchantId] = row.total;
    }

    res.json({ counts });
  } catch (err) {
    next(err);
  }
});

// GET /api/merchants/:id  (admin, or the merchant viewing their own profile)
router.get("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id as string);
  if (user.role !== "admin" && user.merchantId !== id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const [row] = await db
    .select({
      merchant: merchantsTable,
      loginAlertEmails: usersTable.loginAlertEmails,
      signatureFailureAlertEmails: usersTable.signatureFailureAlertEmails,
      webhookFailureEmails: usersTable.webhookFailureEmails,
      apiKeyGeneratedEmails: usersTable.apiKeyGeneratedEmails,
      apiKeyRevokedEmails: usersTable.apiKeyRevokedEmails,
      reportScheduleChangedEmails: usersTable.reportScheduleChangedEmails,
      settlementStateChangedEmails: usersTable.settlementStateChangedEmails,
      planExpiryAlertEmails: usersTable.planExpiryAlertEmails,
    })
    .from(merchantsTable)
    .leftJoin(usersTable, eq(usersTable.merchantId, merchantsTable.id))
    .where(eq(merchantsTable.id, id))
    .limit(1);
  if (!row) { res.status(404).json({ error: "Merchant not found" }); return; }
  res.json({
    ...serializeMerchant(row.merchant),
    loginAlertEmails: row.loginAlertEmails ?? true,
    signatureFailureAlertEmails: row.signatureFailureAlertEmails ?? true,
    webhookFailureEmails: row.webhookFailureEmails ?? true,
    apiKeyGeneratedEmails: row.apiKeyGeneratedEmails ?? true,
    apiKeyRevokedEmails: row.apiKeyRevokedEmails ?? true,
    reportScheduleChangedEmails: row.reportScheduleChangedEmails ?? true,
    settlementStateChangedEmails: row.settlementStateChangedEmails ?? true,
    planExpiryAlertEmails: row.planExpiryAlertEmails ?? true,
  });
});

// PATCH /api/merchants/:id/branding  (merchant updates own, admin updates any)
router.patch("/:id/branding", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);
  if (user.role !== "admin" && user.merchantId !== id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { logoUrl, brandColor } = req.body;

  // Validate magic bytes for newly uploaded object-storage logos before
  // persisting the path.  External URLs and explicit null (removing logo) are
  // left untouched.
  // We look up the trusted declared content type from the server-side upload-
  // intent record (stored when the presigned URL was issued) — not from any
  // client-supplied value in this request.
  if (logoUrl != null && typeof logoUrl === "string" && logoUrl.startsWith("/objects/")) {
    const intent = consumeUploadIntent(logoUrl);
    const trustedContentType = intent?.contentType;
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(logoUrl);
      await objectStorageService.validateImageMagicBytes(objectFile, trustedContentType);
    } catch (err) {
      if (err instanceof InvalidImageError) {
        // Best-effort cleanup — delete the malicious/invalid file from storage.
        try {
          await objectStorageService.deleteObjectEntity(logoUrl);
        } catch (deleteErr) {
          req.log.warn({ err: deleteErr }, "Failed to delete invalid logo object");
        }
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof ObjectNotFoundError) {
        res.status(400).json({ error: "Logo file not found in storage" });
        return;
      }
      req.log.error({ err }, "Unexpected error validating logo image");
      res.status(500).json({ error: "Failed to validate logo file" });
      return;
    }
  }

  const update: Record<string, unknown> = {};
  if (logoUrl !== undefined) update.logoUrl = logoUrl ?? null;
  if (brandColor !== undefined) update.brandColor = brandColor ?? null;

  const [merchant] = await db.update(merchantsTable).set(update).where(eq(merchantsTable.id, id)).returning();
  if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }
  res.json(serializeMerchant(merchant));
});

// GET /api/merchants/:id/callback-secret  (admin only)
router.get("/:id/callback-secret", requireAdmin, async (req, res) => {
  const id = parseInt(req.params['id'] as string);
  const [merchant] = await db
    .select({ callbackSecret: merchantsTable.callbackSecret, callbackSecretUpdatedAt: merchantsTable.callbackSecretUpdatedAt })
    .from(merchantsTable).where(eq(merchantsTable.id, id)).limit(1);
  if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }
  const secret = merchant.callbackSecret;
  res.json({
    isSet: !!secret,
    secretPrefix: secret ? secret.slice(0, 8) + "..." : null,
    lastRotatedAt: merchant.callbackSecretUpdatedAt?.toISOString() ?? null,
  });
});

// DELETE /api/merchants/:id/callback-secret  (admin only — force-reset/clear)
router.delete("/:id/callback-secret", requireAdmin, async (req, res) => {
  const id = parseInt(req.params['id'] as string);
  const admin = (req as any).user;
  const [merchant] = await db
    .update(merchantsTable)
    .set({ callbackSecret: null, callbackSecretUpdatedAt: null, updatedAt: new Date() })
    .where(eq(merchantsTable.id, id))
    .returning();
  if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }
  await db.insert(auditLogsTable).values({
    adminId: admin.id,
    adminEmail: admin.email,
    action: "callback_secret_reset",
    targetType: "merchant",
    targetId: merchant.id,
    details: JSON.stringify({ businessName: merchant.businessName, email: merchant.email }),
    ipAddress: req.ip ?? null,
  });
  req.log.info({ adminId: admin.id, merchantId: id }, "Admin force-reset callback secret");
  sendCallbackSecretResetEmail({
    to: merchant.email,
    businessName: merchant.businessName,
    adminEmail: admin.email,
    resetAt: new Date(),
  }).catch((err) => req.log.error({ err, merchantId: id }, "Failed to send callback secret reset email"));
  res.json({ isSet: false, secretPrefix: null, lastRotatedAt: null });
});

// PATCH /api/merchants/:id/callback-window  (admin only)
router.patch("/:id/callback-window", requireAdmin, async (req, res) => {
  const id = parseInt(req.params['id'] as string);
  const admin = (req as any).user;
  const { windowSeconds } = req.body as { windowSeconds?: number | null };

  if (windowSeconds !== null && windowSeconds !== undefined) {
    if (!Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 86400) {
      res.status(400).json({ error: "windowSeconds must be an integer between 1 and 86400, or null to reset to default" });
      return;
    }
  }

  const [merchant] = await db
    .update(merchantsTable)
    .set({ callbackTimestampWindowSeconds: windowSeconds ?? null, updatedAt: new Date() })
    .where(eq(merchantsTable.id, id))
    .returning();
  if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }

  await db.insert(auditLogsTable).values({
    adminId: admin.id,
    adminEmail: admin.email,
    action: "callback_window_updated",
    targetType: "merchant",
    targetId: merchant.id,
    details: JSON.stringify({ businessName: merchant.businessName, email: merchant.email, callbackTimestampWindowSeconds: merchant.callbackTimestampWindowSeconds }),
    ipAddress: req.ip ?? null,
  });
  req.log.info({ adminId: admin.id, merchantId: id, windowSeconds: merchant.callbackTimestampWindowSeconds }, "Admin updated callback timestamp window");
  res.json(serializeMerchant(merchant));
});

// GET /api/merchants/:id/webhook-config  (admin only)
router.get("/:id/webhook-config", requireAdmin, async (req, res) => {
  const id = parseInt(req.params['id'] as string);
  const [globalConfig, webhook] = await Promise.all([
    loadWebhookRetryConfig(),
    db.select().from(webhooksTable).where(eq(webhooksTable.merchantId, id)).then(r => r[0]),
  ]);
  if (!webhook) { res.status(404).json({ error: "Webhook config not found for this merchant" }); return; }
  res.json({ ...webhook, globalMaxRetries: globalConfig.maxAttempts - 1 });
});

// PATCH /api/merchants/:id/webhook-max-retries  (admin only)
router.patch("/:id/webhook-max-retries", requireAdmin, async (req, res) => {
  const id = parseInt(req.params['id'] as string);
  const admin = (req as any).user;
  const { maxRetries } = req.body as { maxRetries?: number };

  if (!Number.isInteger(maxRetries) || (maxRetries as number) < 1 || (maxRetries as number) > 10) {
    res.status(400).json({ error: "maxRetries must be an integer between 1 and 10" });
    return;
  }

  const globalConfig = await loadWebhookRetryConfig();
  const globalMaxRetries = globalConfig.maxAttempts - 1;
  if ((maxRetries as number) > globalMaxRetries) {
    res.status(422).json({ error: `maxRetries cannot exceed the global cap of ${globalMaxRetries}` });
    return;
  }

  const [merchant] = await db
    .select({ id: merchantsTable.id, businessName: merchantsTable.businessName, email: merchantsTable.email })
    .from(merchantsTable)
    .where(eq(merchantsTable.id, id));
  if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }

  const [webhook] = await db
    .update(webhooksTable)
    .set({ maxRetries, updatedAt: new Date() })
    .where(eq(webhooksTable.merchantId, id))
    .returning();
  if (!webhook) { res.status(404).json({ error: "Webhook config not found for this merchant" }); return; }

  await db.insert(auditLogsTable).values({
    adminId: admin.id,
    adminEmail: admin.email,
    action: "webhook_max_retries_updated",
    targetType: "merchant",
    targetId: merchant.id,
    details: JSON.stringify({ businessName: merchant.businessName, email: merchant.email, maxRetries }),
    ipAddress: req.ip ?? null,
  });
  req.log.info({ adminId: admin.id, merchantId: id, maxRetries }, "Admin updated webhook max retries");
  res.json(webhook);
});

const KYC_REQUIRED_DOC_TYPES = ["pan", "gst", "bank_details", "business_proof"];

async function checkKycApproved(merchantId: number): Promise<{ passed: boolean; missing: string[] }> {
  const docs = await db
    .select({ docType: merchantKycTable.docType, status: merchantKycTable.status })
    .from(merchantKycTable)
    .where(eq(merchantKycTable.merchantId, merchantId));
  const missing = KYC_REQUIRED_DOC_TYPES.filter(
    dt => !docs.some(d => d.docType === dt && d.status === "approved")
  );
  return { passed: missing.length === 0, missing };
}

// POST /api/merchants/:id/approve
router.post("/:id/approve", requireAdmin, async (req, res) => {
  const id = parseInt(req.params['id'] as string);
  const admin = (req as any).user;

  const kyc = await checkKycApproved(id);
  if (!kyc.passed) {
    res.status(422).json({
      error: "KYC verification incomplete. All required documents must be approved before the merchant can be activated.",
      missingDocTypes: kyc.missing,
    });
    return;
  }

  const [merchant] = await db.update(merchantsTable)
    .set({ status: "approved", rejectionReason: null })
    .where(eq(merchantsTable.id, id)).returning();
  if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }
  await db.insert(auditLogsTable).values({
    adminId: admin.id,
    adminEmail: admin.email,
    action: "merchant_approved",
    targetType: "merchant",
    targetId: merchant.id,
    details: JSON.stringify({ businessName: merchant.businessName, email: merchant.email }),
    ipAddress: req.ip ?? null,
  });
  res.json(serializeMerchant(merchant));
});

// POST /api/merchants/:id/suspend
router.post("/:id/suspend", async (req, res) => {
  const id = parseInt(req.params['id'] as string);
  const [merchant] = await db
    .update(merchantsTable)
    .set({ status: "suspended" })
    .where(eq(merchantsTable.id, id))
    .returning();
  if (!merchant) {
    res.status(404).json({ error: "Merchant not found" });
    return;
  }
  res.json({
    ...merchant,
    totalDeposits: Number(merchant.totalDeposits),
    totalWithdrawals: Number(merchant.totalWithdrawals),
    balance: Number(merchant.balance),
  });
});

// POST /api/merchants/:id/unsuspend
router.post("/:id/unsuspend", async (req, res) => {
  const id = parseInt(req.params['id'] as string);
  const [merchant] = await db
    .update(merchantsTable)
    .set({ status: "approved" })
    .where(eq(merchantsTable.id, id))
    .returning();
  if (!merchant) {
    res.status(404).json({ error: "Merchant not found" });
    return;
  }
  res.json({
    ...merchant,
    totalDeposits: Number(merchant.totalDeposits),
    totalWithdrawals: Number(merchant.totalWithdrawals),
    balance: Number(merchant.balance),
  });
});

// POST /api/merchants/:id/reject
router.post("/:id/reject", requireAdmin, async (req, res) => {
  const id = parseInt(req.params['id'] as string);
  const admin = (req as any).user;
  const { reason } = req.body;
  if (!reason) { res.status(400).json({ error: "Rejection reason required" }); return; }
  const [merchant] = await db.update(merchantsTable)
    .set({ status: "rejected", rejectionReason: reason })
    .where(eq(merchantsTable.id, id)).returning();
  if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }
  await db.insert(auditLogsTable).values({
    adminId: admin.id,
    adminEmail: admin.email,
    action: "merchant_rejected",
    targetType: "merchant",
    targetId: merchant.id,
    details: JSON.stringify({ businessName: merchant.businessName, email: merchant.email, reason }),
    ipAddress: req.ip ?? null,
  });
  sendRejectionEmail({ to: merchant.email, businessName: merchant.businessName, reason }).catch(() => {});
  res.json(serializeMerchant(merchant));
});

// GET /api/merchants/:id/plan
router.get("/:id/plan", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const rows = await db.select({ mp: merchantPlansTable, plan: plansTable })
    .from(merchantPlansTable)
    .leftJoin(plansTable, eq(merchantPlansTable.planId, plansTable.id))
    .where(eq(merchantPlansTable.merchantId, id)).limit(1);
  if (rows.length === 0 || !rows[0].plan) { res.status(404).json({ error: "No plan assigned" }); return; }
  res.json(buildPlanResponse(rows[0].mp, rows[0].plan!));
});

// GET /api/merchants/:id/plan/usage
router.get("/:id/plan/usage", requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const usage = await getMerchantPlanUsage(id);
  if (!usage) { res.status(404).json({ error: "No plan assigned" }); return; }
  res.json(usage);
});

// GET /api/merchants/:id/plan/history
router.get("/:id/plan/history", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const rows = await db
    .select({ h: planHistoryTable, toPlan: { id: plansTable.id, name: plansTable.name } })
    .from(planHistoryTable)
    .leftJoin(plansTable, eq(planHistoryTable.toPlanId, plansTable.id))
    .where(eq(planHistoryTable.merchantId, id))
    .orderBy(desc(planHistoryTable.createdAt)).limit(50);
  res.json(rows.map(r => ({ ...r.h, toPlanName: r.toPlan?.name ?? null, createdAt: r.h.createdAt.toISOString(), expiresAt: r.h.expiresAt?.toISOString() ?? null })));
});

// POST /api/merchants/bulk-reject
router.post("/bulk-reject", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const { merchantIds, reason } = req.body;
  if (!Array.isArray(merchantIds) || merchantIds.length === 0) {
    res.status(400).json({ error: "merchantIds[] required" });
    return;
  }
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    res.status(400).json({ error: "reason is required" });
    return;
  }

  let updated = 0;
  let failed = 0;

  const emailQueue: { to: string; businessName: string; reason: string }[] = [];

  for (const merchantId of merchantIds as number[]) {
    try {
      const [merchant] = await db.update(merchantsTable)
        .set({ status: "rejected", rejectionReason: reason.trim() })
        .where(eq(merchantsTable.id, merchantId))
        .returning();
      if (!merchant) { failed++; continue; }
      await db.insert(auditLogsTable).values({
        adminId: user.id, adminEmail: user.email, action: "merchant_rejected",
        targetType: "merchant", targetId: merchantId,
        details: JSON.stringify({ reason: reason.trim(), bulk: true }),
        ipAddress: (req as any).ip ?? null,
      });
      emailQueue.push({ to: merchant.email, businessName: merchant.businessName, reason: reason.trim() });
      updated++;
    } catch {
      failed++;
    }
  }

  for (const mail of emailQueue) {
    sendRejectionEmail(mail).catch(() => {});
  }

  res.json({ updated, failed });
});

// POST /api/merchants/bulk-approve
router.post("/bulk-approve", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const { merchantIds } = req.body;
  if (!Array.isArray(merchantIds) || merchantIds.length === 0) {
    res.status(400).json({ error: "merchantIds[] required" });
    return;
  }

  let updated = 0;
  let failed = 0;
  const results: { id: number; name: string; success: boolean; reason: string | null }[] = [];

  for (const merchantId of merchantIds as number[]) {
    const [existing] = await db.select({ id: merchantsTable.id, businessName: merchantsTable.businessName, status: merchantsTable.status })
      .from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
    const name = existing?.businessName ?? `Merchant #${merchantId}`;
    try {
      if (!existing) {
        results.push({ id: merchantId, name, success: false, reason: "Not found" });
        failed++;
        continue;
      }
      if (existing.status === "approved") {
        results.push({ id: merchantId, name, success: false, reason: "Already approved" });
        failed++;
        continue;
      }
      const kyc = await checkKycApproved(merchantId);
      if (!kyc.passed) {
        results.push({ id: merchantId, name, success: false, reason: `KYC incomplete: missing approved docs for ${kyc.missing.join(", ")}` });
        failed++;
        continue;
      }
      await db.update(merchantsTable)
        .set({ status: "approved", rejectionReason: null })
        .where(eq(merchantsTable.id, merchantId));
      await db.insert(auditLogsTable).values({
        adminId: user.id, adminEmail: user.email, action: "merchant_approved",
        targetType: "merchant", targetId: merchantId,
        details: JSON.stringify({ bulk: true }),
        ipAddress: (req as any).ip ?? null,
      });
      results.push({ id: merchantId, name, success: true, reason: null });
      updated++;
    } catch {
      results.push({ id: merchantId, name, success: false, reason: "Unexpected error" });
      failed++;
    }
  }

  await db.insert(auditLogsTable).values({
    adminId: user.id, adminEmail: user.email, action: "bulk_approve",
    targetType: "merchant", targetId: null,
    details: JSON.stringify({ merchantIds, count: updated, failed, results }),
    ipAddress: (req as any).ip ?? null,
  });

  res.json({ updated, failed, results });
});

// POST /api/merchants/bulk-suspend
router.post("/bulk-suspend", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const { merchantIds, action } = req.body;
  if (!Array.isArray(merchantIds) || merchantIds.length === 0 || !["suspend", "reinstate"].includes(action)) {
    res.status(400).json({ error: "merchantIds[] and action (suspend|reinstate) required" });
    return;
  }

  const newStatus = action === "suspend" ? "suspended" : "approved";
  let updated = 0;
  let failed = 0;
  const results: { id: number; name: string; success: boolean; reason: string | null }[] = [];

  for (const merchantId of merchantIds as number[]) {
    const [existing] = await db.select({ id: merchantsTable.id, businessName: merchantsTable.businessName, status: merchantsTable.status })
      .from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
    const name = existing?.businessName ?? `Merchant #${merchantId}`;
    try {
      if (!existing) {
        results.push({ id: merchantId, name, success: false, reason: "Not found" });
        failed++;
        continue;
      }
      if (existing.status === newStatus) {
        const alreadyMsg = action === "suspend" ? "Already suspended" : "Already active";
        results.push({ id: merchantId, name, success: false, reason: alreadyMsg });
        failed++;
        continue;
      }
      await db.update(merchantsTable).set({ status: newStatus }).where(eq(merchantsTable.id, merchantId));
      await db.insert(auditLogsTable).values({
        adminId: user.id, adminEmail: user.email,
        action: action === "suspend" ? "merchant_suspended" : "merchant_reinstated",
        targetType: "merchant", targetId: merchantId,
        details: JSON.stringify({ bulk: true }),
        ipAddress: (req as any).ip ?? null,
      });
      results.push({ id: merchantId, name, success: true, reason: null });
      updated++;
    } catch {
      results.push({ id: merchantId, name, success: false, reason: "Unexpected error" });
      failed++;
    }
  }

  await db.insert(auditLogsTable).values({
    adminId: user.id, adminEmail: user.email,
    action: action === "suspend" ? "bulk_suspend" : "bulk_reinstate",
    targetType: "merchant", targetId: null,
    details: JSON.stringify({ merchantIds, count: updated, failed, results }),
    ipAddress: (req as any).ip ?? null,
  });

  res.json({ updated, failed, results });
});

// POST /api/merchants/bulk-assign-plan
router.post("/bulk-assign-plan", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const { merchantIds, planId, expiresAt, notes } = req.body;
  if (!planId || !Array.isArray(merchantIds) || merchantIds.length === 0) {
    res.status(400).json({ error: "planId and merchantIds[] required" });
    return;
  }

  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, planId)).limit(1);
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }

  const expiresAtDate = expiresAt ? new Date(expiresAt) : null;
  let updated = 0;
  let failed = 0;
  const results: { id: number; name: string; success: boolean; reason: string | null; previousPlanId: number | null }[] = [];

  for (const merchantId of merchantIds as number[]) {
    const [merchantRow] = await db.select({ id: merchantsTable.id, businessName: merchantsTable.businessName })
      .from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
    const name = merchantRow?.businessName ?? `Merchant #${merchantId}`;
    try {
      if (!merchantRow) {
        results.push({ id: merchantId, name, success: false, reason: "Not found", previousPlanId: null });
        failed++;
        continue;
      }
      const existing = await db.select().from(merchantPlansTable).where(eq(merchantPlansTable.merchantId, merchantId)).limit(1);
      const fromPlanId = existing.length > 0 ? existing[0].planId : null;
      const updateSet: Record<string, unknown> = { planId, assignedBy: user.id, notes: notes ?? null, status: "active" };
      if (expiresAtDate) updateSet.expiresAt = expiresAtDate;

      if (existing.length > 0) {
        await db.update(merchantPlansTable).set(updateSet).where(eq(merchantPlansTable.merchantId, merchantId));
      } else {
        await db.insert(merchantPlansTable).values({
          merchantId, planId, assignedBy: user.id,
          expiresAt: expiresAtDate ?? undefined, notes: notes ?? null,
        });
      }

      const action = fromPlanId === null ? "assigned" : fromPlanId === planId ? "renewed" : planId > fromPlanId ? "upgraded" : "downgraded";
      await logPlanHistory({ merchantId, fromPlanId, toPlanId: planId, action, adminId: user.id, adminEmail: user.email, notes });
      await db.insert(auditLogsTable).values({
        adminId: user.id, adminEmail: user.email, action: `plan_${action}`,
        targetType: "merchant", targetId: merchantId,
        details: JSON.stringify({ planName: plan.name, fromPlanId, toPlanId: planId, bulk: true }),
        ipAddress: (req as any).ip ?? null,
      });
      results.push({ id: merchantId, name, success: true, reason: null, previousPlanId: fromPlanId });
      updated++;
    } catch {
      results.push({ id: merchantId, name, success: false, reason: "Unexpected error", previousPlanId: null });
      failed++;
    }
  }

  await db.insert(auditLogsTable).values({
    adminId: user.id, adminEmail: user.email, action: "bulk_assign_plan",
    targetType: "merchant", targetId: null,
    details: JSON.stringify({ merchantIds, planId, planName: plan.name, count: updated, failed, results }),
    ipAddress: (req as any).ip ?? null,
  });

  res.json({ updated, failed, results });
});

// POST /api/merchants/bulk-unassign-plan
router.post("/bulk-unassign-plan", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const { merchantIds } = req.body;
  if (!Array.isArray(merchantIds) || merchantIds.length === 0) {
    res.status(400).json({ error: "merchantIds[] required" });
    return;
  }

  let updated = 0;
  let failed = 0;
  const results: { id: number; name: string; success: boolean; reason: string | null; previousPlanId: number | null }[] = [];

  for (const merchantId of merchantIds as number[]) {
    const [merchantRow] = await db.select({ id: merchantsTable.id, businessName: merchantsTable.businessName })
      .from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
    const name = merchantRow?.businessName ?? `Merchant #${merchantId}`;
    try {
      if (!merchantRow) {
        results.push({ id: merchantId, name, success: false, reason: "Not found", previousPlanId: null });
        failed++;
        continue;
      }
      const [existing] = await db.select().from(merchantPlansTable).where(eq(merchantPlansTable.merchantId, merchantId)).limit(1);
      if (!existing) {
        results.push({ id: merchantId, name, success: false, reason: "No plan assigned", previousPlanId: null });
        failed++;
        continue;
      }
      const previousPlanId = existing.planId;
      await db.delete(merchantPlansTable).where(eq(merchantPlansTable.merchantId, merchantId));
      await logPlanHistory({ merchantId, fromPlanId: previousPlanId, toPlanId: null, action: "removed", adminId: user.id, adminEmail: user.email });
      await db.insert(auditLogsTable).values({
        adminId: user.id, adminEmail: user.email, action: "plan_removed",
        targetType: "merchant", targetId: merchantId,
        details: JSON.stringify({ fromPlanId: previousPlanId, bulk: true }),
        ipAddress: (req as any).ip ?? null,
      });
      results.push({ id: merchantId, name, success: true, reason: null, previousPlanId });
      updated++;
    } catch {
      results.push({ id: merchantId, name, success: false, reason: "Unexpected error", previousPlanId: null });
      failed++;
    }
  }

  await db.insert(auditLogsTable).values({
    adminId: user.id, adminEmail: user.email, action: "bulk_unassign_plan",
    targetType: "merchant", targetId: null,
    details: JSON.stringify({ merchantIds, count: updated, failed }),
    ipAddress: (req as any).ip ?? null,
  });

  res.json({ updated, failed, results });
});

// POST /api/merchants/:id/assign-plan
router.post("/:id/assign-plan", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id as string);
  const { planId, expiresAt, notes, scheduledRenewalAt } = req.body;
  if (!planId) { res.status(400).json({ error: "planId required" }); return; }

  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, planId)).limit(1);
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }
  const [merchant] = await db.select().from(merchantsTable).where(eq(merchantsTable.id, id)).limit(1);
  if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }

  const existing = await db.select().from(merchantPlansTable).where(eq(merchantPlansTable.merchantId, id)).limit(1);
  const fromPlanId = existing.length > 0 ? existing[0].planId : null;
  const expiresAtDate = expiresAt ? new Date(expiresAt) : null;
  const scheduledRenewalAtDate = scheduledRenewalAt ? new Date(scheduledRenewalAt) : null;
  const updateSet: Record<string, unknown> = { planId, assignedBy: user.id, notes: notes ?? null, status: "active", scheduledRenewalAt: scheduledRenewalAtDate };
  if (expiresAtDate) updateSet.expiresAt = expiresAtDate;

  let result;
  if (existing.length > 0) {
    [result] = await db.update(merchantPlansTable).set(updateSet).where(eq(merchantPlansTable.merchantId, id)).returning();
  } else {
    [result] = await db.insert(merchantPlansTable).values({
      merchantId: id, planId, assignedBy: user.id,
      expiresAt: expiresAtDate ?? undefined, notes: notes ?? null,
      scheduledRenewalAt: scheduledRenewalAtDate ?? undefined,
    }).returning();
  }

  const action = fromPlanId === null ? "assigned" : fromPlanId === planId ? "renewed" : planId > fromPlanId ? "upgraded" : "downgraded";
  await logPlanHistory({ merchantId: id, fromPlanId, toPlanId: planId, action, adminId: user.id, adminEmail: user.email, notes, expiresAt: expiresAtDate });
  await db.insert(auditLogsTable).values({
    adminId: user.id, adminEmail: user.email, action: `plan_${action}`,
    targetType: "merchant", targetId: id,
    details: JSON.stringify({ planName: plan.name, fromPlanId, toPlanId: planId, scheduledRenewalAt: scheduledRenewalAtDate?.toISOString() ?? null }),
    ipAddress: (req as any).ip ?? null,
  });

  res.json({ ...result, planName: plan.name, expiresAt: result.expiresAt ?? null, scheduledRenewalAt: result.scheduledRenewalAt?.toISOString() ?? null });
});

// POST /api/merchants/:id/plan/upgrade
router.post("/:id/plan/upgrade", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id as string);
  const { planId, expiresAt, notes } = req.body;
  if (!planId) { res.status(400).json({ error: "planId required" }); return; }

  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, planId)).limit(1);
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }
  const existing = await db.select().from(merchantPlansTable).where(eq(merchantPlansTable.merchantId, id)).limit(1);
  const fromPlanId = existing.length > 0 ? existing[0].planId : null;
  const expiresAtDate = expiresAt ? new Date(expiresAt) : null;
  const set: Record<string, unknown> = { planId, assignedBy: user.id, notes: notes ?? null, status: "active" };
  if (expiresAtDate) set.expiresAt = expiresAtDate;

  let result;
  if (existing.length > 0) {
    [result] = await db.update(merchantPlansTable).set(set).where(eq(merchantPlansTable.merchantId, id)).returning();
  } else {
    [result] = await db.insert(merchantPlansTable).values({ merchantId: id, planId, assignedBy: user.id, expiresAt: expiresAtDate ?? undefined }).returning();
  }
  await logPlanHistory({ merchantId: id, fromPlanId, toPlanId: planId, action: "upgraded", adminId: user.id, adminEmail: user.email, notes, expiresAt: expiresAtDate });
  res.json({ ...result, planName: plan.name, expiresAt: result.expiresAt ?? null });
});

// POST /api/merchants/:id/plan/downgrade
router.post("/:id/plan/downgrade", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id as string);
  const { planId, expiresAt, notes } = req.body;
  if (!planId) { res.status(400).json({ error: "planId required" }); return; }

  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, planId)).limit(1);
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }
  const existing = await db.select().from(merchantPlansTable).where(eq(merchantPlansTable.merchantId, id)).limit(1);
  const fromPlanId = existing.length > 0 ? existing[0].planId : null;
  const expiresAtDate = expiresAt ? new Date(expiresAt) : null;
  const set: Record<string, unknown> = { planId, assignedBy: user.id, notes: notes ?? null, status: "active" };
  if (expiresAtDate) set.expiresAt = expiresAtDate;

  let result;
  if (existing.length > 0) {
    [result] = await db.update(merchantPlansTable).set(set).where(eq(merchantPlansTable.merchantId, id)).returning();
  } else {
    [result] = await db.insert(merchantPlansTable).values({ merchantId: id, planId, assignedBy: user.id, expiresAt: expiresAtDate ?? undefined }).returning();
  }
  await logPlanHistory({ merchantId: id, fromPlanId, toPlanId: planId, action: "downgraded", adminId: user.id, adminEmail: user.email, notes, expiresAt: expiresAtDate });
  res.json({ ...result, planName: plan.name, expiresAt: result.expiresAt ?? null });
});

// POST /api/merchants/:id/plan/suspend
router.post("/:id/plan/suspend", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id as string);
  const { notes } = req.body ?? {};

  const existing = await db.select().from(merchantPlansTable).where(eq(merchantPlansTable.merchantId, id)).limit(1);
  if (existing.length === 0) { res.status(404).json({ error: "No plan assigned" }); return; }

  const [result] = await db.update(merchantPlansTable)
    .set({ status: "suspended", notes: notes ?? existing[0].notes })
    .where(eq(merchantPlansTable.merchantId, id)).returning();
  await logPlanHistory({ merchantId: id, fromPlanId: existing[0].planId, toPlanId: existing[0].planId, action: "suspended", adminId: user.id, adminEmail: user.email, notes });
  res.json({ ...result, expiresAt: result.expiresAt ?? null });
});

// POST /api/merchants/:id/plan/reinstate
router.post("/:id/plan/reinstate", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id as string);
  const { notes } = req.body ?? {};

  const existing = await db.select().from(merchantPlansTable).where(eq(merchantPlansTable.merchantId, id)).limit(1);
  if (existing.length === 0) { res.status(404).json({ error: "No plan assigned" }); return; }

  const [result] = await db.update(merchantPlansTable)
    .set({ status: "active", notes: notes ?? existing[0].notes })
    .where(eq(merchantPlansTable.merchantId, id)).returning();
  await logPlanHistory({ merchantId: id, fromPlanId: existing[0].planId, toPlanId: existing[0].planId, action: "reinstated", adminId: user.id, adminEmail: user.email, notes });
  res.json({ ...result, expiresAt: result.expiresAt ?? null });
});

// POST /api/merchants/:id/plan/renew
router.post("/:id/plan/renew", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id as string);
  const { expiresAt, notes, scheduledRenewalAt } = req.body;
  if (!expiresAt) { res.status(400).json({ error: "expiresAt required" }); return; }

  const existing = await db.select().from(merchantPlansTable).where(eq(merchantPlansTable.merchantId, id)).limit(1);
  if (existing.length === 0) { res.status(404).json({ error: "No plan assigned" }); return; }

  const scheduledRenewalAtDate = scheduledRenewalAt !== undefined
    ? (scheduledRenewalAt ? new Date(scheduledRenewalAt) : null)
    : existing[0].scheduledRenewalAt;

  const [result] = await db.update(merchantPlansTable)
    .set({ expiresAt: new Date(expiresAt), status: "active", renewedAt: new Date(), notes: notes ?? existing[0].notes, scheduledRenewalAt: scheduledRenewalAtDate })
    .where(eq(merchantPlansTable.merchantId, id)).returning();
  await logPlanHistory({ merchantId: id, fromPlanId: existing[0].planId, toPlanId: existing[0].planId, action: "renewed", adminId: user.id, adminEmail: user.email, notes });
  res.json({ ...result, expiresAt: result.expiresAt ?? null, scheduledRenewalAt: result.scheduledRenewalAt?.toISOString() ?? null });
});

// POST /api/merchants/:id/plan/schedule-renewal
router.post("/:id/plan/schedule-renewal", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id as string);
  const { scheduledRenewalAt } = req.body;

  const existing = await db.select().from(merchantPlansTable).where(eq(merchantPlansTable.merchantId, id)).limit(1);
  if (existing.length === 0) { res.status(404).json({ error: "No plan assigned" }); return; }

  const scheduledRenewalAtDate = scheduledRenewalAt ? new Date(scheduledRenewalAt) : null;

  const [result] = await db.update(merchantPlansTable)
    .set({ scheduledRenewalAt: scheduledRenewalAtDate })
    .where(eq(merchantPlansTable.merchantId, id)).returning();

  await db.insert(auditLogsTable).values({
    adminId: user.id, adminEmail: user.email,
    action: scheduledRenewalAtDate ? "plan_renewal_scheduled" : "plan_renewal_cancelled",
    targetType: "merchant", targetId: id,
    details: JSON.stringify({ scheduledRenewalAt: scheduledRenewalAtDate?.toISOString() ?? null }),
    ipAddress: (req as any).ip ?? null,
  });

  res.json({ ...result, expiresAt: result.expiresAt ?? null, scheduledRenewalAt: result.scheduledRenewalAt?.toISOString() ?? null });
});

// GET /api/merchants/:id/invoices (admin only)
router.get("/:id/invoices", requireAdmin, async (req, res) => {
  const merchantId = parseInt(req.params.id as string);
  const { status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [eq(invoicesTable.merchantId, merchantId)];
  if (status && status !== "all") conditions.push(eq(invoicesTable.status, status));
  const where = and(...conditions);

  const [{ total }] = await db.select({ total: count() }).from(invoicesTable).where(where);
  const rows = await db.select({
    inv: invoicesTable,
    planName: plansTable.name,
  })
    .from(invoicesTable)
    .leftJoin(plansTable, eq(invoicesTable.planId, plansTable.id))
    .where(where)
    .orderBy(desc(invoicesTable.createdAt))
    .limit(limitNum).offset(offset);

  const data = rows.map(r => ({
    ...r.inv,
    amount: r.inv.amount,
    paidAt: r.inv.paidAt?.toISOString() ?? null,
    dueDate: r.inv.dueDate?.toISOString() ?? null,
    periodFrom: r.inv.periodFrom?.toISOString() ?? null,
    periodTo: r.inv.periodTo?.toISOString() ?? null,
    createdAt: r.inv.createdAt.toISOString(),
    updatedAt: r.inv.updatedAt.toISOString(),
    planName: r.planName ?? null,
    merchantName: null,
    merchantEmail: null,
  }));

  res.json({ data, total, page: pageNum, limit: limitNum });
});

// GET /api/merchants/:id/credential-events
router.get("/:id/credential-events", requireAdmin, async (req, res) => {
  const merchantId = parseInt(req.params['id'] as string);
  const { eventType } = req.query as Record<string, string>;

  const [merchant] = await db.select({ id: merchantsTable.id, callbackSecretUpdatedAt: merchantsTable.callbackSecretUpdatedAt })
    .from(merchantsTable)
    .where(eq(merchantsTable.id, merchantId))
    .limit(1);

  if (!merchant) {
    res.status(404).json({ error: "Merchant not found" });
    return;
  }

  // Map filter param to DB event type values
  const eventTypeMap: Record<string, string[]> = {
    key_generated: ["api_key_generated"],
    key_revoked: ["api_key_revoked"],
    secret_rotated: ["callback_secret_rotated"],
  };
  const dbEventTypes = eventType && eventTypeMap[eventType] ? eventTypeMap[eventType] : null;

  const conditions = [eq(credentialEventsTable.merchantId, merchantId)];
  if (dbEventTypes) {
    conditions.push(inArray(credentialEventsTable.eventType, dbEventTypes));
  } else {
    // Exclude any future unknown event types by filtering to known ones only
    conditions.push(inArray(credentialEventsTable.eventType, ["api_key_generated", "api_key_revoked", "callback_secret_rotated"]));
  }

  const rows = await db.select({
    eventType: credentialEventsTable.eventType,
    keyPrefix: credentialEventsTable.keyPrefix,
    ipAddress: credentialEventsTable.ipAddress,
    actorEmail: credentialEventsTable.actorEmail,
    createdAt: credentialEventsTable.createdAt,
  })
    .from(credentialEventsTable)
    .where(and(...conditions))
    .orderBy(desc(credentialEventsTable.createdAt));

  const events = rows.map(r => {
    const displayType =
      r.eventType === "api_key_generated" ? "key_generated"
      : r.eventType === "api_key_revoked" ? "key_revoked"
      : "secret_rotated";
    return {
      eventType: displayType,
      keyPrefix: r.keyPrefix ?? null,
      occurredAt: r.createdAt.toISOString(),
      ipAddress: r.ipAddress ? maskIp(r.ipAddress) : null,
      actorEmail: r.actorEmail ?? null,
    };
  });

  res.json(events);
});

// GET /api/merchants/:id/plan/email-preview — admin: preview plan notification email (no email sent)
router.get("/:id/plan/email-preview", requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const variant = req.query["variant"] as string | undefined;
    if (!variant || !["assigned", "suspended", "reinstated"].includes(variant)) {
      res.status(400).json({ error: "variant must be one of: assigned, suspended, reinstated" });
      return;
    }

    const [merchant] = await db
      .select({ id: merchantsTable.id, businessName: merchantsTable.businessName })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, id))
      .limit(1);
    if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }

    const rawPlanId = req.query["planId"] as string | undefined;
    const planIdOverride = rawPlanId ? parseInt(rawPlanId) : null;
    const notesOverride = (req.query["notes"] as string | undefined) ?? null;
    const expiresAtOverride = (req.query["expiresAt"] as string | undefined) ?? null;

    let planName: string;

    if (planIdOverride && !isNaN(planIdOverride)) {
      const [planRow] = await db.select({ name: plansTable.name }).from(plansTable).where(eq(plansTable.id, planIdOverride)).limit(1);
      planName = planRow?.name ?? "Selected Plan";
    } else {
      const [mp] = await db
        .select({ name: plansTable.name })
        .from(merchantPlansTable)
        .innerJoin(plansTable, eq(merchantPlansTable.planId, plansTable.id))
        .where(eq(merchantPlansTable.merchantId, id))
        .limit(1);
      planName = mp?.name ?? "Your Plan";
    }

    const businessName = merchant.businessName;

    if (variant === "assigned") {
      const expiresAt = expiresAtOverride ?? null;
      const html = buildPlanAssignedHtml({ businessName, planName, expiresAt, notes: notesOverride });
      const subject = `[RasoKart] Your ${planName} plan is now active`;
      res.json({ html, subject });
    } else if (variant === "suspended") {
      const html = buildPlanSuspendedHtml({ businessName, planName, notes: notesOverride });
      const subject = `[RasoKart] Your ${planName} plan has been suspended`;
      res.json({ html, subject });
    } else {
      const html = buildPlanReinstatedHtml({ businessName, planName, notes: notesOverride });
      const subject = `[RasoKart] Your ${planName} plan has been reinstated`;
      res.json({ html, subject });
    }
  } catch (err) {
    next(err);
  }
});

export default router;
