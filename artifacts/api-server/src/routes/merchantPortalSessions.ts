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
 * CREDENTIAL SECURITY:
 *   - Credentials (API keys, passwords) are accepted over HTTPS in the request body.
 *   - They are encrypted server-side with AES-256-GCM before being passed to adapters.
 *   - Raw credential values are never logged, returned to the frontend, or written to disk.
 *   - Only the encrypted session token is persisted (in encrypted_session column).
 *
 * ADAPTERS:
 *   - Razorpay (razorpay): API Key + Secret — no CAPTCHA, no OTP, no browser sessions.
 *   - Pine Labs ONE (pinelabs_one): fail-closed (PARTNER_API_REQUIRED).
 */

import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { merchantPortalSessionsTable, merchantPortalTransactionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { isPortalProvider, getAdapter } from "../helpers/connectorEngine/engine";
import { getRegisteredSlugs } from "../helpers/connectorEngine/adapters/registry";
import { encryptSecret } from "../helpers/cryptoUtils";
import { logger } from "../lib/logger";
import { makeRateLimiter, safeIpKey } from "../helpers/makeRateLimiter";
import { DbRateLimitStore } from "../lib/rateLimitStore";

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

const syncLimit = makeRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  store: new DbRateLimitStore(),
  message: { error: "Too many sync requests. Please wait before syncing again." },
  keyGenerator: (req: any) =>
    `mps-sync:${safeIpKey(req)}:${req.user?.merchantId ?? "anon"}`,
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

    const providers = slugs.map((slug: string) => {
      const adapter = getAdapter(slug);
      return {
        slug,
        displayName: adapter?.displayName ?? slug,
        supportedLoginMethods: adapter?.supportedLoginMethods ?? [],
        session: sessionBySlug.get(slug) ?? null,
      };
    });

    res.json({ providers });
  } catch (err: any) {
    logger.error({ err: err.message }, "merchant_portal_providers_failed");
    res.status(500).json({ error: "Failed to list portal providers" });
  }
});

