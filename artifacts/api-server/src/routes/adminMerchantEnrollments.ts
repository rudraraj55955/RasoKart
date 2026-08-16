/**
 * Admin Merchant Enrollment Review — /api/admin/merchant-enrollments
 *
 * Super Admin routes for reviewing and activating merchant-submitted provider
 * credentials (Category D). Status changes are audit-logged and trigger a
 * merchant email notification.
 *
 * Security contract:
 *   - All routes require Super Admin (requireAuth + requireAdmin + requireSuperAdmin)
 *   - Credential values are NEVER returned in any response (presence shown as bool only)
 *   - Audit log written on every status change (action = "admin_enrollment_status_change")
 *   - Merchant email sent on activate or suspend
 */

import { Router } from "express";
import {
  db,
  merchantProviderEnrollmentsTable,
  merchantsTable,
  auditLogsTable,
} from "@workspace/db";
import { eq, and, desc, count, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin, requireSuperAdmin } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { notifyMerchantOfEnrollmentStatusChange } from "../helpers/adminNotifyEmail";

const router = Router();
router.use(requireAuth, requireAdmin, requireSuperAdmin);

/** Public-safe shape for admin view — never exposes encrypted credential blobs. */
function formatEnrollmentForAdmin(
  row: typeof merchantProviderEnrollmentsTable.$inferSelect & {
    merchantBusinessName?: string | null;
    merchantEmail?: string | null;
  }
) {
  return {
    id: row.id,
    merchantId: row.merchantId,
    merchantBusinessName: row.merchantBusinessName ?? null,
    merchantEmail: row.merchantEmail ?? null,
    providerSlug: row.providerSlug,
    enrollmentStatus: row.enrollmentStatus,
    maskedIdentifier: row.maskedIdentifier,
    onboardingUrl: row.onboardingUrl,
    // Credential presence only — never the values
    hasApiKey: !!(row.encryptedApiKey && row.encryptedApiKey.trim() !== ""),
    hasApiSecret: !!(row.encryptedApiSecret && row.encryptedApiSecret.trim() !== ""),
    hasWebhookSecret: !!(row.encryptedWebhookSecret && row.encryptedWebhookSecret.trim() !== ""),
    connectedAt: row.connectedAt,
    lastVerifiedAt: row.lastVerifiedAt,
    disconnectedAt: row.disconnectedAt,
    disconnectedBy: row.disconnectedBy,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── GET /api/admin/merchant-enrollments ───────────────────────────────────────
// List all merchant enrollments. Default filter: credentials_submitted (pending
// review). Supports ?status=all|active|suspended|credentials_submitted|etc.
// Supports ?page=&limit=
router.get("/", async (req, res) => {
  try {
    const {
      status,
      page = "1",
      limit = "50",
      providerSlug,
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];

    // Default to credentials_submitted if no status filter given
    const statusFilter = status && status !== "all" ? status : "credentials_submitted";
    if (statusFilter !== "all") {
      conditions.push(eq(merchantProviderEnrollmentsTable.enrollmentStatus, statusFilter));
    }
    if (providerSlug) {
      conditions.push(eq(merchantProviderEnrollmentsTable.providerSlug, providerSlug));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          id: merchantProviderEnrollmentsTable.id,
          merchantId: merchantProviderEnrollmentsTable.merchantId,
          providerSlug: merchantProviderEnrollmentsTable.providerSlug,
          enrollmentStatus: merchantProviderEnrollmentsTable.enrollmentStatus,
          maskedIdentifier: merchantProviderEnrollmentsTable.maskedIdentifier,
          onboardingUrl: merchantProviderEnrollmentsTable.onboardingUrl,
          encryptedApiKey: merchantProviderEnrollmentsTable.encryptedApiKey,
          encryptedApiSecret: merchantProviderEnrollmentsTable.encryptedApiSecret,
          encryptedWebhookSecret: merchantProviderEnrollmentsTable.encryptedWebhookSecret,
          connectedAt: merchantProviderEnrollmentsTable.connectedAt,
          lastVerifiedAt: merchantProviderEnrollmentsTable.lastVerifiedAt,
          disconnectedAt: merchantProviderEnrollmentsTable.disconnectedAt,
          disconnectedBy: merchantProviderEnrollmentsTable.disconnectedBy,
          failureReason: merchantProviderEnrollmentsTable.failureReason,
          createdAt: merchantProviderEnrollmentsTable.createdAt,
          updatedAt: merchantProviderEnrollmentsTable.updatedAt,
          // Join merchant info
          merchantBusinessName: merchantsTable.businessName,
          merchantEmail: merchantsTable.email,
        })
        .from(merchantProviderEnrollmentsTable)
        .leftJoin(
          merchantsTable,
          eq(merchantProviderEnrollmentsTable.merchantId, merchantsTable.id)
        )
        .where(where as any)
        .orderBy(desc(merchantProviderEnrollmentsTable.updatedAt))
        .limit(limitNum)
        .offset(offset),
      db
        .select({ total: count() })
        .from(merchantProviderEnrollmentsTable)
        .where(where as any),
    ]);

    res.json({
      enrollments: rows.map(formatEnrollmentForAdmin),
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    logger.error({ err }, "GET /admin/merchant-enrollments failed");
    res.status(500).json({ error: "Failed to fetch enrollments" });
  }
});

// ── GET /api/admin/merchant-enrollments/pending-count ────────────────────────
// Quick count of enrollments awaiting review.
router.get("/pending-count", async (req, res) => {
  try {
    const [{ total }] = await db
      .select({ total: count() })
      .from(merchantProviderEnrollmentsTable)
      .where(eq(merchantProviderEnrollmentsTable.enrollmentStatus, "credentials_submitted"));
    res.json({ count: total });
  } catch (err) {
    logger.error({ err }, "GET /admin/merchant-enrollments/pending-count failed");
    res.status(500).json({ error: "Failed to count pending enrollments" });
  }
});

// ── PUT /api/admin/merchant/:merchantId/enrollments/:providerSlug/status ──────
// Update a merchant's enrollment status. Allowed transitions:
//   credentials_submitted → active | suspended
//   active → suspended
//   suspended → active
// Writes audit log and sends merchant email notification.
router.put("/:merchantId/enrollments/:providerSlug/status", async (req, res) => {
  const admin = (req as any).user;

  const merchantId = parseInt(req.params["merchantId"] as string);
  const providerSlug = req.params["providerSlug"] as string;

  if (!merchantId || isNaN(merchantId)) {
    res.status(400).json({ error: "Invalid merchantId" });
    return;
  }
  if (!providerSlug) {
    res.status(400).json({ error: "providerSlug is required" });
    return;
  }

  const { status, reason } = req.body as { status?: string; reason?: string };

  const ALLOWED_STATUSES = ["active", "suspended"];
  if (!status || !ALLOWED_STATUSES.includes(status)) {
    res.status(400).json({
      error: `status must be one of: ${ALLOWED_STATUSES.join(", ")}`,
    });
    return;
  }

  try {
    // Fetch the existing enrollment
    const [existing] = await db
      .select({
        id: merchantProviderEnrollmentsTable.id,
        enrollmentStatus: merchantProviderEnrollmentsTable.enrollmentStatus,
        providerSlug: merchantProviderEnrollmentsTable.providerSlug,
        merchantId: merchantProviderEnrollmentsTable.merchantId,
      })
      .from(merchantProviderEnrollmentsTable)
      .where(
        and(
          eq(merchantProviderEnrollmentsTable.merchantId, merchantId),
          eq(merchantProviderEnrollmentsTable.providerSlug, providerSlug)
        )
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Enrollment not found for this merchant and provider" });
      return;
    }

    // Validate allowed source statuses
    const SOURCE_STATUSES = ["credentials_submitted", "active", "suspended"];
    if (!SOURCE_STATUSES.includes(existing.enrollmentStatus)) {
      res.status(422).json({
        error: `Cannot change status from '${existing.enrollmentStatus}'. Enrollment must be in credentials_submitted, active, or suspended state.`,
      });
      return;
    }

    // Build the update payload
    const now = new Date();
    const updatePayload: Record<string, unknown> = {
      enrollmentStatus: status,
      updatedAt: now,
      failureReason: status === "suspended" ? (reason?.trim() ?? null) : null,
    };

    if (status === "active") {
      updatePayload["connectedAt"] = now;
      updatePayload["disconnectedAt"] = null;
      updatePayload["disconnectedBy"] = null;
    } else if (status === "suspended") {
      updatePayload["disconnectedAt"] = now;
      updatePayload["disconnectedBy"] = "admin";
    }

    const [updated] = await db
      .update(merchantProviderEnrollmentsTable)
      .set(updatePayload)
      .where(
        and(
          eq(merchantProviderEnrollmentsTable.merchantId, merchantId),
          eq(merchantProviderEnrollmentsTable.providerSlug, providerSlug)
        )
      )
      .returning();

    // Fetch merchant info for the audit log and email
    const [merchant] = await db
      .select({ email: merchantsTable.email, businessName: merchantsTable.businessName })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, merchantId))
      .limit(1);

    // Write audit log
    await db
      .insert(auditLogsTable)
      .values({
        adminId: admin.id,
        adminEmail: admin.email,
        action: "admin_enrollment_status_change",
        targetType: "merchant_provider_enrollment",
        targetId: existing.id,
        details: JSON.stringify({
          merchantId,
          providerSlug,
          previousStatus: existing.enrollmentStatus,
          newStatus: status,
          reason: reason?.trim() ?? null,
          merchantEmail: merchant?.email ?? null,
        }),
        ipAddress: (req as any).ip ?? null,
      } as any)
      .catch((err: any) => {
        logger.warn({ err }, "Failed to write enrollment status change audit log");
      });

    // Send merchant email notification (fire-and-forget)
    if (merchant?.email) {
      notifyMerchantOfEnrollmentStatusChange({
        merchantId,
        merchantEmail: merchant.email,
        merchantBusinessName: merchant.businessName ?? "",
        providerSlug,
        newStatus: status as "active" | "suspended",
        reason: reason?.trim() ?? null,
        adminEmail: admin.email,
      }).catch((err: any) => {
        logger.warn({ err, merchantId, providerSlug }, "Failed to send merchant enrollment status email");
      });
    }

    logger.info(
      { merchantId, providerSlug, newStatus: status, adminId: admin.id },
      "admin_enrollment_status_change"
    );

    res.json({
      enrollment: formatEnrollmentForAdmin({
        ...updated,
        merchantBusinessName: merchant?.businessName ?? null,
        merchantEmail: merchant?.email ?? null,
      }),
    });
  } catch (err) {
    logger.error({ err, merchantId, providerSlug }, "PUT /admin/merchant-enrollments/:merchantId/enrollments/:providerSlug/status failed");
    res.status(500).json({ error: "Failed to update enrollment status" });
  }
});

export default router;
