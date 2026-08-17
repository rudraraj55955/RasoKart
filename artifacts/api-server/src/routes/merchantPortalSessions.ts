/**
 * /api/merchant/portal-sessions — Tenant merchant self-service portal sessions.
 *
 * AUTHENTICATION & ISOLATION:
 *   Every endpoint is gated on:
 *     1. requireAuth       — valid JWT (httpOnly cookie or Bearer header)
 *     2. requireMerchant   — role === "merchant" && merchantId present
 *   Every SQL query adds WHERE merchant_id = req.user.merchantId.
 *   No cross-tenant leakage is possible.
 *
 * OTP SECURITY CONTRACT:
 *   - OTP is accepted in the request body as plaintext over HTTPS.
 *   - It is encrypted server-side with AES-256-GCM in this module before
 *     being passed to any adapter.
 *   - The raw OTP value is never logged, returned, stored in DB, or placed
 *     in any error message, audit trail, or telemetry.
 *   - submit-step enforces:
 *       a) Status must be AWAITING_OTP / AWAITING_PASSWORD before adapter call.
 *       b) Maximum 3 consecutive step failures (stepFailureCount >= MAX_OTP_ATTEMPTS)
 *          → hard 429 requiring full re-initiate.
 *       c) OTP session expiry: initiate timestamp (updatedAt) must be < 10 min ago.
 *       d) Parallel submission prevention: a soft in-flight guard per merchant+provider.
 *
 * CREDENTIAL SECURITY:
 *   - Credentials (API keys, passwords) are accepted over HTTPS in the request body.
 *   - They are encrypted server-side with AES-256-GCM before being passed to adapters.
 *   - Raw credential values are never logged, returned to the frontend, or written to disk.
 *   - Only the encrypted session token is persisted (in encrypted_session column).
 *   - publicSession() strips encrypted_session before any API response.
 *
 * dry_run INVARIANT:
 *   All synced transactions have dryRun=true and autoCredited=false.
 *   This module never modifies wallet balances.
 *
 * ADAPTERS:
 *   - paytm_merchant: Registered Mobile + OTP (portal_session_connector, Playwright)
 *   - razorpay:       API Key + Secret (api_key_connector, no browser)
 *   - pinelabs_one:   portal_session_connector (mobile_password, Playwright — registered
 *                    mobile/user-ID → password → optional OTP 2FA → CONNECTED)
 */

import { Router } from "express";
import { eq, and, desc, count as drizzleCount, gte, lte, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { merchantPortalSessionsTable, merchantPortalTransactionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { isPortalProvider, getAdapter } from "../helpers/connectorEngine/engine";
import { getRegisteredSlugs } from "../helpers/connectorEngine/adapters/registry";
import { encryptSecret } from "../helpers/cryptoUtils";
import {
  probeBrowserReady,
  browserPoolStatus,
  BrowserRuntimeUnavailableError,
} from "../helpers/connectorEngine/browserPool";
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

// ── Auth guard (all routes below require a valid merchant JWT) ─────────────────
// NOTE: the public browser-health probe is mounted at /api/browser-health
//       (routes/index.ts) so it bypasses the /merchant/* auth alias entirely.

router.use(requireAuth, requireMerchant);

/** Map a BrowserRuntimeUnavailableError to a sanitized 503 with no server paths. */
function handleBrowserUnavailable(res: any, merchantId: number, providerSlug: string): void {
  logger.warn({ merchantId, providerSlug }, "merchant_portal_browser_runtime_unavailable");
  res.status(503).json({
    status:    "FAILED",
    errorCode: "BROWSER_RUNTIME_UNAVAILABLE",
    message:   "Browser automation is temporarily unavailable. Please try again later or contact support.",
    nextStep:  null,
  });
}

// ── Rate limits ────────────────────────────────────────────────────────────────

const initiateLimit = makeRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  store: new DbRateLimitStore(),
  message: { error: "Too many session initiation attempts. Please wait 15 minutes." },
  keyGenerator: (req: any) =>
    `mps-initiate:${safeIpKey(req)}:${req.user?.merchantId ?? "anon"}`,
});

// submit-step rate limit: 10 per 10 min per IP+merchant.
// The per-session hard limit (MAX_OTP_ATTEMPTS) is enforced separately via
// stepFailureCount in the route handler — this limit exists to defend against
// distributed brute-force across multiple sessions.
const submitStepLimit = makeRateLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  store: new DbRateLimitStore(),
  message: { error: "Too many OTP submissions. Please wait 10 minutes." },
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

// ── Security constants ─────────────────────────────────────────────────────────

/** Max consecutive OTP failures before the session is locked and must be re-initiated. */
const MAX_OTP_ATTEMPTS = 3;

