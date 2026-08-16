/**
 * Platform Connections — RasoKart's own provider accounts.
 *
 * All routes are Super Admin-only (requireSuperAdmin middleware).
 * Credentials are write-only: read responses mask as "***".
 * Every mutating action writes an audit log row.
 *
 * Endpoints:
 *   GET    /api/platform-connections                — list all
 *   GET    /api/platform-connections/providers      — provider catalog (all)
 *   POST   /api/platform-connections                — create
 *   PUT    /api/platform-connections/:id            — update
 *   DELETE /api/platform-connections/:id            — disconnect
 *   POST   /api/platform-connections/:id/test       — verify credentials
 *   POST   /api/platform-connections/:id/enable     — enable (isActive=true)
 *   POST   /api/platform-connections/:id/disable    — disable (isActive=false)
 */

import { Router } from "express";
import { db, platformConnectionsTable, auditLogsTable, providersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireSuperAdmin } from "../middlewares/auth";
import { encryptSecret, decryptSecret } from "../helpers/cryptoUtils";
import { runProviderTest } from "../helpers/connectionTest";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth, requireSuperAdmin);

// ── Credential masking ────────────────────────────────────────────────────────

function maskCreds(raw: string | null | undefined): string | null {
  if (!raw || raw.trim() === "") return null;
  return "***";
}

function formatConn(c: typeof platformConnectionsTable.$inferSelect) {
  return { ...c, credentials: maskCreds(c.credentials) };
}

// ── Credential prep ───────────────────────────────────────────────────────────

function prepareCredentials(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  if (!raw || raw.trim() === "" || raw === "***") return null;
  if (raw.startsWith("enc:v1:")) return raw;
  return encryptSecret(raw.trim());
}

// ── Audit helper ──────────────────────────────────────────────────────────────

async function auditPlatformConn(
  user: { id: number; email: string },
  action: string,
  connId: number | null,
  details: Record<string, unknown>,
  ip: string | null
) {
  try {
    await db.insert(auditLogsTable).values({
      adminId:    user.id,
      adminEmail: user.email,
      action,
      targetType: "platform_connection",
      targetId:   connId ?? undefined,
      details:    JSON.stringify(details),
      ipAddress:  ip,
    });
  } catch (err) {
    logger.warn({ err, action }, "Failed to write platform_connection audit log");
  }
}

// ── GET /api/platform-connections ────────────────────────────────────────────

router.get("/", async (_req, res) => {
  const rows = await db.select().from(platformConnectionsTable).orderBy(platformConnectionsTable.provider);
  res.json(rows.map(formatConn));
});

// ── GET /api/platform-connections/providers ───────────────────────────────────
// All providers including coming_soon — SA may want to pre-configure them.

router.get("/providers", async (_req, res) => {
  const rows = await db.select().from(providersTable).orderBy(providersTable.sortOrder);
  res.json(rows);
});

// ── POST /api/platform-connections ───────────────────────────────────────────

router.post("/", async (req, res) => {
  const user = (req as any).user;
  const {
    provider, label, environment = "sandbox", credentials,
    connectionStatus = "pending", isActive = false, notes,
    capabilityPayin, capabilityPayout, capabilityUpi, capabilityQr,
    capabilityPaymentLinks, capabilityRefunds, capabilitySettlement,
  } = req.body;

  if (!provider) { res.status(400).json({ error: "provider is required" }); return; }

  const encryptedCreds = prepareCredentials(credentials);

  const [inserted] = await db.insert(platformConnectionsTable).values({
    provider,
    label:          label || null,
    environment:    environment === "live" ? "live" : "sandbox",
    credentials:    encryptedCreds !== undefined ? encryptedCreds : null,
    connectionStatus,
    isActive:       !!isActive,
    notes:          notes || null,
    createdByEmail: user.email,
    capabilityPayin:        capabilityPayin        !== undefined ? !!capabilityPayin        : true,
    capabilityPayout:       capabilityPayout       !== undefined ? !!capabilityPayout       : false,
    capabilityUpi:          capabilityUpi          !== undefined ? !!capabilityUpi          : true,
    capabilityQr:           capabilityQr           !== undefined ? !!capabilityQr           : true,
    capabilityPaymentLinks: capabilityPaymentLinks !== undefined ? !!capabilityPaymentLinks : false,
    capabilityRefunds:      capabilityRefunds      !== undefined ? !!capabilityRefunds      : false,
    capabilitySettlement:   capabilitySettlement   !== undefined ? !!capabilitySettlement   : false,
  } as any).returning();

  await auditPlatformConn(user, "platform_connection_created", inserted.id, {
    provider,
    environment,
    credentialsProvided: !!(credentials && credentials !== "***"),
  }, (req as any).ip ?? null);

  res.json(formatConn(inserted));
});

// ── PUT /api/platform-connections/:id ────────────────────────────────────────

