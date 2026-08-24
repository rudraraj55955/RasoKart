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
 *       b) Exactly the credential/action required by the current session state.
 *       c) Maximum 3 OTP verification attempts and 3 explicit resend attempts,
 *          tracked independently from password failures.
 *       d) Authoritative 10-minute OTP expiry and 60-second resend cooldown.
 *       e) A database-owned processing lease plus a soft process-local in-flight
 *          guard prevent parallel submissions and stale cross-replica writes.
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
import { randomUUID } from "node:crypto";
import { eq, and, or, isNull, lt, desc, count as drizzleCount, gte, lte, sql } from "drizzle-orm";
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
// otpVerificationFailureCount in the route handler — this limit exists to defend against
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
const MAX_OTP_RESENDS = 3;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

/** Max age of an OTP session (from initiate) before submit-step is rejected. */
const OTP_SESSION_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

/** In-flight submit-step guard: prevents parallel OTP submissions per merchant+provider. */
const inFlightSubmits = new Set<string>();

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Strip encrypted_session from any row before sending to client. */
function publicSession(row: typeof merchantPortalSessionsTable.$inferSelect) {
  const {
    encryptedSession: _stripped,
    processingLeaseId: _leaseId,
    processingLeaseExpiresAt: _leaseExpiry,
    ...safe
  } = row;
  return { ...safe, ...otpLifecycleMetadata(row) };
}

function getMerchantId(req: any): number {
  return req.user.merchantId as number;
}

/** Server-authoritative OTP lifecycle data; timestamps are ISO strings in JSON. */
function otpLifecycleMetadata(row: Pick<typeof merchantPortalSessionsTable.$inferSelect,
  "otpVerificationFailureCount" | "otpResendCount" | "otpResendAvailableAt" | "otpExpiresAt">) {
  const failures = row.otpVerificationFailureCount ?? 0;
  const resendCount = row.otpResendCount ?? 0;
  return {
    attemptsRemaining: Math.max(0, MAX_OTP_ATTEMPTS - failures),
    resendCount,
    resendsRemaining: Math.max(0, MAX_OTP_RESENDS - resendCount),
    resendAvailableAt: row.otpResendAvailableAt?.toISOString() ?? null,
    otpExpiresAt: row.otpExpiresAt?.toISOString() ?? null,
  };
}

function freshOtpLifecycle(now: Date) {
  return {
    otpVerificationFailureCount: 0,
    otpResendCount: 0,
    otpResendAvailableAt: new Date(now.getTime() + OTP_RESEND_COOLDOWN_MS),
    otpExpiresAt: new Date(now.getTime() + OTP_SESSION_MAX_AGE_MS),
  };
}

