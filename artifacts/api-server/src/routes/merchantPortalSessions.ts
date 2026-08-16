/**
 * /api/merchant/portal-sessions — Tenant merchant self-service portal sessions.
 *
 * Every endpoint is gated on:
 *   1. requireAuth       — valid JWT
 *   2. requireMerchant   — role === "merchant" and merchantId present
 *
 * Isolation: every SQL query filters on WHERE merchant_id = req.user.merchantId.
 * No cross-tenant leakage is possible.
 *
 * All provider adapters are currently fail-closed (PARTNER_API_REQUIRED).
 * This route is the complete tenant infrastructure — ready for live providers.
 */

import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { merchantPortalSessionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { isPortalProvider, getAdapter } from "../helpers/connectorEngine/engine";
import { getRegisteredSlugs } from "../helpers/connectorEngine/adapters/registry";
import { logger } from "../lib/logger";
import rateLimit from "express-rate-limit";
import { DbRateLimitStore } from "../lib/rateLimitStore";
import { makeRateLimiter, safeIpKey } from "../helpers/makeRateLimiter";

const router = Router();

// ── Auth guard ─────────────────────────────────────────────────────────────────

function requireMerchant(req: any, res: any, next: any) {
  const user = req.user;
  if (!user || user.role !== "merchant" || !user.merchantId) {
    res.status(403).json({ error: "Merchant access required" });
    return;
  }
  next();
}

router.use(requireAuth, requireMerchant);

// ── Rate limits ────────────────────────────────────────────────────────────────

const initiateLimit = makeRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  store: new DbRateLimitStore(),
  message: { error: "Too many session initiation attempts. Please wait 15 minutes." },
  keyGenerator: (req: any) =>
    `mps-initiate:${safeIpKey(req)}:${req.user?.merchantId ?? "anon"}`,
});

const submitStepLimit = makeRateLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 15,
  store: new DbRateLimitStore(),
  message: { error: "Too many OTP/step submissions. Please wait 10 minutes." },
  keyGenerator: (req: any) =>
    `mps-step:${safeIpKey(req)}:${req.user?.merchantId ?? "anon"}`,
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Strip encrypted_session from any row before sending to client. */
function publicSession(row: typeof merchantPortalSessionsTable.$inferSelect) {
  const { encryptedSession: _stripped, ...safe } = row;
  return safe;
}

function getMerchantId(req: any): number {
  return req.user.merchantId as number;
}

// ── GET /api/merchant/portal-sessions ─────────────────────────────────────────
// List the merchant's own portal sessions (one per provider, most recent).

router.get("/", async (req: any, res) => {
  try {
    const merchantId = getMerchantId(req);
    const rows = await db
      .select()
      .from(merchantPortalSessionsTable)
      .where(eq(merchantPortalSessionsTable.merchantId, merchantId))
      .orderBy(desc(merchantPortalSessionsTable.updatedAt));

    res.json({ sessions: rows.map(publicSession) });
  } catch (err: any) {
    logger.error({ err: err.message }, "merchant_portal_sessions_list_failed");
    res.status(500).json({ error: "Failed to list portal sessions" });
  }
});

// ── GET /api/merchant/portal-sessions/providers ────────────────────────────────
// Return portal-capable providers plus this merchant's session status for each.

router.get("/providers", async (req: any, res) => {
  try {
    const merchantId = getMerchantId(req);
    const slugs = getRegisteredSlugs();

    const sessions = await db
      .select()
      .from(merchantPortalSessionsTable)
      .where(eq(merchantPortalSessionsTable.merchantId, merchantId));

    const sessionBySlug = new Map(
      sessions.map((s) => [s.providerSlug, publicSession(s)]),
    );

    const providers = slugs.map((slug: string) => ({
      slug,
      session: sessionBySlug.get(slug) ?? null,
    }));

    res.json({ providers });
  } catch (err: any) {
    logger.error({ err: err.message }, "merchant_portal_providers_failed");
    res.status(500).json({ error: "Failed to list portal providers" });
  }
});

