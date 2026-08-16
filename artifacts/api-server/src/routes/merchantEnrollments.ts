/**
 * Merchant Provider Enrollment routes — /api/merchant/enrollments
 *
 * Allows merchants to self-service enroll with payment providers that require
 * official API partnerships (Category D). All credential handling follows the
 * same AES-256-GCM encryption pattern as merchant_connections.
 *
 * Security contract:
 *   - Credentials encrypted before DB write (encryptSecret)
 *   - Credentials NEVER returned in any API response (masked as "***")
 *   - All routes enforce merchantId === req.user.merchantId (tenant isolation)
 *   - Non-secret audit log written on every connect/update/disconnect
 *   - Rate limiting: 10 POST/PUT per hour per merchant (separate store instance)
 *   - No OTP interception, no CAPTCHA bypass, no automated provider login
 */

import { Router } from "express";
import {
  db,
  merchantProviderEnrollmentsTable,
  merchantsTable,
  auditLogsTable,
} from "@workspace/db";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { encryptSecret } from "../helpers/cryptoUtils";
import { logger } from "../lib/logger";
import { DbRateLimitStore } from "../lib/rateLimitStore";
import { makeRateLimiter, safeIpKey } from "../helpers/makeRateLimiter";
import {
  PROVIDER_ONBOARDING_METADATA,
  toPublicOnboardingInfo,
} from "../helpers/providerOnboardingMetadata";
import { notifyAdminsOfNewEnrollmentSubmission } from "../helpers/adminNotifyEmail";

const router = Router();
router.use(requireAuth);

// ── Rate limiter (separate store — never reuse singleton) ─────────────────────
// 10 enroll/credential-submit attempts per hour per merchant
const enrollRateLimiter = makeRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  store: new DbRateLimitStore(),
  message: { error: "Too many enrollment attempts. Please wait an hour before trying again." },
  keyGenerator: (req: any) =>
    `merchant-enroll:${safeIpKey(req)}:${req.user?.merchantId ?? "anon"}`,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function requireMerchant(req: any, res: any): number | null {
  const user = req.user;
  if (!user || !user.merchantId) {
    res.status(403).json({ error: "Merchant account required" });
    return null;
  }
  return user.merchantId as number;
}

/** Mask: return "***" if a credential field is present, null otherwise. */
function maskField(value: string | null | undefined): string | null {
  if (!value || value.trim() === "") return null;
  return "***";
}

/** Public-safe shape — never exposes encrypted credential blobs. */
function formatEnrollment(row: typeof merchantProviderEnrollmentsTable.$inferSelect) {
  const meta = PROVIDER_ONBOARDING_METADATA[row.providerSlug];
  return {
    id: row.id,
    providerSlug: row.providerSlug,
    enrollmentStatus: row.enrollmentStatus,
    maskedIdentifier: row.maskedIdentifier,
    onboardingUrl: row.onboardingUrl,
    // Credential presence indicators — never the values
    hasApiKey:        maskField(row.encryptedApiKey) !== null,
    hasApiSecret:     maskField(row.encryptedApiSecret) !== null,
    hasWebhookSecret: maskField(row.encryptedWebhookSecret) !== null,
    connectedAt:     row.connectedAt,
    lastVerifiedAt:  row.lastVerifiedAt,
    disconnectedAt:  row.disconnectedAt,
    disconnectedBy:  row.disconnectedBy,
    failureReason:   row.failureReason,
    createdAt:       row.createdAt,
    updatedAt:       row.updatedAt,
    // Onboarding metadata (public subset only)
    onboardingInfo: meta ? toPublicOnboardingInfo(meta) : null,
  };
}

/** Write a non-secret audit log entry for enrollment events. */
async function writeEnrollmentAudit(
  merchantId: number,
  userId: number,
  userEmail: string,
  action: string,
  providerSlug: string,
  details: Record<string, unknown>,
  ip: string | null
): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      adminId: userId,
      adminEmail: userEmail,
      action,
      targetType: "merchant_provider_enrollment",
      targetId: undefined,
      details: JSON.stringify({
        merchantId,
        providerSlug,
        ...details,
        // Never include credential values — only boolean presence flags
      }),
      ipAddress: ip,
    });
  } catch (err) {
    logger.warn({ err, action, providerSlug }, "Failed to write enrollment audit log");
  }
}