/** Max age of an OTP session (from initiate) before submit-step is rejected. */
const OTP_SESSION_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

/** In-flight submit-step guard: prevents parallel OTP submissions per merchant+provider. */
const inFlightSubmits = new Set<string>();

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
// SECURITY:
//   - Credentials (identifier, password) are accepted over HTTPS.
//   - They are encrypted server-side with AES-256-GCM immediately.
//   - Raw values are never logged, never persisted in plaintext, never returned.
//   - Re-initiating resets stepFailureCount to 0 and wipes any prior OTP session.

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
    // They are NEVER logged at any point in this function.
    const encryptedIdentifier = identifier ? encryptSecret(String(identifier)) : "";
    const encryptedPassword   = password   ? encryptSecret(String(password))   : undefined;

    const result = await adapter.initiateSession({
      loginMethod: method.key,
      encryptedIdentifier,
      encryptedPassword,
    });

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
        stepFailureCount: 0,   // always reset on fresh initiate
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

    // Log: status + slug only. No credentials, no OTP, no identifier.
    logger.info(
      { merchantId, providerSlug, status: result.status },
      "merchant_portal_session_initiate",
    );

    res.status(result.status === "FAILED" ? 503 : 200).json({
      status:    result.status,
      errorCode: result.failReason ?? null,
      message:   result.nextStepPrompt ?? result.failDetail ?? null,
      nextStep:  result.nextStep ?? null,
      helpUrl:   result.helpUrl ?? null,
    });
  } catch (err: any) {
    if (err instanceof BrowserRuntimeUnavailableError) {
      handleBrowserUnavailable(res, merchantId, providerSlug);
      return;
    }
    // Log: error message only. No credentials, identifier, or OTP.
    logger.error(
      { err: err.message, merchantId, providerSlug },
      "merchant_portal_initiate_failed",
    );
    res.status(500).json({ error: "Failed to initiate portal session" });
  }
});

// ── POST /api/merchant/portal-sessions/:provider/submit-step ──────────────────
// Submit an OTP / MPIN / password after initiateSession returned AWAITING_*.
//
// SECURITY GATES (applied before adapter call):
//   1. Session must be in AWAITING_OTP or AWAITING_PASSWORD status.
//   2. stepFailureCount must be < MAX_OTP_ATTEMPTS (3). Exceeding blocks further
//      attempts and requires full re-initiate.
//   3. OTP session must be < OTP_SESSION_MAX_AGE_MS (10 min) old (via updatedAt).
//   4. An in-flight guard prevents concurrent submit-step calls for the same
//      merchant+provider combination.
//
// OTP DISCARD:
//   The raw OTP string is encrypted immediately, passed once to the adapter, and
//   the encryptedOtp variable goes out of scope. Neither the raw OTP nor any
//   derived value is logged, returned, stored in DB, or placed in error messages.