// ── POST /api/merchant/portal-sessions/:provider/initiate ─────────────────────
// Start (or restart) a portal session for the merchant's own provider account.
// All adapters are currently fail-closed — returns 503 with PARTNER_API_REQUIRED.

router.post("/:provider/initiate", initiateLimit, async (req: any, res) => {
  const providerSlug = req.params["provider"] as string;
  const merchantId = getMerchantId(req);

  try {
    if (!isPortalProvider(providerSlug)) {
      res.status(404).json({ error: `Provider '${providerSlug}' is not a portal provider` });
      return;
    }

    const adapter = getAdapter(providerSlug);
    if (!adapter) {
      res.status(404).json({ error: `No adapter registered for '${providerSlug}'` });
      return;
    }

    // Supported login methods — if empty the adapter is fully fail-closed.
    const methods = adapter.supportedLoginMethods;
    if (methods.length === 0) {
      // Record a FAILED session so the UI can show the blocked status.
      await db
        .insert(merchantPortalSessionsTable)
        .values({
          merchantId,
          providerSlug,
          status: "PARTNER_API_REQUIRED",
          lastStatusMessage:
            "Official partner API access is required for this provider. " +
            "No portal automation is available without a formal agreement.",
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            merchantPortalSessionsTable.merchantId,
            merchantPortalSessionsTable.providerSlug,
          ],
          set: {
            status: "PARTNER_API_REQUIRED",
            lastStatusMessage:
              "Official partner API access is required for this provider.",
            updatedAt: new Date(),
          },
        });

      logger.info(
        { merchantId, providerSlug, status: "PARTNER_API_REQUIRED" },
        "merchant_portal_session_blocked",
      );

      res.status(503).json({
        status: "PARTNER_API_REQUIRED",
        errorCode: "PARTNER_API_REQUIRED",
        message:
          "This provider requires an official partner API agreement before " +
          "portal automation is available. Contact the provider to apply.",
        nextStep: null,
      });
      return;
    }

    // Adapters with supported methods: pass a placeholder initiate call.
    // (All current adapters have 0 methods — this path is for future live adapters.)
    const result = await adapter.initiateSession({
      loginMethod: methods[0].key,
      encryptedIdentifier: "", // merchant must supply via a follow-up submit-step
    });

    await db
      .insert(merchantPortalSessionsTable)
      .values({
        merchantId,
        providerSlug,
        status: result.status,
        lastStatusMessage: result.failReason ?? result.nextStepPrompt ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          merchantPortalSessionsTable.merchantId,
          merchantPortalSessionsTable.providerSlug,
        ],
        set: {
          status: result.status,
          lastStatusMessage: result.failReason ?? result.nextStepPrompt ?? null,
          updatedAt: new Date(),
        },
      });

    logger.info(
      { merchantId, providerSlug, status: result.status },
      "merchant_portal_session_initiate",
    );

    res.status(result.status === "FAILED" ? 503 : 200).json({
      status: result.status,
      errorCode: result.failReason ?? null,
      message: result.nextStepPrompt ?? result.failDetail ?? null,
      nextStep: result.nextStep ?? null,
      helpUrl: result.helpUrl ?? null,
    });
  } catch (err: any) {
    logger.error(
      { err: err.message, merchantId, providerSlug },
      "merchant_portal_initiate_failed",
    );
    res.status(500).json({ error: "Failed to initiate portal session" });
  }
});

// ── POST /api/merchant/portal-sessions/:provider/submit-step ──────────────────
// Submit a step credential (OTP / password). Fail-closed for current adapters.