// ── GET /api/merchant/enrollments ─────────────────────────────────────────────
// List all enrollments for the authenticated merchant (masked).
router.get("/", async (req, res) => {
  const merchantId = requireMerchant(req, res);
  if (!merchantId) return;

  try {
    const rows = await db
      .select()
      .from(merchantProviderEnrollmentsTable)
      .where(eq(merchantProviderEnrollmentsTable.merchantId, merchantId));

    const formatted = rows.map(formatEnrollment);

    // Inject onboarding metadata for all known providers not yet enrolled
    const enrolled = new Set(rows.map(r => r.providerSlug));
    const notEnrolled = Object.values(PROVIDER_ONBOARDING_METADATA)
      .filter(m => !enrolled.has(m.slug))
      .map(m => ({
        id: null,
        providerSlug: m.slug,
        enrollmentStatus: "not_enrolled",
        maskedIdentifier: null,
        onboardingUrl: m.signupUrl ?? null,
        hasApiKey: false,
        hasApiSecret: false,
        hasWebhookSecret: false,
        connectedAt: null,
        lastVerifiedAt: null,
        disconnectedAt: null,
        disconnectedBy: null,
        failureReason: null,
        createdAt: null,
        updatedAt: null,
        onboardingInfo: toPublicOnboardingInfo(m),
      }));

    res.json([...formatted, ...notEnrolled]);
  } catch (err) {
    logger.error({ err, merchantId }, "GET /merchant/enrollments failed");
    res.status(500).json({ error: "Failed to fetch enrollments" });
  }
});

// ── POST /api/merchant/enrollments ────────────────────────────────────────────
// Initiate enrollment for a provider. Creates a pending_kyc record and returns
// the official onboarding link and KYC document list.
// Rate-limited: 10 per hour per merchant.
router.post("/", enrollRateLimiter, async (req, res) => {
  const merchantId = requireMerchant(req, res);
  if (!merchantId) return;

  const { providerSlug, maskedIdentifier } = req.body as Record<string, string>;

  if (!providerSlug || typeof providerSlug !== "string") {
    res.status(400).json({ error: "providerSlug is required" });
    return;
  }

      const meta = PROVIDER_ONBOARDING_METADATA[providerSlug];
  if (!meta) {
    res.status(400).json({ error: `Unknown provider: ${providerSlug}` });
    return;
  }

  if (meta.category === "E") {
    res.status(422).json({
      error: `${providerSlug} is not supported for merchant enrollment`,
      reason: meta.categoryReason,
    });
    return;
  }

  if (meta.category === "A") {
    res.status(422).json({
      error: `${providerSlug} is managed by RasoKart and does not require self-service enrollment`,
    });
    return;
  }

  const user = (req as any).user;

  try {
    // Upsert: if already enrolled (any status), reset to pending_kyc
    const existing = await db
      .select({ id: merchantProviderEnrollmentsTable.id })
      .from(merchantProviderEnrollmentsTable)
      .where(
        and(
          eq(merchantProviderEnrollmentsTable.merchantId, merchantId),
          eq(merchantProviderEnrollmentsTable.providerSlug, providerSlug)
        )
      )
      .limit(1);

    let row: typeof merchantProviderEnrollmentsTable.$inferSelect;

    if (existing.length > 0) {
    const [updated] = await db
      .update(merchantProviderEnrollmentsTable)
      .set({
        enrollmentStatus: "disconnected",
        // Securely clear all credential fields
        encryptedApiKey:        null,
        encryptedApiSecret:     null,
        encryptedWebhookSecret: null,
        disconnectedAt: new Date(),
        disconnectedBy: "merchant",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(merchantProviderEnrollmentsTable.merchantId, merchantId),
          eq(merchantProviderEnrollmentsTable.providerSlug, providerSlug)
        )
      )
      .returning();
      row = updated;
    } else {
      const [inserted] = await db
        .insert(merchantProviderEnrollmentsTable)
        .values({
          merchantId,
          providerSlug,
          enrollmentStatus: "pending_kyc",
          maskedIdentifier: maskedIdentifier ? maskedIdentifier.slice(-4) : null,
          onboardingUrl: meta.signupUrl ?? null,
        })
        .returning();
      row = inserted;
    }

    await writeEnrollmentAudit(
      merchantId,
      user.id,
      user.email,
      "merchant_enrollment_initiated",
      providerSlug,
      { enrollmentStatus: "pending_kyc", isReEnrollment: existing.length > 0 },
      (req as any).ip ?? null
    );

    res.json({
      enrollment: formatEnrollment(row),
      onboardingInfo: toPublicOnboardingInfo(meta),
    });
  } catch (err) {
    logger.error({ err, merchantId, providerSlug }, "POST /merchant/enrollments failed");
    res.status(500).json({ error: "Failed to initiate enrollment" });
  }
});