// ── POST /api/merchant/portal-sessions/:provider/initiate ─────────────────────
// Start (or restart) a portal session for the merchant's own provider account.
//
// Request body:
//   { loginMethod?: string, identifier?: string, password?: string }
//
// Credentials are accepted over HTTPS and encrypted server-side immediately.
// Raw values are never logged, never persisted in plaintext, never returned.

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

    // ── Read and validate credentials from request body ───────────────────────
    const { loginMethod, identifier, password } = req.body ?? {};

    const requestedMethodKey = loginMethod ?? methods[0].key;
    const method = methods.find((m: any) => m.key === requestedMethodKey);
    if (!method) {
      res.status(400).json({ error: `Unsupported login method '${requestedMethodKey}' for this provider.` });
      return;
    }

    if (method.requiresPassword && !password) {
      res.status(400).json({ error: "Password / API Key Secret is required for this login method." });
      return;
    }

    // ── Server-side AES-256-GCM encryption ───────────────────────────────────
    // Raw credential strings are encrypted before leaving this scope.
    // They are never logged at any point in this function.
    const encryptedIdentifier = identifier ? encryptSecret(String(identifier)) : "";
    const encryptedPassword   = password   ? encryptSecret(String(password))   : undefined;

    // ── Dispatch to adapter ───────────────────────────────────────────────────
    const result = await adapter.initiateSession({
      loginMethod: method.key,
      encryptedIdentifier,
      encryptedPassword,
    });

    // ── Persist session state (encrypted token + status) ─────────────────────
    const isConnected = result.status === "CONNECTED";
    await db
      .insert(merchantPortalSessionsTable)
      .values({
        merchantId,
        providerSlug,
        status: result.status,
        encryptedSession: result.encryptedSessionToken ?? null,
        lastStatusMessage: result.failReason ?? result.nextStepPrompt ?? null,
        connectedAt: isConnected ? new Date() : undefined,
        stepFailureCount: 0,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          merchantPortalSessionsTable.merchantId,
          merchantPortalSessionsTable.providerSlug,
        ],
        set: {
          status: result.status,
          encryptedSession: result.encryptedSessionToken ?? null,
          lastStatusMessage: result.failReason ?? result.nextStepPrompt ?? null,
          connectedAt: isConnected ? new Date() : undefined,
          stepFailureCount: 0,
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
// Submit a step credential (OTP / password / CAPTCHA) after initiateSession
// returned AWAITING_OTP / AWAITING_PASSWORD / AWAITING_CAPTCHA.

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

    const isConnected = result.status === "CONNECTED";
    await db
      .update(merchantPortalSessionsTable)
      .set({
        status: result.status,
        encryptedSession: result.encryptedSessionToken ?? session.encryptedSession,
        lastStatusMessage: result.failReason ?? result.nextStepPrompt ?? null,
        stepFailureCount:
          result.status === "FAILED"
            ? (session.stepFailureCount ?? 0) + 1
            : 0,
        connectedAt: isConnected ? new Date() : session.connectedAt,
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

// ── POST /api/merchant/portal-sessions/:provider/sync ─────────────────────────
// Fetch the last 30 days of transactions from the provider and store them.
// Duplicate-safe: re-syncing the same window is idempotent (ON CONFLICT DO NOTHING).
// dry_run=true (schema default) — transactions are recorded but NOT credited to wallet.

router.post("/:provider/sync", syncLimit, async (req: any, res) => {
  const providerSlug = req.params["provider"] as string;
  const merchantId = getMerchantId(req);

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

    if (!session || session.status !== "CONNECTED" || !session.encryptedSession) {
      res.status(400).json({
        error: "No active connected session for this provider. Connect first.",
      });
      return;
    }

    const adapter = getAdapter(providerSlug);
    if (!adapter) {
      res.status(503).json({ error: "No adapter registered for this provider." });
      return;
    }

    // Fetch the last 30 days of transactions from the provider.
    const to   = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

    const fetchResult = await adapter.fetchTransactions({
      encryptedSessionToken: session.encryptedSession,
      from,
      to,
      pageSize: 100,
    });

    let synced  = 0;
    let skipped = 0;

    for (const tx of fetchResult.transactions) {
      const inserted = await db
        .insert(merchantPortalTransactionsTable)
        .values({
          merchantId,
          providerSlug,
          externalId:       tx.providerTxId,
          externalOrderId:  null,
          amount:           tx.amount,
          currency:         tx.currency,
          status:           tx.providerStatus ?? tx.status,
          normalizedStatus: tx.status,
          paymentMethod:    null,
          utr:              tx.utr ?? null,
          txTimestamp:      tx.txTimestamp ?? null,
          rawPayload:       tx.rawPayload ? JSON.stringify(tx.rawPayload) : null,
          fetchedAt:        new Date(),
          dryRun:           session.dryRun ?? true,
          autoCredited:     false,
        })
        .onConflictDoNothing()
        .returning({ id: merchantPortalTransactionsTable.id });

      if (inserted.length > 0) {
        synced++;
      } else {
        skipped++;
      }
    }

    // Touch session.updatedAt so UI reflects the last sync time.
    await db
      .update(merchantPortalSessionsTable)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(merchantPortalSessionsTable.merchantId, merchantId),
          eq(merchantPortalSessionsTable.providerSlug, providerSlug),
        ),
      );

    logger.info(
      { merchantId, providerSlug, synced, skipped, hasMore: fetchResult.hasMore },
      "merchant_portal_sync_complete",
    );

    res.json({
      synced,
      skipped,
      total:   fetchResult.transactions.length,
      hasMore: fetchResult.hasMore,
    });
  } catch (err: any) {
    logger.error({ err: err.message, merchantId, providerSlug }, "merchant_portal_sync_failed");
    res.status(500).json({ error: "Sync failed. Please try again." });
  }
});

// ── GET /api/merchant/portal-sessions/:provider/transactions ──────────────────
// List stored portal transactions for this merchant + provider (paginated).
// rawPayload is excluded from the response for size and to prevent accidental PII exposure.

router.get("/:provider/transactions", async (req: any, res) => {
  const providerSlug = req.params["provider"] as string;
  const merchantId   = getMerchantId(req);
  const limit = Math.min(parseInt((req.query["limit"] as string) ?? "50", 10) || 50, 100);

  try {
    const rows = await db
      .select({
        id:              merchantPortalTransactionsTable.id,
        externalId:      merchantPortalTransactionsTable.externalId,
        externalOrderId: merchantPortalTransactionsTable.externalOrderId,
        amount:          merchantPortalTransactionsTable.amount,
        currency:        merchantPortalTransactionsTable.currency,
        status:          merchantPortalTransactionsTable.status,
        normalizedStatus: merchantPortalTransactionsTable.normalizedStatus,
        paymentMethod:   merchantPortalTransactionsTable.paymentMethod,
        utr:             merchantPortalTransactionsTable.utr,
        txTimestamp:     merchantPortalTransactionsTable.txTimestamp,
        fetchedAt:       merchantPortalTransactionsTable.fetchedAt,
        dryRun:          merchantPortalTransactionsTable.dryRun,
        autoCredited:    merchantPortalTransactionsTable.autoCredited,
        createdAt:       merchantPortalTransactionsTable.createdAt,
      })
      .from(merchantPortalTransactionsTable)
      .where(
        and(
          eq(merchantPortalTransactionsTable.merchantId, merchantId),
          eq(merchantPortalTransactionsTable.providerSlug, providerSlug),
        ),
      )
      .orderBy(desc(merchantPortalTransactionsTable.txTimestamp))
      .limit(limit);

    res.json({ transactions: rows });
  } catch (err: any) {
    logger.error(
      { err: err.message, merchantId, providerSlug },
      "merchant_portal_transactions_failed",
    );
    res.status(500).json({ error: "Failed to fetch transactions" });
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

// ── POST /api/merchant/portal-sessions/:provider/reconnect ────────────────────
// Silently refreshes an expired session without re-prompting the merchant for
// credentials. For API-key adapters: re-validates stored credentials and
// re-issues a fresh encrypted session token.
// For OTP-based adapters: returns AWAITING_OTP so the UI can prompt.
// Returns FAILED + failReason=REQUIRES_FULL_REAUTH when stored credentials are
// revoked — the frontend should show the credential form again.

router.post("/:provider/reconnect", async (req: any, res) => {
  const providerSlug = req.params["provider"] as string;
  const merchantId   = getMerchantId(req);

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
        error: "No session found for this provider. Use /initiate to create one.",
      });
      return;
    }

    if (!session.encryptedSession) {
      res.status(400).json({
        status: "FAILED",
        errorCode: "REQUIRES_FULL_REAUTH",
        message: "No session data to reconnect from. Please re-enter your credentials.",
      });
      return;
    }

    const adapter = getAdapter(providerSlug);
    if (!adapter) {
      res.status(503).json({ error: "No adapter registered for this provider." });
      return;
    }

    const result = await adapter.reconnect(session.encryptedSession);
    const isConnected = result.status === "CONNECTED";

    await db
      .update(merchantPortalSessionsTable)
      .set({
        status:           result.status,
        encryptedSession: result.encryptedSessionToken ?? session.encryptedSession,
        lastStatusMessage: result.failReason ?? result.nextStepPrompt ?? null,
        connectedAt:      isConnected ? new Date() : session.connectedAt,
        updatedAt:        new Date(),
      })
      .where(
        and(
          eq(merchantPortalSessionsTable.merchantId, merchantId),
          eq(merchantPortalSessionsTable.providerSlug, providerSlug),
        ),
      );

    logger.info(
      { merchantId, providerSlug, status: result.status },
      "merchant_portal_session_reconnect",
    );

    res.json({
      status:    result.status,
      errorCode: result.failReason ?? null,
      message:   result.nextStepPrompt ?? result.failDetail ?? null,
      nextStep:  result.nextStep ?? null,
      helpUrl:   result.helpUrl ?? null,
    });
  } catch (err: any) {
    logger.error({ err: err.message, merchantId, providerSlug }, "merchant_portal_reconnect_failed");
    res.status(500).json({ error: "Reconnect failed. Please try again." });
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
        status:           "DISCONNECTED",
        encryptedSession: null,   // credentials wiped immediately on disconnect
        endedAt:          new Date(),
        endReason:        "MERCHANT_REQUEST",
        updatedAt:        new Date(),
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
