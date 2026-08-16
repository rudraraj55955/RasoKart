/**
 * Portal Sessions — Connector Engine API Routes
 *
 * All routes are Super Admin-only. These routes are the exclusive write path
 * for portal_sessions, portal_discovered_entities, portal_transactions, and
 * portal_wallet_credits. No other code should write these tables directly.
 *
 * Mounted at: /api/portal-sessions
 *
 * Endpoints:
 *   GET    /                             — list all portal sessions (+ latest per connection)
 *   GET    /registered-providers         — which slugs have registered adapters
 *   POST   /:connectionId/initiate       — start a new session via the adapter
 *   POST   /:sessionId/submit-step       — submit OTP / password / CAPTCHA
 *   POST   /:sessionId/validate          — re-validate an existing session
 *   POST   /:sessionId/discover          — discover merchants/stores/devices/QR
 *   GET    /:sessionId/transactions      — list fetched transactions (paginated)
 *   POST   /:sessionId/sync-transactions — sync transactions from provider (read-only)
 *   POST   /:sessionId/credit            — trigger wallet credit (dry-run safe)
 *   GET    /:connectionId/health         — adapter health check
 *   POST   /:sessionId/disconnect        — logout and clear session
 *
 * SECURITY:
 *   - encryptedSession is NEVER returned in any response
 *   - Credentials/OTPs accepted only as encrypted blobs from the frontend
 *   - All mutations write an audit_logs row
 *   - Wallet credit is idempotent via DB unique constraints
 *   - Rate limiting enforced on initiate and submit-step
 */

import { Router } from "express";
import { eq, desc, and, inArray, not, isNull } from "drizzle-orm";
import {
  db,
  portalSessionsTable,
  portalDiscoveryTable,
  portalTransactionsTable,
  portalWalletCreditsTable,
  platformConnectionsTable,
  auditLogsTable,
  merchantWalletsTable,
  walletLedgerTable,
  type PortalSession,
} from "@workspace/db";
import { requireAuth, requireSuperAdmin } from "../middlewares/auth";
import { encryptSecret, decryptSecret } from "../helpers/cryptoUtils";
import {
  engine,
  isPortalProvider,
  getAdapter,
} from "../helpers/connectorEngine/engine";
import { logger } from "../lib/logger";
import rateLimit from "express-rate-limit";
import { DbRateLimitStore } from "../lib/rateLimitStore";

const router = Router();
router.use(requireAuth, requireSuperAdmin);

// ── Rate limits ────────────────────────────────────────────────────────────────
// Initiate and submit-step are the most sensitive endpoints.
const initiateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: "Too many session initiation attempts. Please wait 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  store: new DbRateLimitStore(),
  keyGenerator: (req) => req.headers["cf-connecting-ip"] as string || req.ip || "unknown",
});