// ── PUT /api/merchant/enrollments/:providerSlug/credentials ───────────────────
// Merchant submits API credentials obtained from the provider after KYC approval.
// Credentials are encrypted at rest; never returned after this call.
// Rate-limited: 10 per hour per merchant.
router.put("/:providerSlug/credentials", enrollRateLimiter, async (req, res) => {
  const merchantId = requireMerchant(req, res);
  if (!merchantId) return;

  const providerSlug = req.params["providerSlug"] as string;

  // merchantId here is the provider-issued Merchant ID (public identifier, not a secret)
  const {
    apiKey,
    apiSecret,
    webhookSecret,
    merchantId: providerMerchantId,
  } = req.body as Record<string, string>;
  const user = (req as any).user;

  if (!providerSlug) {
    res.status(400).json({ error: "providerSlug is required" });
    return;
  }

      const meta = PROVIDER_ONBOARDING_METADATA[providerSlug];
  if (!meta || meta.category !== "D") {
    res.status(422).json({
      error: `Credential submission is not supported for provider: ${providerSlug}`,
    });
    return;
  }

  // Providers that require enterprise partnership cannot self-submit credentials
  if (!meta.supportsSelfSubmit) {
    res.status(422).json({
      error: `${providerSlug} does not support direct credential submission. Enterprise partnership required — contact RasoKart support.`,
    });
    return;
  }

  // At least one field must be provided
  if (!providerMerchantId && !apiKey && !apiSecret && !webhookSecret) {
    res.status(400).json({ error: "At least one credential field (merchantId, apiKey, apiSecret, webhookSecret) is required" });
    return;
  }

  try {
    // Must have an existing enrollment record
    const [existing] = await db
      .select({ id: merchantProviderEnrollmentsTable.id })
      .from(merchantProviderEnrollmentsTable)
      .where(
        and(
          eq(merchantProviderEnrollmentsTable.merchantId, merchantId),
          eq(merchantProviderEnrollmentsTable.providerSlug, providerSlug)
        )
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "No enrollment found for this provider. Please initiate enrollment first." });
      return;
    }

    // Encrypt secrets — never store plaintext.
    // providerMerchantId is a public identifier (MID / Seller ID) stored unencrypted.
    // Use a typed spread so Drizzle correctly maps every field to its column.
    // "***" sentinel means "field already stored — leave unchanged".
    const updateSet = {
      enrollmentStatus: "credentials_submitted" as const,
      updatedAt: new Date(),
      // Non-secret public identifier (MID / Seller ID / etc.) stored as-is
      ...(providerMerchantId?.trim() && providerMerchantId !== "***"
        ? { maskedIdentifier: providerMerchantId.trim() }
        : {}),
      // Secrets are AES-256-GCM encrypted
      ...(apiKey && apiKey !== "***" ? { encryptedApiKey: encryptSecret(apiKey.trim()) } : {}),
      ...(apiSecret && apiSecret !== "***" ? { encryptedApiSecret: encryptSecret(apiSecret.trim()) } : {}),
      ...(webhookSecret && webhookSecret !== "***" ? { encryptedWebhookSecret: encryptSecret(webhookSecret.trim()) } : {}),
    };

    const [updated] = await db
      .update(merchantProviderEnrollmentsTable)
      .set({
        enrollmentStatus: "disconnected",
        // Securely clear all credential fields
        encryptedApiKey:        null,
        encryptedApiSecret:     null,
        encryptedWebhookSecret: null,
        disconnectedAt: new Date(),
        disconnectedBy: "merchant",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(merchantProviderEnrollmentsTable.merchantId, merchantId),
          eq(merchantProviderEnrollmentsTable.providerSlug, providerSlug)
        )
      )
      .returning();

    const hasProviderMerchantId = !!(providerMerchantId?.trim() && providerMerchantId !== "***");
    const hasApiKey             = !!(apiKey && apiKey !== "***");
    const hasApiSecret          = !!(apiSecret && apiSecret !== "***");
    const hasWebhookSecret      = !!(webhookSecret && webhookSecret !== "***");

    await writeEnrollmentAudit(
      merchantId,
      user.id,
      user.email,
      "merchant_enrollment_credentials_submitted",
      providerSlug,
      {
        enrollmentStatus: "credentials_submitted",
        fieldsSubmitted: [
          hasProviderMerchantId ? "merchantId"    : null,
          hasApiKey             ? "apiKey"        : null,
          hasApiSecret          ? "apiSecret"     : null,
          hasWebhookSecret      ? "webhookSecret" : null,
        ].filter(Boolean),
        // NOTE: actual secret values are NEVER logged — merchantId is a non-secret identifier
      },
      (req as any).ip ?? null
    );

    // Notify opted-in admins — fire-and-forget, never block the response
    db.select({ businessName: merchantsTable.businessName })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, merchantId))
      .limit(1)
      .then(([merchant]) => {
        notifyAdminsOfNewEnrollmentSubmission({
          merchantId,
          merchantName: merchant?.businessName ?? `Merchant #${merchantId}`,
          providerSlug,
          hasApiKey,
          hasApiSecret,
          hasWebhookSecret,
        }).catch(err =>
          logger.warn({ err, merchantId, providerSlug }, "Enrollment credential submission admin email failed (non-fatal)")
        );
      })
      .catch(err =>
        logger.warn({ err, merchantId, providerSlug }, "Failed to fetch merchant name for enrollment email (non-fatal)")
      );

    res.json({ enrollment: formatEnrollment(updated) });
  } catch (err) {
    logger.error({ err, merchantId, providerSlug }, "PUT /merchant/enrollments/:slug/credentials failed");
    res.status(500).json({ error: "Failed to submit credentials" });
  }
});