router.post("/:provider/submit-step", submitStepLimit, async (req: any, res) => {
  const providerSlug = req.params["provider"] as string;
  const merchantId   = getMerchantId(req);

  // Read OTP/password from body — NEVER log these values
  const { otp, password } = req.body ?? {};

  if (!otp && !password) {
    res.status(400).json({ error: "otp or password is required" });
    return;
  }

  // ── Parallel submission prevention ──────────────────────────────────────────
  const inFlightKey = `${merchantId}:${providerSlug}`;
  if (inFlightSubmits.has(inFlightKey)) {
    res.status(409).json({
      error: "An OTP submission is already in progress. Please wait.",
    });
    return;
  }
  inFlightSubmits.add(inFlightKey);

  try {
    // ── Server-side AES-256-GCM encryption — raw OTP never leaves this scope ─
    const encryptedOtp      = otp      ? encryptSecret(String(otp))     : undefined;
    const encryptedPassword = password ? encryptSecret(String(password)) : undefined;

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

    // ── Security gate 1: status check ─────────────────────────────────────────
    const allowedStatuses = ["AWAITING_OTP", "AWAITING_PASSWORD", "AWAITING_MPIN"];
    if (!allowedStatuses.includes(session.status)) {
      res.status(400).json({
        error:     "Session is not awaiting a step credential.",
        errorCode: "WRONG_SESSION_STATE",
        status:    session.status,
      });
      return;
    }

    // ── Security gate 2: max OTP attempt limit ─────────────────────────────────
    const failures = session.stepFailureCount ?? 0;
    if (failures >= MAX_OTP_ATTEMPTS) {
      logger.warn(
        { merchantId, providerSlug, failures },
        "merchant_portal_otp_max_attempts_reached",
      );
      res.status(429).json({
        error:     `Maximum OTP attempts (${MAX_OTP_ATTEMPTS}) reached. Please re-initiate the session.`,
        errorCode: "MAX_ATTEMPTS_REACHED",
        status:    "FAILED",
      });
      return;
    }

    // ── Security gate 3: OTP session expiry ───────────────────────────────────
    // updatedAt is set at initiate time. If more than OTP_SESSION_MAX_AGE_MS has
    // passed, the OTP on the provider's side has expired.
    if (session.updatedAt) {
      const ageMs = Date.now() - new Date(session.updatedAt).getTime();
      if (ageMs > OTP_SESSION_MAX_AGE_MS) {
        // Update status to EXPIRED and clear the session token
        await db
          .update(merchantPortalSessionsTable)
          .set({
            status:           "EXPIRED",
            encryptedSession: null,
            lastStatusMessage: "OTP session expired. Please re-enter your mobile number to receive a new OTP.",
            updatedAt:        new Date(),
          })
          .where(
            and(
              eq(merchantPortalSessionsTable.merchantId, merchantId),
              eq(merchantPortalSessionsTable.providerSlug, providerSlug),
            ),
          );

        logger.info(
          { merchantId, providerSlug, ageMs },
          "merchant_portal_otp_session_expired",
        );

        res.status(400).json({
          error:     "OTP has expired (> 10 min since initiate). Please request a new OTP.",
          errorCode: "OTP_SESSION_EXPIRED",
          status:    "EXPIRED",
        });
        return;
      }
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
      encryptedOtp:          encryptedOtp ?? undefined,
      encryptedPassword:     encryptedPassword ?? undefined,
    });
    // encryptedOtp / encryptedPassword go out of scope here — GC eligible

    const isConnected     = result.status === "CONNECTED";
    const isFailed        = result.status === "FAILED";
    const newFailureCount = isFailed ? failures + 1 : 0;

    await db
      .update(merchantPortalSessionsTable)
      .set({
        status:           result.status,
        encryptedSession: isConnected
          ? (result.encryptedSessionToken ?? session.encryptedSession)
          : (result.encryptedSessionToken ?? null),   // wipe on failure/expired
        lastStatusMessage: result.failReason ?? result.nextStepPrompt ?? null,
        stepFailureCount:  newFailureCount,
        connectedAt:       isConnected ? new Date() : session.connectedAt,
        updatedAt:         new Date(),
      })
      .where(
        and(
          eq(merchantPortalSessionsTable.merchantId, merchantId),
          eq(merchantPortalSessionsTable.providerSlug, providerSlug),
        ),
      );

    // Log: status, providerSlug, merchantId only. No OTP value.
    logger.info(
      {
        merchantId,
        providerSlug,
        status:       result.status,
        failures:     newFailureCount,
        // failReason is safe — it's an error code like "INVALID_OTP", not the OTP itself
        failReason:   result.failReason ?? null,
      },
      "merchant_portal_submit_step",
    );

    // If max failures now reached, add a hint to the response
    const hitMaxAttempts = isFailed && newFailureCount >= MAX_OTP_ATTEMPTS;

    res.json({
      status:    result.status,
      errorCode: result.failReason ?? null,
      message:   hitMaxAttempts
        ? `Maximum OTP attempts reached. Please re-initiate the session.`
        : (result.nextStepPrompt ?? result.failDetail ?? null),
      nextStep:  result.nextStep ?? null,
      attemptsRemaining: hitMaxAttempts ? 0 : MAX_OTP_ATTEMPTS - newFailureCount,
    });
  } catch (err: any) {
    if (err instanceof BrowserRuntimeUnavailableError) {
      handleBrowserUnavailable(res, merchantId, providerSlug);
      return;
    }
    // No credential values in the log
    logger.error(
      { err: err.message, merchantId, providerSlug },
      "merchant_portal_submit_step_failed",
    );
    res.status(500).json({ error: "Failed to submit step" });
  } finally {
    inFlightSubmits.delete(inFlightKey);
  }
});

// ── POST /api/merchant/portal-sessions/:provider/sync ─────────────────────────
// Fetch the last 30 days of transactions from the provider and store them.
// Duplicate-safe: re-syncing the same window is idempotent (ON CONFLICT DO NOTHING).
//
// dry_run INVARIANT: dryRun=true and autoCredited=false are ALWAYS set on insert.
// This route NEVER modifies wallet balances.

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
      // rawPayload is already sanitized by the adapter (no passwords/tokens)
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
          dryRun:           true,    // ALWAYS true — wallet balances never change
          autoCredited:     false,   // ALWAYS false — no auto-credit path exists
        })
        .onConflictDoNothing()
        .returning({ id: merchantPortalTransactionsTable.id });

      if (inserted.length > 0) synced++;
      else skipped++;
    }

    // Touch session updatedAt so UI reflects the last sync time
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

    res.json({ synced, skipped, total: fetchResult.transactions.length, hasMore: fetchResult.hasMore });
  } catch (err: any) {
    if (err instanceof BrowserRuntimeUnavailableError) {
      handleBrowserUnavailable(res, merchantId, providerSlug);
      return;
    }
    logger.error({ err: err.message, merchantId, providerSlug }, "merchant_portal_sync_failed");
    res.status(500).json({ error: "Sync failed. Please try again." });
  }
});