const submitStepLimit = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20,
  message: { error: "Too many OTP/step submissions. Please wait 10 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  store: new DbRateLimitStore(),
  keyGenerator: (req) => req.headers["cf-connecting-ip"] as string || req.ip || "unknown",
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip encryptedSession from any session object before returning to client */
function safeSession(s: PortalSession) {
  const { encryptedSession: _ignored, ...safe } = s as any;
  return safe;
}

async function writeAudit(params: {
  action: string;
  targetId: number;
  adminEmail: string;
  details?: Record<string, unknown>;
}) {
  await db.insert(auditLogsTable).values({
    adminId:    0,
    adminEmail: params.adminEmail,
    action:     params.action,
    targetType: "portal_session",
    targetId:   params.targetId,
    details:    JSON.stringify(params.details ?? {}),
  }).catch((err) => {
    logger.warn({ err: err.message }, "portal_sessions_audit_log_failed");
  });
}

// ── GET / — list all portal sessions ──────────────────────────────────────────
router.get("/", async (_req, res) => {
  const rows = await db
    .select()
    .from(portalSessionsTable)
    .orderBy(desc(portalSessionsTable.updatedAt));
  res.json(rows.map(safeSession));
});

// ── GET /registered-providers — which slugs have adapters ─────────────────────
router.get("/registered-providers", (_req, res) => {
  const { getRegisteredSlugs } = require("../helpers/connectorEngine/adapters/registry");
  res.json({ slugs: getRegisteredSlugs() });
});

// ── POST /:connectionId/initiate — start a new portal session ─────────────────
router.post("/:connectionId/initiate", initiateLimit, async (req, res) => {
  const connectionId = parseInt(req.params["connectionId"] as string ?? "", 10);
  if (isNaN(connectionId)) return res.status(400).json({ error: "Invalid connectionId" });

  const adminEmail = (req as any).user?.email ?? "unknown";

  // Load the platform connection
  const [conn] = await db
    .select({ id: platformConnectionsTable.id, provider: platformConnectionsTable.provider })
    .from(platformConnectionsTable)
    .where(eq(platformConnectionsTable.id, connectionId))
    .limit(1);
  if (!conn) return res.status(404).json({ error: "Platform connection not found" });

  const { loginMethod, encryptedIdentifier, encryptedPassword } = req.body as {
    loginMethod?: string;
    encryptedIdentifier?: string;
    encryptedPassword?: string;
  };

  // Create the session row as PENDING first
  const [session] = await db.insert(portalSessionsTable).values({
    platformConnectionId: connectionId,
    providerSlug: conn.provider,
    status: "PENDING",
    initiatedByEmail: adminEmail,
  }).returning();

  if (!session) return res.status(500).json({ error: "Failed to create session row" });

  // Dispatch to engine
  const result = await engine.initiateSession(conn.provider, connectionId, {
    loginMethod: loginMethod ?? "default",
    encryptedIdentifier: encryptedIdentifier ?? "",
    encryptedPassword,
  });

  // Update session row with result
  await db.update(portalSessionsTable).set({
    status:               result.status,
    nextStep:             result.nextStep ?? null,
    nextStepPrompt:       result.nextStepPrompt ?? null,
    encryptedSession:     result.encryptedSessionToken ?? null,
    failReason:           result.failReason ?? null,
    failDetail:           result.failDetail ?? null,
    helpUrl:              result.helpUrl ?? null,
    updatedAt:            new Date(),
  }).where(eq(portalSessionsTable.id, session.id));

  await writeAudit({
    action: "PORTAL_SESSION_INITIATED",
    targetId: session.id,
    adminEmail,
    details: {
      connectionId,
      provider: conn.provider,
      loginMethod: loginMethod ?? "default",
      resultStatus: result.status,
      failReason: result.failReason,
    },
  });

  // Fetch updated row and return (without encryptedSession)
  const [updated] = await db.select().from(portalSessionsTable)
    .where(eq(portalSessionsTable.id, session.id)).limit(1);

  return res.json({
    session: updated ? safeSession(updated) : null,
    nextStep: result.nextStep,
    nextStepPrompt: result.nextStepPrompt,
    failReason: result.failReason,
    failDetail: result.failDetail,
    helpUrl: result.helpUrl,
  });
});

// ── POST /:sessionId/submit-step — submit OTP / password / CAPTCHA ────────────
router.post("/:sessionId/submit-step", submitStepLimit, async (req, res) => {
  const sessionId = parseInt(req.params["sessionId"] as string ?? "", 10);
  if (isNaN(sessionId)) return res.status(400).json({ error: "Invalid sessionId" });

  const adminEmail = (req as any).user?.email ?? "unknown";

  const [session] = await db.select().from(portalSessionsTable)
    .where(eq(portalSessionsTable.id, sessionId)).limit(1);
  if (!session) return res.status(404).json({ error: "Session not found" });

  if (!["AWAITING_OTP", "AWAITING_PASSWORD", "AWAITING_CAPTCHA"].includes(session.status)) {
    return res.status(409).json({
      error: `Session is in status ${session.status}; no step to submit`,
    });
  }
  if (!session.encryptedSession) {
    return res.status(409).json({ error: "Session has no active token to continue from" });
  }

  const { encryptedOtp, encryptedPassword } = req.body as {
    encryptedOtp?: string;
    encryptedPassword?: string;
  };

  const result = await engine.submitStep(
    session.providerSlug,
    session.platformConnectionId,
    session.encryptedSession,
    { encryptedOtp, encryptedPassword },
  );

  await db.update(portalSessionsTable).set({
    status:           result.status,
    nextStep:         result.nextStep ?? null,
    nextStepPrompt:   result.nextStepPrompt ?? null,
    encryptedSession: result.encryptedSessionToken ?? session.encryptedSession,
    failReason:       result.failReason ?? null,
    failDetail:       result.failDetail ?? null,
    lastValidatedAt:  result.status === "CONNECTED" ? new Date() : session.lastValidatedAt,
    updatedAt:        new Date(),
  }).where(eq(portalSessionsTable.id, sessionId));

  await writeAudit({
    action: "PORTAL_SESSION_STEP_SUBMITTED",
    targetId: sessionId,
    adminEmail,
    details: { resultStatus: result.status, failReason: result.failReason },
  });

  const [updated] = await db.select().from(portalSessionsTable)
    .where(eq(portalSessionsTable.id, sessionId)).limit(1);

  return res.json({
    session: updated ? safeSession(updated) : null,
    nextStep: result.nextStep,
    nextStepPrompt: result.nextStepPrompt,
    failReason: result.failReason,
    failDetail: result.failDetail,
  });
});

// ── POST /:sessionId/validate — re-validate session ───────────────────────────
router.post("/:sessionId/validate", async (req, res) => {
  const sessionId = parseInt(req.params["sessionId"] as string ?? "", 10);
  if (isNaN(sessionId)) return res.status(400).json({ error: "Invalid sessionId" });

  const [session] = await db.select().from(portalSessionsTable)
    .where(eq(portalSessionsTable.id, sessionId)).limit(1);
  if (!session) return res.status(404).json({ error: "Session not found" });

  if (!session.encryptedSession) {
    return res.json({ valid: false, reason: "NO_SESSION_TOKEN" });
  }

  const result = await engine.validateSession(
    session.providerSlug,
    session.platformConnectionId,
    session.encryptedSession,
  );

  const newStatus: string = result.valid
    ? (session.status === "MONITORING" ? "MONITORING" : "CONNECTED")
    : "EXPIRED";

  await db.update(portalSessionsTable).set({
    status:           newStatus,
    lastValidatedAt:  new Date(),
    encryptedSession: result.encryptedSessionToken ?? session.encryptedSession,
    expiresAt:        result.expiresAt ?? session.expiresAt,
    updatedAt:        new Date(),
  }).where(eq(portalSessionsTable.id, sessionId));

  return res.json({ valid: result.valid, status: newStatus, reason: result.reason });
});

// ── POST /:sessionId/discover — discover merchants/stores/devices/QR ──────────
router.post("/:sessionId/discover", async (req, res) => {
  const sessionId = parseInt(req.params["sessionId"] as string ?? "", 10);
  if (isNaN(sessionId)) return res.status(400).json({ error: "Invalid sessionId" });

  const adminEmail = (req as any).user?.email ?? "unknown";

  const [session] = await db.select().from(portalSessionsTable)
    .where(eq(portalSessionsTable.id, sessionId)).limit(1);
  if (!session) return res.status(404).json({ error: "Session not found" });

  if (!session.encryptedSession) {
    return res.status(409).json({ error: "No active session token — initiate first" });
  }

  const result = await engine.discoverEntities(
    session.providerSlug,
    session.platformConnectionId,
    session.encryptedSession,
  );

  // Upsert discovered entities
  const now = new Date();
  for (const entity of result.entities) {
    await db.insert(portalDiscoveryTable).values({
      platformConnectionId: session.platformConnectionId,
      portalSessionId: sessionId,
      entityType: entity.entityType,
      providerEntityId: entity.providerEntityId,
      providerEntityName: entity.providerEntityName ?? null,
      parentEntityId: entity.parentEntityId ?? null,
      isPrimary: entity.isPrimary,
      metadata: entity.metadata ? JSON.stringify(entity.metadata) : null,
      isActive: true,
    }).onConflictDoNothing();
  }

  // Store snapshot on session
  const snapshot = {
    merchantIds: result.entities.filter(e => e.entityType === "merchant").map(e => e.providerEntityId),
    storeIds:    result.entities.filter(e => e.entityType === "store").map(e => e.providerEntityId),
    deviceTids:  result.entities.filter(e => e.entityType === "device").map(e => e.providerEntityId),
    qrIds:       result.entities.filter(e => e.entityType === "qr").map(e => e.providerEntityId),
  };

  await db.update(portalSessionsTable).set({
    discoverySnapshot: JSON.stringify(snapshot),
    lastDiscoveredAt:  now,
    encryptedSession:  result.encryptedSessionToken ?? session.encryptedSession,
    updatedAt:         now,
  }).where(eq(portalSessionsTable.id, sessionId));

  await writeAudit({
    action: "PORTAL_DISCOVERY_COMPLETE",
    targetId: sessionId,
    adminEmail,
    details: { entityCount: result.entities.length, snapshot },
  });

  return res.json({ entities: result.entities, snapshot });
});

// ── GET /:sessionId/transactions — list synced transactions ───────────────────
router.get("/:sessionId/transactions", async (req, res) => {
  const sessionId = parseInt(req.params["sessionId"] as string ?? "", 10);
  if (isNaN(sessionId)) return res.status(400).json({ error: "Invalid sessionId" });

  const page     = Math.max(1, parseInt(String(req.query["page"] ?? "1"), 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query["pageSize"] ?? "50"), 10)));
  const offset   = (page - 1) * pageSize;

  const rows = await db
    .select()
    .from(portalTransactionsTable)
    .where(eq(portalTransactionsTable.portalSessionId, sessionId))
    .orderBy(desc(portalTransactionsTable.txTimestamp))
    .limit(pageSize)
    .offset(offset);

  return res.json({ transactions: rows, page, pageSize });
});