router.post("/:provider/submit-step", submitStepLimit, async (req: any, res) => {
  const providerSlug = req.params["provider"] as string;
  const merchantId = getMerchantId(req);
  const { encryptedOtp, encryptedPassword } = req.body ?? {};

  if (!encryptedOtp && !encryptedPassword) {
    res.status(400).json({ error: "encryptedOtp or encryptedPassword is required" });
    return;
  }

  try {
    if (!isPortalProvider(providerSlug)) {
      res.status(404).json({ error: `Provider '${providerSlug}' is not a portal provider` });
      return;
    }

    const [session] = await db
      .select()
      .from(merchantPortalSessionsTable)
      .where(
        and(
          eq(merchantPortalSessionsTable.merchantId, merchantId),
          eq(merchantPortalSessionsTable.providerSlug, providerSlug),
        ),
      )
      .limit(1);

    if (!session) {
      res.status(404).json({
        error: "No active session for this provider. Call /initiate first.",
      });
      return;
    }

    const adapter = getAdapter(providerSlug);
    if (!adapter || adapter.supportedLoginMethods.length === 0) {
      res.status(503).json({
        status: "PARTNER_API_REQUIRED",
        message: "No automation available for this provider.",
      });
      return;
    }

    const sessionToken = session.encryptedSession ?? "";
    const result = await adapter.submitStep({
      encryptedSessionToken: sessionToken,
      encryptedOtp: encryptedOtp ?? undefined,
      encryptedPassword: encryptedPassword ?? undefined,
    });

    await db
      .update(merchantPortalSessionsTable)
      .set({
        status: result.status,
        lastStatusMessage: result.failReason ?? result.nextStepPrompt ?? null,
        stepFailureCount:
          result.status === "FAILED"
            ? (session.stepFailureCount ?? 0) + 1
            : 0,
        connectedAt:
          result.status === "CONNECTED" ? new Date() : session.connectedAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(merchantPortalSessionsTable.merchantId, merchantId),
          eq(merchantPortalSessionsTable.providerSlug, providerSlug),
        ),
      );

    res.json({
      status: result.status,
      errorCode: result.failReason ?? null,
      message: result.nextStepPrompt ?? result.failDetail ?? null,
      nextStep: result.nextStep ?? null,
    });
  } catch (err: any) {
    logger.error(
      { err: err.message, merchantId, providerSlug },
      "merchant_portal_submit_step_failed",
    );
    res.status(500).json({ error: "Failed to submit step" });
  }
});

// ── GET /api/merchant/portal-sessions/:provider/health ────────────────────────

router.get("/:provider/health", async (req: any, res) => {
  const providerSlug = req.params["provider"] as string;
  const merchantId = getMerchantId(req);

  try {
    const [session] = await db
      .select()
      .from(merchantPortalSessionsTable)
      .where(
        and(
          eq(merchantPortalSessionsTable.merchantId, merchantId),
          eq(merchantPortalSessionsTable.providerSlug, providerSlug),
        ),
      )
      .limit(1);

    if (!session) {
      res.json({ status: "NO_SESSION", session: null });
      return;
    }

    res.json({ status: session.status, session: publicSession(session) });
  } catch (err: any) {
    logger.error(
      { err: err.message, merchantId, providerSlug },
      "merchant_portal_health_failed",
    );
    res.status(500).json({ error: "Failed to check session health" });
  }
});

// ── POST /api/merchant/portal-sessions/:provider/disconnect ───────────────────

router.post("/:provider/disconnect", async (req: any, res) => {
  const providerSlug = req.params["provider"] as string;
  const merchantId = getMerchantId(req);

  try {
    const [session] = await db
      .select()
      .from(merchantPortalSessionsTable)
      .where(
        and(
          eq(merchantPortalSessionsTable.merchantId, merchantId),
          eq(merchantPortalSessionsTable.providerSlug, providerSlug),
        ),
      )
      .limit(1);

    if (!session) {
      res.status(404).json({ error: "No session found for this provider" });
      return;
    }

    await db
      .update(merchantPortalSessionsTable)
      .set({
        status: "DISCONNECTED",
        encryptedSession: null,
        endedAt: new Date(),
        endReason: "MERCHANT_REQUEST",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(merchantPortalSessionsTable.merchantId, merchantId),
          eq(merchantPortalSessionsTable.providerSlug, providerSlug),
        ),
      );

    logger.info({ merchantId, providerSlug }, "merchant_portal_session_disconnected");
    res.json({ ok: true, status: "DISCONNECTED" });
  } catch (err: any) {
    logger.error(
      { err: err.message, merchantId, providerSlug },
      "merchant_portal_disconnect_failed",
    );
    res.status(500).json({ error: "Failed to disconnect session" });
  }
});

export default router;