// ── GET /api/merchant/enrollments/:providerSlug/status ────────────────────────
// Returns connection health status and metadata. Never returns credentials.
router.get("/:providerSlug/status", async (req, res) => {
  const merchantId = requireMerchant(req, res);
  if (!merchantId) return;

  const providerSlug = req.params["providerSlug"] as string;

  try {
    const [row] = await db
      .select()
      .from(merchantProviderEnrollmentsTable)
      .where(
        and(
          eq(merchantProviderEnrollmentsTable.merchantId, merchantId),
          eq(merchantProviderEnrollmentsTable.providerSlug, providerSlug)
        )
      )
      .limit(1);

    if (!row) {
      const meta = PROVIDER_ONBOARDING_METADATA[providerSlug];
      res.json({
        providerSlug,
        enrollmentStatus: "not_enrolled",
        onboardingInfo: meta ? toPublicOnboardingInfo(meta) : null,
      });
      return;
    }

    res.json({
      providerSlug: row.providerSlug,
      enrollmentStatus: row.enrollmentStatus,
      connectedAt: row.connectedAt,
      lastVerifiedAt: row.lastVerifiedAt,
      disconnectedAt: row.disconnectedAt,
      failureReason: row.failureReason,
      onboardingInfo: PROVIDER_ONBOARDING_METADATA[providerSlug]
        ? toPublicOnboardingInfo(PROVIDER_ONBOARDING_METADATA[providerSlug])
        : null,
    });
  } catch (err) {
    logger.error({ err, merchantId, providerSlug }, "GET /merchant/enrollments/:slug/status failed");
    res.status(500).json({ error: "Failed to fetch enrollment status" });
  }
});