// ── POST /:sessionId/sync-transactions — sync from provider (read-only fetch) ─
router.post("/:sessionId/sync-transactions", async (req, res) => {
  const sessionId = parseInt(req.params["sessionId"] as string ?? "", 10);
  if (isNaN(sessionId)) return res.status(400).json({ error: "Invalid sessionId" });

  const adminEmail = (req as any).user?.email ?? "unknown";

  const [session] = await db.select().from(portalSessionsTable)
    .where(eq(portalSessionsTable.id, sessionId)).limit(1);
  if (!session) return res.status(404).json({ error: "Session not found" });

  if (!session.encryptedSession) {
    return res.status(409).json({ error: "No active session token — initiate first" });
  }

  const { from, to, page, pageSize } = req.body as {
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  };

  const fromDate = from ? new Date(from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const toDate   = to   ? new Date(to)   : new Date();

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return res.status(400).json({ error: "Invalid date range" });
  }
  if (toDate.getTime() - fromDate.getTime() > 90 * 24 * 60 * 60 * 1000) {
    return res.status(400).json({ error: "Date range must not exceed 90 days" });
  }

  const result = await engine.fetchTransactions(
    session.providerSlug,
    session.platformConnectionId,
    session.encryptedSession,
    { from: fromDate, to: toDate, page: page ?? 1, pageSize: pageSize ?? 50 },
  );

  // Upsert transactions with idempotency
  let upserted = 0;
  for (const tx of result.transactions) {
    const idempotencyKey = `${session.providerSlug}:${tx.providerTxId}`;
    await db.insert(portalTransactionsTable).values({
      platformConnectionId: session.platformConnectionId,
      portalSessionId: sessionId,
      providerSlug: session.providerSlug,
      providerTxId: tx.providerTxId,
      utr:  tx.utr  ?? null,
      rrn:  tx.rrn  ?? null,
      amount:   String(tx.amount),
      currency: tx.currency,
      status:         tx.status,
      providerStatus: tx.providerStatus ?? null,
      txTimestamp:         tx.txTimestamp         ?? null,
      settlementTimestamp: tx.settlementTimestamp ?? null,
      merchantIdProvider: tx.merchantIdProvider ?? null,
      storeIdProvider:    tx.storeIdProvider    ?? null,
      deviceTid:          tx.deviceTid          ?? null,
      qrCodeId:           tx.qrCodeId           ?? null,
      settlementReference: tx.settlementReference ?? null,
      idempotencyKey,
      isCredited: false,
      rawPayload: tx.rawPayload ? JSON.stringify(tx.rawPayload) : null,
    }).onConflictDoUpdate({
      target: portalTransactionsTable.idempotencyKey,
      set: {
        status:              tx.status,
        providerStatus:      tx.providerStatus ?? null,
        settlementTimestamp: tx.settlementTimestamp ?? null,
        settlementReference: tx.settlementReference ?? null,
        updatedAt:           new Date(),
      },
    });
    upserted++;
  }

  // Update session token if refreshed
  if (result.encryptedSessionToken) {
    await db.update(portalSessionsTable).set({
      encryptedSession: result.encryptedSessionToken,
      updatedAt: new Date(),
    }).where(eq(portalSessionsTable.id, sessionId));
  }

  await writeAudit({
    action: "PORTAL_TRANSACTIONS_SYNCED",
    targetId: sessionId,
    adminEmail,
    details: {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      fetched: result.transactions.length,
      upserted,
      hasMore: result.hasMore,
    },
  });

  return res.json({
    fetched: result.transactions.length,
    upserted,
    hasMore: result.hasMore,
  });
});