router.put("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);
  const {
    label, environment, credentials, connectionStatus, isActive, notes,
    capabilityPayin, capabilityPayout, capabilityUpi, capabilityQr,
    capabilityPaymentLinks, capabilityRefunds, capabilitySettlement,
  } = req.body;

  const update: Record<string, unknown> = {};
  if (label       !== undefined) update.label       = label || null;
  if (environment !== undefined) update.environment = environment === "live" ? "live" : "sandbox";
  if (notes       !== undefined) update.notes       = notes || null;
  if (credentials !== undefined) {
    const prepared = prepareCredentials(credentials);
    if (prepared !== undefined) update.credentials = prepared;
  }
  if (connectionStatus !== undefined) update.connectionStatus = connectionStatus;
  if (isActive         !== undefined) {
    update.isActive      = !!isActive;
    update.deactivatedAt = !isActive ? new Date() : null;
  }
  if (capabilityPayin        !== undefined) update.capabilityPayin        = !!capabilityPayin;
  if (capabilityPayout       !== undefined) update.capabilityPayout       = !!capabilityPayout;
  if (capabilityUpi          !== undefined) update.capabilityUpi          = !!capabilityUpi;
  if (capabilityQr           !== undefined) update.capabilityQr           = !!capabilityQr;
  if (capabilityPaymentLinks !== undefined) update.capabilityPaymentLinks = !!capabilityPaymentLinks;
  if (capabilityRefunds      !== undefined) update.capabilityRefunds      = !!capabilityRefunds;
  if (capabilitySettlement   !== undefined) update.capabilitySettlement   = !!capabilitySettlement;

  const [result] = await db.update(platformConnectionsTable)
    .set(update)
    .where(eq(platformConnectionsTable.id, id))
    .returning();

  if (!result) { res.status(404).json({ error: "Platform connection not found" }); return; }

  const auditDetails: Record<string, unknown> = { provider: result.provider };
  if (update.credentials  !== undefined) auditDetails.credentialsUpdated = true;
  if (update.isActive     !== undefined) auditDetails.isActive = { to: result.isActive };
  if (update.environment  !== undefined) auditDetails.environment = { to: result.environment };
  await auditPlatformConn(user, "platform_connection_updated", id, auditDetails, (req as any).ip ?? null);

  res.json(formatConn(result));
});

// ── DELETE /api/platform-connections/:id ─────────────────────────────────────

router.delete("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);

  const [deleted] = await db.delete(platformConnectionsTable)
    .where(eq(platformConnectionsTable.id, id))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Platform connection not found" }); return; }

  await auditPlatformConn(user, "platform_connection_deleted", id, {
    provider: deleted.provider,
    environment: deleted.environment,
  }, (req as any).ip ?? null);

  res.json({ message: "Platform connection deleted" });
});

// ── POST /api/platform-connections/:id/test ───────────────────────────────────
// Verify credentials server-side. Zero financial mutations.

router.post("/:id/test", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);

  const [conn] = await db.select().from(platformConnectionsTable)
    .where(eq(platformConnectionsTable.id, id)).limit(1);
  if (!conn) { res.status(404).json({ error: "Platform connection not found" }); return; }

  let decryptedCredentials: string | null = null;
  if (conn.credentials && conn.credentials.trim() !== "") {
    const dec = decryptSecret(conn.credentials);
    if (!dec.ok) {
      res.status(422).json({ error: "Credentials could not be decrypted — re-save credentials and retry", code: "DECRYPT_FAILED" });
      return;
    }
    decryptedCredentials = dec.value;
  }

  let testResult: { pass: boolean; message: string; detail?: string };
  try {
    testResult = await runProviderTest(conn.provider, decryptedCredentials);
  } catch (err: any) {
    testResult = { pass: false, message: "Test threw an unexpected error", detail: err?.message ?? "Unknown" };
  }

  const testResultStr = testResult.pass ? "pass" : "fail";
  const testedAt = new Date();
  const newStatus =
    testResult.pass && (conn.connectionStatus === "pending" || conn.connectionStatus === "failed")
      ? "active"
      : conn.connectionStatus;

  await db.update(platformConnectionsTable)
    .set({ lastTestedAt: testedAt, lastTestResult: testResultStr, connectionStatus: newStatus })
    .where(eq(platformConnectionsTable.id, id));

  await auditPlatformConn(user, "platform_connection_tested", id, {
    provider:   conn.provider,
    testResult: testResultStr,
    message:    testResult.message,
    newStatus,
  }, (req as any).ip ?? null);

  res.json({
    pass: testResult.pass,
    message: testResult.message,
    ...(testResult.detail ? { detail: testResult.detail } : {}),
    testedAt:         testedAt.toISOString(),
    connectionStatus: newStatus,
  });
});

// ── POST /api/platform-connections/:id/enable ────────────────────────────────

router.post("/:id/enable", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);
  const [result] = await db.update(platformConnectionsTable)
    .set({ isActive: true, connectionStatus: "active", deactivatedAt: null })
    .where(eq(platformConnectionsTable.id, id))
    .returning();
  if (!result) { res.status(404).json({ error: "Platform connection not found" }); return; }
  await auditPlatformConn(user, "platform_connection_enabled", id, { provider: result.provider }, (req as any).ip ?? null);
  res.json(formatConn(result));
});

// ── POST /api/platform-connections/:id/disable ───────────────────────────────

router.post("/:id/disable", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);
  const [result] = await db.update(platformConnectionsTable)
    .set({ isActive: false, connectionStatus: "suspended", deactivatedAt: new Date() })
    .where(eq(platformConnectionsTable.id, id))
    .returning();
  if (!result) { res.status(404).json({ error: "Platform connection not found" }); return; }
  await auditPlatformConn(user, "platform_connection_disabled", id, { provider: result.provider }, (req as any).ip ?? null);
  res.json(formatConn(result));
});

export default router;