// ── DELETE /api/merchant/enrollments/:providerSlug ────────────────────────────
// Revoke / disconnect. Clears encrypted credential fields and sets status to
// "disconnected". Non-secret audit log written.
router.delete("/:providerSlug", async (req, res) => {
  const merchantId = requireMerchant(req, res);
  if (!merchantId) return;

  const providerSlug = req.params["providerSlug"] as string;


  const relevantActions = [
    "admin_enrollment_status_change",
    "merchant_enrollment_credentials_submitted",
    "merchant_enrollment_initiated",
    "merchant_enrollment_disconnected",
  ];

  try {
    const [existing] = await db
      .select({ id: merchantProviderEnrollmentsTable.id })
      .from(merchantProviderEnrollmentsTable)
      .where(
        and(
          eq(merchantProviderEnrollmentsTable.merchantId, merchantId),
          eq(merchantProviderEnrollmentsTable.providerSlug, providerSlug)
        )
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "No enrollment found for this provider" });
      return;
    }

    const historyRows = await db
      .select()
      .from(auditLogsTable)
      .where(
        and(
          inArray(auditLogsTable.action, relevantActions),
          sql`${auditLogsTable.details}::jsonb->>'merchantId' = ${String(merchantId)}`,
          sql`${auditLogsTable.details}::jsonb->>'providerSlug' = ${providerSlug}`
        )
      )
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(50);

    const history = historyRows.map(row => {
      let details: Record<string, unknown> = {};
      try {
        if (row.details) details = JSON.parse(row.details);
      } catch {
        // ignore malformed JSON
      }
      return {
        id: row.id,
        action: row.action,
        actorEmail: row.adminEmail,
        createdAt: row.createdAt,
        // Surface only non-secret fields from details
        newStatus: details.newStatus ?? details.enrollmentStatus ?? null,
        previousStatus: details.previousStatus ?? null,
        reason: details.reason ?? null,
        fieldsSubmitted: details.fieldsSubmitted ?? null,
      };
    });

    res.json({ history });
  } catch (err) {
    logger.error({ err, merchantId, providerSlug }, "GET /merchant/enrollments/:slug/history failed");
    res.status(500).json({ error: "Failed to fetch enrollment history" });
  }
});

// ── DELETE /api/merchant/enrollments/:providerSlug ────────────────────────────
// Revoke / disconnect. Clears encrypted credential fields and sets status to
// "disconnected". Non-secret audit log written.
router.delete("/:providerSlug", async (req, res) => {
  const merchantId = requireMerchant(req, res);
  if (!merchantId) return;

  const providerSlug = req.params["providerSlug"] as string;
  const user = (req as any).user;

  try {
    const [existing] = await db
      .select({ id: merchantProviderEnrollmentsTable.id })
      .from(merchantProviderEnrollmentsTable)
      .where(
        and(
          eq(merchantProviderEnrollmentsTable.merchantId, merchantId),
          eq(merchantProviderEnrollmentsTable.providerSlug, providerSlug)
        )
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "No enrollment found for this provider" });
      return;
    }

    const [updated] = await db
      .update(merchantProviderEnrollmentsTable)
      .set({
        enrollmentStatus: "disconnected",
        // Securely clear all credential fields
        encryptedApiKey:        null,
        encryptedApiSecret:     null,
        encryptedWebhookSecret: null,
        disconnectedAt: new Date(),
        disconnectedBy: "merchant",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(merchantProviderEnrollmentsTable.merchantId, merchantId),
          eq(merchantProviderEnrollmentsTable.providerSlug, providerSlug)
        )
      )
      .returning();

    await writeEnrollmentAudit(
      merchantId,
      user.id,
      user.email,
      "merchant_enrollment_disconnected",
      providerSlug,
      { enrollmentStatus: "disconnected", disconnectedBy: "merchant" },
      (req as any).ip ?? null
    );

    res.json({ enrollment: formatEnrollment(updated) });
  } catch (err) {
    logger.error({ err, merchantId, providerSlug }, "DELETE /merchant/enrollments/:slug failed");
    res.status(500).json({ error: "Failed to disconnect enrollment" });
  }
});

export default router;