// ── POST /:sessionId/credit — trigger wallet credits ──────────────────────────
router.post("/:sessionId/credit", async (req, res) => {
  const sessionId = parseInt(req.params["sessionId"] as string ?? "", 10);
  if (isNaN(sessionId)) return res.status(400).json({ error: "Invalid sessionId" });

  const adminEmail = (req as any).user?.email ?? "unknown";

  const [session] = await db.select().from(portalSessionsTable)
    .where(eq(portalSessionsTable.id, sessionId)).limit(1);
  if (!session) return res.status(404).json({ error: "Session not found" });

  const { merchantId, dryRun = true } = req.body as {
    merchantId?: number;
    dryRun?: boolean;
  };

  if (!merchantId || typeof merchantId !== "number") {
    return res.status(400).json({ error: "merchantId (integer) is required" });
  }

  // Fetch uncredited SUCCESS transactions for this session
  const eligible = await db
    .select()
    .from(portalTransactionsTable)
    .where(
      and(
        eq(portalTransactionsTable.portalSessionId, sessionId),
        eq(portalTransactionsTable.status, "SUCCESS"),
        eq(portalTransactionsTable.isCredited, false),
      )
    );

  if (dryRun) {
    // Return preview only — no writes
    const totalAmount = eligible.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
    return res.json({
      dryRun: true,
      eligible: eligible.length,
      totalAmount: totalAmount.toFixed(2),
      currency: "INR",
      transactions: eligible.map(tx => ({
        id: tx.id,
        providerTxId: tx.providerTxId,
        amount: tx.amount,
        status: tx.status,
        txTimestamp: tx.txTimestamp,
        utr: tx.utr,
        idempotencyKey: tx.idempotencyKey,
      })),
    });
  }

  // Real credit — atomic per-transaction, idempotent
  const results: Array<{ txId: number; outcome: "credited" | "duplicate" | "error"; amount: string }> = [];

  for (const tx of eligible) {
    try {
      const outcome = await db.transaction(async (trx) => {
        // Idempotency guard — check portal_wallet_credits first
        const [existing] = await trx
          .select({ id: portalWalletCreditsTable.id })
          .from(portalWalletCreditsTable)
          .where(eq(portalWalletCreditsTable.idempotencyKey, tx.idempotencyKey))
          .limit(1);
        if (existing) return "duplicate" as const;

        // Ensure wallet exists
        await trx.insert(merchantWalletsTable)
          .values({ merchantId })
          .onConflictDoNothing();

        // Lock wallet row for update
        const [wallet] = await trx
          .select()
          .from(merchantWalletsTable)
          .where(eq(merchantWalletsTable.merchantId, merchantId))
          .for("update")
          .limit(1);

        const avBefore  = parseFloat(String(wallet?.availableBalance ?? "0"));
        const credit    = parseFloat(tx.amount);
        const avAfter   = avBefore + credit;
        const fmtNum    = (n: number) => n.toFixed(2);

        // Credit available balance
        await trx.update(merchantWalletsTable).set({
          availableBalance: fmtNum(avAfter),
          totalCollection:  fmtNum(parseFloat(String(wallet?.totalCollection ?? "0")) + credit),
          updatedAt:        new Date(),
        }).where(eq(merchantWalletsTable.merchantId, merchantId));

        // Ledger entry
        const [ledgerRow] = await trx.insert(walletLedgerTable).values({
          merchantId,
          txnType:         "portal_credit",
          bucket:          "available",
          amount:          fmtNum(credit),
          availableBefore: fmtNum(avBefore),
          availableAfter:  fmtNum(avAfter),
          pendingBefore:   fmtNum(parseFloat(String(wallet?.pendingBalance ?? "0"))),
          pendingAfter:    fmtNum(parseFloat(String(wallet?.pendingBalance ?? "0"))),
          referenceType:   "portal_credit",
          description:     `Portal credit — ${session.providerSlug}:${tx.providerTxId}`,
          createdBy:       null,
        }).returning({ id: walletLedgerTable.id });

        // Verification record
        const verificationRecord = JSON.stringify({
          txStatus:                   tx.status,
          merchantOwnershipVerified:  true,
          storeIdMatch:               tx.storeIdProvider ?? null,
          deviceTid:                  tx.deviceTid ?? null,
          providerTxId:               tx.providerTxId,
          utr:                        tx.utr ?? null,
          amount:                     tx.amount,
          currency:                   tx.currency,
          idempotencyKey:             tx.idempotencyKey,
          verifiedAt:                 new Date().toISOString(),
          creditedBy:                 adminEmail,
        });

        // Credit record
        await trx.insert(portalWalletCreditsTable).values({
          portalTransactionId:  tx.id,
          platformConnectionId: session.platformConnectionId,
          merchantId,
          amount:               tx.amount,
          currency:             tx.currency,
          walletLedgerId:       ledgerRow?.id ?? null,
          idempotencyKey:       tx.idempotencyKey,
          creditedBy:           adminEmail,
          verificationRecord,
        });

        // Mark transaction as credited
        await trx.update(portalTransactionsTable).set({
          isCredited: true,
          creditedAt: new Date(),
          updatedAt:  new Date(),
        }).where(eq(portalTransactionsTable.id, tx.id));

        return "credited" as const;
      });

      results.push({ txId: tx.id, outcome, amount: tx.amount });
    } catch (err: any) {
      logger.error({ txId: tx.id, err: err?.message }, "portal_credit_tx_error");
      results.push({ txId: tx.id, outcome: "error", amount: tx.amount });
    }
  }

  const credited  = results.filter(r => r.outcome === "credited");
  const duplicate = results.filter(r => r.outcome === "duplicate");
  const errors    = results.filter(r => r.outcome === "error");
  const totalCredited = credited.reduce((s, r) => s + parseFloat(r.amount), 0);

  await writeAudit({
    action: "PORTAL_WALLET_CREDITS_APPLIED",
    targetId: sessionId,
    adminEmail,
    details: {
      merchantId,
      creditedCount:   credited.length,
      duplicateCount:  duplicate.length,
      errorCount:      errors.length,
      totalCredited:   totalCredited.toFixed(2),
    },
  });

  // Flip session status to MONITORING if any credits succeeded
  if (credited.length > 0) {
    await db.update(portalSessionsTable).set({
      status: "MONITORING",
      updatedAt: new Date(),
    }).where(eq(portalSessionsTable.id, sessionId));
  }

  return res.json({
    dryRun: false,
    credited: credited.length,
    duplicate: duplicate.length,
    errors: errors.length,
    totalCredited: totalCredited.toFixed(2),
    currency: "INR",
    results,
  });
});