// ── GET /api/merchant/portal-sessions/:provider/transactions ──────────────────
// List stored portal transactions for this merchant + provider.
//
// SECURITY: rawPayload is excluded. All rows are filtered by merchantId.
//
// Query params:
//   page       — 1-based page number (default 1)
//   limit      — rows per page (default 20, max 100)
//   status     — filter by normalizedStatus (SUCCESS|FAILED|PENDING|REVERSED|UNKNOWN)
//   dateFrom   — ISO date string — filter txTimestamp >= this date
//   dateTo     — ISO date string — filter txTimestamp <= this date

router.get("/:provider/transactions", async (req: any, res) => {
  const providerSlug = req.params["provider"] as string;
  const merchantId   = getMerchantId(req);

  const page   = Math.max(1, parseInt((req.query["page"]  as string) ?? "1", 10)  || 1);
  const limit  = Math.min(100, Math.max(1, parseInt((req.query["limit"] as string) ?? "20", 10) || 20));
  const offset = (page - 1) * limit;

  const statusFilter   = (req.query["status"]   as string) ?? null;
  const dateFromFilter = (req.query["dateFrom"] as string) ?? null;
  const dateToFilter   = (req.query["dateTo"]   as string) ?? null;

  try {
    // Build the WHERE clause
    const conditions = [
      eq(merchantPortalTransactionsTable.merchantId, merchantId),
      eq(merchantPortalTransactionsTable.providerSlug, providerSlug),
    ];

    // Safe status values — only these are valid normalizedStatus values
    const VALID_STATUSES = ["SUCCESS", "FAILED", "PENDING", "REVERSED", "UNKNOWN"];
    if (statusFilter && VALID_STATUSES.includes(statusFilter.toUpperCase())) {
      conditions.push(
        eq(merchantPortalTransactionsTable.normalizedStatus, statusFilter.toUpperCase()),
      );
    }

    if (dateFromFilter) {
      const from = new Date(dateFromFilter);
      if (!isNaN(from.getTime())) {
        conditions.push(gte(merchantPortalTransactionsTable.txTimestamp, from));
      }
    }

    if (dateToFilter) {
      const to = new Date(dateToFilter + "T23:59:59Z");
      if (!isNaN(to.getTime())) {
        conditions.push(lte(merchantPortalTransactionsTable.txTimestamp, to));
      }
    }

    const where = and(...conditions);

    const [totalResult, rows] = await Promise.all([
      db
        .select({ count: drizzleCount() })
        .from(merchantPortalTransactionsTable)
        .where(where),
      db
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
          // rawPayload deliberately excluded — may contain large/sensitive data
        })
        .from(merchantPortalTransactionsTable)
        .where(where)
        .orderBy(desc(merchantPortalTransactionsTable.txTimestamp))
        .limit(limit)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    res.json({
      transactions: rows,
      total,
      page,
      limit,
      hasMore: offset + rows.length < total,
    });
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
    logger.error({ err: err.message, merchantId, providerSlug }, "merchant_portal_health_failed");
    res.status(500).json({ error: "Failed to check session health" });
  }
});

// ── POST /api/merchant/portal-sessions/:provider/reconnect ────────────────────

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
        status:            result.status,
        encryptedSession:  result.encryptedSessionToken ?? session.encryptedSession,
        lastStatusMessage: result.failReason ?? result.nextStepPrompt ?? null,
        connectedAt:       isConnected ? new Date() : session.connectedAt,
        updatedAt:         new Date(),
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
// Wipes the encrypted session token from DB and calls adapter logout (best-effort).
// Invariant: after this call, no browser session state is stored.

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

    // Best-effort: ask the adapter to close the remote session (logs out the browser)
    if (session.encryptedSession) {
      const adapter = getAdapter(providerSlug);
      if (adapter?.logout) {
        try {
          await adapter.logout(session.encryptedSession);
        } catch {
          // Swallow — disconnect must succeed even if remote logout fails
        }
      }
    }

    // Wipe encrypted_session unconditionally — no browser state persisted after this
    await db
      .update(merchantPortalSessionsTable)
      .set({
        status:           "DISCONNECTED",
        encryptedSession: null,
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