const clearedOtpLifecycle = {
  otpVerificationFailureCount: 0,
  otpResendCount: 0,
  otpResendAvailableAt: null,
  otpExpiresAt: null,
};

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
    const now = new Date();
    const otpLifecycle = result.status === "AWAITING_OTP"
      ? freshOtpLifecycle(now)
      : clearedOtpLifecycle;
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
        processingLeaseId: null,
        processingLeaseExpiresAt: null,
        ...otpLifecycle,
        updatedAt: now,
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
          processingLeaseId: null,
          processingLeaseExpiresAt: null,
          ...otpLifecycle,
          updatedAt: now,
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
      ...otpLifecycleMetadata(otpLifecycle),
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

  // Read OTP/password/loginMethod from body — NEVER log otp or password values
  const { otp, password, loginMethod } = req.body ?? {};

  // portal_otp and resend_otp are credential-free step transitions:
  // the adapter clicks the portal's own OTP link or resend button.
  const credentialFreeActions = ["portal_otp", "resend_otp"];
  if (!otp && !password && !credentialFreeActions.includes(loginMethod)) {
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

  let reservedLeaseId: string | undefined;
  let reservedSessionId: number | undefined;
  let reservedLifecycle: {
    otpVerificationFailureCount: number;
    otpResendCount: number;
    otpResendAvailableAt: Date | null;
    otpExpiresAt: Date | null;
  } | undefined;

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

    const isResend = loginMethod === "resend_otp";
    const isPortalOtpSwitch = loginMethod === "portal_otp";
    const isCredentialFreeAction = isResend || isPortalOtpSwitch;
    if (isCredentialFreeAction && (otp || password)) {
      res.status(400).json({
        error: "Credential-free actions must not include an OTP or password.",
        errorCode: "CREDENTIAL_MISMATCH",
      });
      return;
    }
    if (
      (isResend && session.status !== "AWAITING_OTP") ||
      (isPortalOtpSwitch && session.status !== "AWAITING_PASSWORD")
    ) {
      res.status(400).json({
        error: isResend
          ? "OTP resend requires an active OTP session."
          : "OTP login switch requires an active password session.",
        errorCode: "WRONG_SESSION_STATE",
        status: session.status,
      });
      return;
    }
    if (
      !isCredentialFreeAction &&
      ((session.status === "AWAITING_OTP" && (!otp || password)) ||
       (session.status === "AWAITING_PASSWORD" && (!password || otp)))
    ) {
      res.status(400).json({
        error: session.status === "AWAITING_OTP"
          ? "This session requires exactly one OTP."
          : "This session requires exactly one password.",
        errorCode: "CREDENTIAL_MISMATCH",
      });
      return;
    }
    const isOtpVerification = session.status === "AWAITING_OTP" && !isCredentialFreeAction;
    const otpFailures = session.otpVerificationFailureCount ?? 0;

    // ── Server-side AES-256-GCM encryption — raw credentials never leave this scope ─
    const encryptedOtp      = isOtpVerification ? encryptSecret(String(otp)) : undefined;
    const encryptedPassword =
      session.status === "AWAITING_PASSWORD" && !isCredentialFreeAction
        ? encryptSecret(String(password))
        : undefined;

    // ── Security gate 2: OTP verification limit (password failures excluded) ──
    if (isOtpVerification && otpFailures >= MAX_OTP_ATTEMPTS) {
      logger.warn(
        { merchantId, providerSlug, failures: otpFailures },
        "merchant_portal_otp_max_attempts_reached",
      );
      res.status(429).json({
        error:     `Maximum OTP attempts (${MAX_OTP_ATTEMPTS}) reached. Please re-initiate the session.`,
        errorCode: "MAX_ATTEMPTS_REACHED",
        status:    "FAILED",
        ...otpLifecycleMetadata(session),
      });
      return;
    }

    // ── Security gate 3: authoritative OTP expiry ─────────────────────────────
    if (isOtpVerification || isResend) {
      // The fallback protects sessions created before the lifecycle columns were
      // deployed; all new OTP sessions always have otpExpiresAt.
      const otpExpiresAt = session.otpExpiresAt
        ?? new Date(new Date(session.updatedAt).getTime() + OTP_SESSION_MAX_AGE_MS);
      const ageMs = Date.now() - new Date(otpExpiresAt).getTime();
      if (ageMs > 0) {
        // Update status to EXPIRED and clear the session token
        await db
          .update(merchantPortalSessionsTable)
          .set({
            status:           "EXPIRED",
            encryptedSession: null,
            lastStatusMessage: "OTP session expired. Please re-enter your mobile number to receive a new OTP.",
            ...clearedOtpLifecycle,
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
          ...otpLifecycleMetadata(clearedOtpLifecycle),
        });
        return;
      }
    }

    // ── Security gate 4: explicit resend quota and cooldown ────────────────────
    if (isResend) {
      const resendCount = session.otpResendCount ?? 0;
      if (resendCount >= MAX_OTP_RESENDS) {
        res.status(429).json({
          error: "Maximum OTP resends reached. Please re-initiate the session.",
          errorCode: "MAX_RESENDS_REACHED",
          status: session.status,
          ...otpLifecycleMetadata(session),
        });
        return;
      }
      if (session.otpResendAvailableAt && new Date(session.otpResendAvailableAt).getTime() > Date.now()) {
        res.status(429).json({
          error: "OTP resend is not available yet. Please wait for the cooldown.",
          errorCode: "OTP_RESEND_COOLDOWN",
          status: session.status,
          ...otpLifecycleMetadata(session),
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

    // Atomically reserve OTP verification/resend attempts in PostgreSQL. The
    // process-local in-flight guard improves UX; these predicates enforce the
    // limits across multiple API processes and replicas.
    let lifecycleSession = session;
    const leaseId = randomUUID();
    reservedLeaseId = leaseId;
    reservedSessionId = session.id;
    reservedLifecycle = {
      otpVerificationFailureCount: session.otpVerificationFailureCount ?? 0,
      otpResendCount: session.otpResendCount ?? 0,
      otpResendAvailableAt: session.otpResendAvailableAt,
      otpExpiresAt: session.otpExpiresAt,
    };
    const leaseNow = new Date();
    const leaseExpiresAt = new Date(leaseNow.getTime() + 3 * 60 * 1000);
    const leaseAvailable = or(
      isNull(merchantPortalSessionsTable.processingLeaseId),
      lte(merchantPortalSessionsTable.processingLeaseExpiresAt, leaseNow),
    );
    if (isOtpVerification) {
      const [reserved] = await db
        .update(merchantPortalSessionsTable)
        .set({
          otpVerificationFailureCount: sql`${merchantPortalSessionsTable.otpVerificationFailureCount} + 1`,
          processingLeaseId: leaseId,
          processingLeaseExpiresAt: leaseExpiresAt,
        })
        .where(
          and(
            eq(merchantPortalSessionsTable.id, session.id),
            eq(merchantPortalSessionsTable.status, "AWAITING_OTP"),
            lt(merchantPortalSessionsTable.otpVerificationFailureCount, MAX_OTP_ATTEMPTS),
            or(
              isNull(merchantPortalSessionsTable.otpExpiresAt),
              gte(merchantPortalSessionsTable.otpExpiresAt, new Date()),
            ),
            leaseAvailable,
          ),
        )
        .returning();
      if (!reserved) {
        res.status(429).json({
          error: `Maximum OTP attempts (${MAX_OTP_ATTEMPTS}) reached or the OTP expired.`,
          errorCode: "MAX_ATTEMPTS_REACHED",
          status: "FAILED",
          ...otpLifecycleMetadata(session),
        });
        return;
      }
      lifecycleSession = reserved;
    } else if (isResend) {
      const reserveTime = new Date();
      const [reserved] = await db
        .update(merchantPortalSessionsTable)
        .set({
          otpResendCount: sql`${merchantPortalSessionsTable.otpResendCount} + 1`,
          otpResendAvailableAt: new Date(reserveTime.getTime() + OTP_RESEND_COOLDOWN_MS),
          processingLeaseId: leaseId,
          processingLeaseExpiresAt: leaseExpiresAt,
        })
        .where(
          and(
            eq(merchantPortalSessionsTable.id, session.id),
            eq(merchantPortalSessionsTable.status, "AWAITING_OTP"),
            lt(merchantPortalSessionsTable.otpResendCount, MAX_OTP_RESENDS),
            or(
              isNull(merchantPortalSessionsTable.otpResendAvailableAt),
              lte(merchantPortalSessionsTable.otpResendAvailableAt, reserveTime),
            ),
            or(
              isNull(merchantPortalSessionsTable.otpExpiresAt),
              gte(merchantPortalSessionsTable.otpExpiresAt, reserveTime),
            ),
            leaseAvailable,
          ),
        )
        .returning();
      if (!reserved) {
        res.status(429).json({
          error: "OTP resend is not available. Check the cooldown and resend limit.",
          errorCode: "OTP_RESEND_NOT_AVAILABLE",
          status: session.status,
          ...otpLifecycleMetadata(session),
        });
        return;
      }
      lifecycleSession = reserved;
    } else {
      const [reserved] = await db
        .update(merchantPortalSessionsTable)
        .set({
          processingLeaseId: leaseId,
          processingLeaseExpiresAt: leaseExpiresAt,
        })
        .where(
          and(
            eq(merchantPortalSessionsTable.id, session.id),
            eq(merchantPortalSessionsTable.status, session.status),
            leaseAvailable,
          ),
        )
        .returning();
      if (!reserved) {
        res.status(409).json({
          error: "Another credential submission is already in progress.",
          errorCode: "SUBMISSION_IN_PROGRESS",
          status: session.status,
        });
        return;
      }
      lifecycleSession = reserved;
    }

    const sessionToken = lifecycleSession.encryptedSession ?? "";
    const result = await adapter.submitStep({
      encryptedSessionToken: sessionToken,
      encryptedOtp:          encryptedOtp ?? undefined,
      encryptedPassword:     encryptedPassword ?? undefined,
      loginMethod:           loginMethod ?? undefined,
    });
    // encryptedOtp / encryptedPassword go out of scope here — GC eligible

    const isConnected = result.status === "CONNECTED";
    const isFailed = result.status === "FAILED";
    const now = new Date();
    const infrastructureFailure =
      result.failReason === "BROWSER_ERROR" ||
      result.failReason === "BROWSER_RUNTIME_UNAVAILABLE";
    const reservedOtpAttemptCount = lifecycleSession.otpVerificationFailureCount ?? 0;
    const newOtpFailureCount = isOtpVerification
      ? (isConnected ? 0 : infrastructureFailure ? otpFailures : reservedOtpAttemptCount)
      : (lifecycleSession.otpVerificationFailureCount ?? 0);
    const hitMaxAttempts =
      isOtpVerification &&
      !isConnected &&
      !infrastructureFailure &&
      reservedOtpAttemptCount >= MAX_OTP_ATTEMPTS;
    const recoverableOtpFailure =
      isOtpVerification &&
      isFailed &&
      !hitMaxAttempts &&
      !["OTP_EXPIRED", "OTP_SESSION_NOT_FOUND", "ACCOUNT_BLOCKED"].includes(result.failReason ?? "");
    const recoverablePasswordFailure =
      lifecycleSession.status === "AWAITING_PASSWORD" &&
      Boolean(password) &&
      isFailed &&
      !["SESSION_RESTART_REQUIRED", "CAPTCHA_REQUIRED", "MANUAL_ACTION_REQUIRED", "ACCOUNT_BLOCKED"].includes(
        result.failReason ?? "",
      );
    const recoverableFailure = recoverableOtpFailure || recoverablePasswordFailure;
    const newStepFailureCount = isFailed ? (lifecycleSession.stepFailureCount ?? 0) + 1 : 0;
    const resendSucceeded = isResend && result.status === "AWAITING_OTP" && !result.failReason;
    const enteredOtpState =
      result.status === "AWAITING_OTP" &&
      (isPortalOtpSwitch || !lifecycleSession.otpExpiresAt);
    const lifecycle = infrastructureFailure
      ? {
          otpVerificationFailureCount: session.otpVerificationFailureCount ?? 0,
          otpResendCount: session.otpResendCount ?? 0,
          otpResendAvailableAt: session.otpResendAvailableAt,
          otpExpiresAt: session.otpExpiresAt,
        }
      : hitMaxAttempts
      ? {
          otpVerificationFailureCount: reservedOtpAttemptCount,
          otpResendCount: lifecycleSession.otpResendCount ?? 0,
          otpResendAvailableAt: null,
          otpExpiresAt: null,
        }
      : isConnected
        ? clearedOtpLifecycle
      : resendSucceeded
        ? {
            otpVerificationFailureCount: 0,
            otpResendCount: lifecycleSession.otpResendCount ?? 0,
            otpResendAvailableAt: lifecycleSession.otpResendAvailableAt,
            otpExpiresAt: new Date(now.getTime() + OTP_SESSION_MAX_AGE_MS),
          }
        : enteredOtpState
          ? freshOtpLifecycle(now)
          : {
              otpVerificationFailureCount: newOtpFailureCount,
              otpResendCount: lifecycleSession.otpResendCount ?? 0,
              otpResendAvailableAt: lifecycleSession.otpResendAvailableAt,
              otpExpiresAt: lifecycleSession.otpExpiresAt,
            };
    const persistedStatus = hitMaxAttempts
      ? "FAILED"
      : recoverableFailure
        ? lifecycleSession.status
        : result.status;
    const preserveSession =
      isConnected ||
      ["AWAITING_OTP", "AWAITING_PASSWORD", "AWAITING_MPIN"].includes(persistedStatus);

    const [committed] = await db
      .update(merchantPortalSessionsTable)
      .set({
        status:           persistedStatus,
        encryptedSession: hitMaxAttempts
          ? null
          : preserveSession
            ? (result.encryptedSessionToken ?? lifecycleSession.encryptedSession)
          : (result.encryptedSessionToken ?? null),
        lastStatusMessage: result.failReason ?? result.nextStepPrompt ?? null,
        stepFailureCount:  newStepFailureCount,
        ...lifecycle,
        connectedAt:       isConnected ? new Date() : lifecycleSession.connectedAt,
        processingLeaseId: null,
        processingLeaseExpiresAt: null,
        updatedAt:         now,
      })
      .where(
        and(
          eq(merchantPortalSessionsTable.id, lifecycleSession.id),
          eq(merchantPortalSessionsTable.processingLeaseId, leaseId),
        ),
      )
      .returning({ id: merchantPortalSessionsTable.id });

    if (!committed) {
      res.status(409).json({
        status: "FAILED",
        errorCode: "SESSION_STATE_CHANGED",
        message: "The portal session changed while this submission was in progress. Refresh and try again.",
      });
      return;
    }

    // Log: status, providerSlug, merchantId only. No OTP value.
    logger.info(
      {
        merchantId,
        providerSlug,
        status:       persistedStatus,
        failures:     newOtpFailureCount,
        // failReason is safe — it's an error code like "INVALID_OTP", not the OTP itself
        failReason:   result.failReason ?? null,
      },
      "merchant_portal_submit_step",
    );

    res.json({
      status:    persistedStatus,
      errorCode: result.failReason ?? null,
      message:   hitMaxAttempts
        ? `Maximum OTP attempts reached. Please re-initiate the session.`
        : (result.nextStepPrompt ?? result.failDetail ?? null),
      nextStep:  result.nextStep ?? null,
      ...otpLifecycleMetadata(lifecycle),
    });
  } catch (err: any) {
    if (err instanceof BrowserRuntimeUnavailableError) {
      // A browser worker can fail after PostgreSQL granted the lease. Release
      // it only if it is still ours, and undo the reservation so a later
      // request can retry without consuming an OTP attempt or resend slot.
      if (reservedLeaseId && reservedSessionId && reservedLifecycle) {
        await db
          .update(merchantPortalSessionsTable)
          .set({
            otpVerificationFailureCount: reservedLifecycle.otpVerificationFailureCount,
            otpResendCount: reservedLifecycle.otpResendCount,
            otpResendAvailableAt: reservedLifecycle.otpResendAvailableAt,
            otpExpiresAt: reservedLifecycle.otpExpiresAt,
            processingLeaseId: null,
            processingLeaseExpiresAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(merchantPortalSessionsTable.id, reservedSessionId),
              eq(merchantPortalSessionsTable.processingLeaseId, reservedLeaseId),
            ),
          );
      }
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