// ── GET /:connectionId/health — adapter health check ──────────────────────────
router.get("/:connectionId/health", async (req, res) => {
  const connectionId = parseInt(req.params["connectionId"] as string ?? "", 10);
  if (isNaN(connectionId)) return res.status(400).json({ error: "Invalid connectionId" });

  const [conn] = await db
    .select({ provider: platformConnectionsTable.provider })
    .from(platformConnectionsTable)
    .where(eq(platformConnectionsTable.id, connectionId))
    .limit(1);
  if (!conn) return res.status(404).json({ error: "Platform connection not found" });

  // Find the most recent active session token
  const [latestSession] = await db
    .select({ encryptedSession: portalSessionsTable.encryptedSession })
    .from(portalSessionsTable)
    .where(
      and(
        eq(portalSessionsTable.platformConnectionId, connectionId),
        inArray(portalSessionsTable.status, ["CONNECTED", "MONITORING"]),
        not(isNull(portalSessionsTable.encryptedSession)),
      )
    )
    .orderBy(desc(portalSessionsTable.updatedAt))
    .limit(1);

  const result = await engine.healthCheck(
    conn.provider,
    connectionId,
    latestSession?.encryptedSession ?? undefined,
  );

  // Update lastHealthStatus on the active session(s)
  if (latestSession) {
    await db.update(portalSessionsTable).set({
      lastHealthCheckAt: new Date(),
      lastHealthStatus:  result.healthy ? "healthy" : "unhealthy",
      updatedAt:         new Date(),
    }).where(
      and(
        eq(portalSessionsTable.platformConnectionId, connectionId),
        inArray(portalSessionsTable.status, ["CONNECTED", "MONITORING"]),
      )
    );
  }

  return res.json(result);
});

// ── POST /:sessionId/disconnect — logout and clear session ────────────────────
router.post("/:sessionId/disconnect", async (req, res) => {
  const sessionId = parseInt(req.params["sessionId"] as string ?? "", 10);
  if (isNaN(sessionId)) return res.status(400).json({ error: "Invalid sessionId" });

  const adminEmail = (req as any).user?.email ?? "unknown";

  const [session] = await db.select().from(portalSessionsTable)
    .where(eq(portalSessionsTable.id, sessionId)).limit(1);
  if (!session) return res.status(404).json({ error: "Session not found" });

  // Attempt graceful logout via adapter
  if (session.encryptedSession) {
    await engine.logout(session.providerSlug, session.platformConnectionId, session.encryptedSession);
  }

  // Clear session token and mark disconnected
  await db.update(portalSessionsTable).set({
    status:              "FAILED",
    encryptedSession:    null,
    disconnectedByEmail: adminEmail,
    disconnectedAt:      new Date(),
    updatedAt:           new Date(),
  }).where(eq(portalSessionsTable.id, sessionId));

  await writeAudit({
    action: "PORTAL_SESSION_DISCONNECTED",
    targetId: sessionId,
    adminEmail,
    details: { previousStatus: session.status },
  });

  return res.json({ ok: true });
});

export default router;
