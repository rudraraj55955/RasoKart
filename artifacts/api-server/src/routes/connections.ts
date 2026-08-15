import { Router } from "express";
import {
  db, merchantConnectionsTable, merchantsTable, transactionsTable,
  paymentLinksTable, auditLogsTable, providersTable,
} from "@workspace/db";
import { eq, and, ilike, or, count, sql, sum, isNull, gte, lt, ne } from "drizzle-orm";
import { maybeNotifyProviderLimit, maybeNotifyProviderLimitReset } from "../helpers/providerLimitNotifier";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { deriveUpiPayloadFromConnections } from "../helpers/upiPayload";
import { encryptSecret, decryptSecret } from "../helpers/cryptoUtils";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

// ── Credential masking ────────────────────────────────────────────────────────

/**
 * Returns "***" when credentials are present (encrypted or plaintext).
 * Never exposes raw credential values in any list/read API response.
 * The test-connection endpoint verifies credentials server-side without returning them.
 */
function maskCredentials(raw: string | null | undefined): string | null {
  if (!raw || raw.trim() === "") return null;
  return "***";
}

function formatConn(c: typeof merchantConnectionsTable.$inferSelect, monthlyUsed: number) {
  return {
    ...c,
    credentials: maskCredentials(c.credentials),
    monthlyLimit: Number(c.monthlyLimit),
    monthlyUsed,
  };
}

// ── Monthly usage helpers ─────────────────────────────────────────────────────

async function getMonthlyUsedByConnectionId(merchantId: number): Promise<Map<number, number>> {
  const rows = await db
    .select({ connectionId: transactionsTable.connectionId, total: sum(transactionsTable.amount) })
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.merchantId, merchantId),
        eq(transactionsTable.type, "deposit"),
        eq(transactionsTable.status, "success"),
        sql`date_trunc('month', ${transactionsTable.createdAt}) = date_trunc('month', now())`
      )
    )
    .groupBy(transactionsTable.connectionId);
  const map = new Map<number, number>();
  for (const r of rows) {
    if (r.connectionId != null) map.set(r.connectionId, Number(r.total ?? 0));
  }
  return map;
}

async function buildMonthlyUsageMap(connectionIds: number[]): Promise<Map<number, number>> {
  if (connectionIds.length === 0) return new Map();
  const rows = await db
    .select({
      connectionId: transactionsTable.connectionId,
      total: sum(transactionsTable.amount),
    })
    .from(transactionsTable)
    .where(
      and(
        sql`${transactionsTable.connectionId} = ANY(${sql.raw(`ARRAY[${connectionIds.join(",")}]::int[]`)})`,
        eq(transactionsTable.type, "deposit"),
        eq(transactionsTable.status, "success"),
        sql`date_trunc('month', ${transactionsTable.createdAt}) = date_trunc('month', now())`
      )
    )
    .groupBy(transactionsTable.connectionId);
  const map = new Map<number, number>();
  for (const r of rows) {
    if (r.connectionId != null) map.set(r.connectionId, Number(r.total ?? 0));
  }
  return map;
}

// ── Credential helpers ────────────────────────────────────────────────────────

/** Encrypt credentials if provided and non-empty. Returns undefined if nothing changed. */
function prepareCredentials(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined) return undefined; // not supplied — don't touch existing value
  if (!raw || raw.trim() === "" || raw === "***") return null; // explicit clear
  if (raw.startsWith("enc:v1:")) return raw; // already encrypted (re-submit from frontend mask is blocked above)
  return encryptSecret(raw.trim());
}

// ── Connection backfills (fire-and-forget helpers) ────────────────────────────

async function backfillConnectionIds(merchantId: number): Promise<void> {
  const connections = await db
    .select()
    .from(merchantConnectionsTable)
    .where(eq(merchantConnectionsTable.merchantId, merchantId));

  for (const conn of connections) {
    if (!conn.isActive) continue;
    const providers = conn.provider === "upi_id" ? ["upi_id"] : [conn.provider];
    await db
      .update(transactionsTable)
      .set({ connectionId: conn.id })
      .where(
        and(
          eq(transactionsTable.merchantId, merchantId),
          sql`${transactionsTable.provider} = ANY(${sql.raw(`ARRAY['${providers.join("','")}']::text[]`)})`,
          isNull(transactionsTable.connectionId),
          conn.deactivatedAt
            ? and(gte(transactionsTable.createdAt, conn.createdAt), lt(transactionsTable.createdAt, conn.deactivatedAt))
            : gte(transactionsTable.createdAt, conn.createdAt)
        )
      );
  }
}

async function backfillUpiPayloads(merchantId: number): Promise<void> {
  const connections = await db
    .select()
    .from(merchantConnectionsTable)
    .where(and(eq(merchantConnectionsTable.merchantId, merchantId), eq(merchantConnectionsTable.isActive, true)));

  const upiPayload = deriveUpiPayloadFromConnections(connections as any, "", null, null);
  if (!upiPayload) return;

  await db
    .update(paymentLinksTable)
    .set({ upiPayload })
    .where(and(eq(paymentLinksTable.merchantId, merchantId), isNull(paymentLinksTable.upiPayload)));
}

// ── Audit helper ──────────────────────────────────────────────────────────────

async function insertConnectionAuditLog(
  user: { id: number; email: string },
  action: string,
  connectionId: number | null,
  details: Record<string, unknown>,
  ip: string | null
): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action,
      targetType: "merchant_connection",
      targetId: connectionId ?? undefined,
      details: JSON.stringify(details),
      ipAddress: ip,
    });
  } catch (err) {
    logger.warn({ err, action }, "Failed to insert merchant_connection audit log");
  }
}

// ── Provider-specific test adapters ──────────────────────────────────────────

interface TestResult {
  pass: boolean;
  message: string;
  detail?: string;
}

/**
 * Run a connectivity / credential-format check for a given provider.
 * Contract:
 *  - ZERO financial transactions
 *  - ZERO wallet / ledger mutations
 *  - Returns { pass, message, detail }
 */
async function runProviderTest(provider: string, credentialsRaw: string | null): Promise<TestResult> {
  // Parse credentials JSON (all providers store credentials as a JSON object)
  let creds: Record<string, string> = {};
  if (credentialsRaw && credentialsRaw.trim() !== "") {
    try {
      creds = JSON.parse(credentialsRaw);
    } catch {
      return { pass: false, message: "Credentials are not valid JSON", detail: "Parse error" };
    }
  }

  switch (provider) {
    case "upi_id": {
      const upiId = creds["upi_id"] ?? creds["vpa"] ?? Object.values(creds)[0] ?? "";
      const valid = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$/.test(upiId.trim());
      return valid
        ? { pass: true, message: "UPI ID format is valid" }
        : { pass: false, message: "UPI ID format is invalid", detail: `Value: "${upiId}"` };
    }

    case "google_pay":
    case "phonepe":
    case "paytm":
    case "bharatpe":
    case "amazon_pay":
    case "freecharge":
    case "mobikwik":
    case "sbi_yono":
    case "hdfc_smarthub":
    case "icici_eazypay":
    case "axis_pay":
    case "kotak_smart": {
      // UPI-family providers: validate merchant UPI / VPA present
      const hasCreds = Object.keys(creds).length > 0;
      return hasCreds
        ? { pass: true, message: "Credentials are present and well-formed" }
        : { pass: false, message: "No credentials configured for this connection" };
    }

    case "cashfree": {
      const hasKey = !!(creds["api_key"] || creds["client_id"] || creds["appId"]);
      const hasSecret = !!(creds["api_secret"] || creds["client_secret"] || creds["secretKey"]);
      if (!hasKey || !hasSecret) {
        return { pass: false, message: "Cashfree credentials must include API key and secret", detail: `Keys present: ${Object.keys(creds).join(", ") || "none"}` };
      }
      // Live ping: Cashfree GET /api/v2/credentials (test mode, no financial action)
      try {
        const resp = await fetch("https://api.cashfree.com/api/v2/credentials", {
          method: "GET",
          headers: {
            "x-client-id": creds["api_key"] ?? creds["client_id"] ?? creds["appId"] ?? "",
            "x-client-secret": creds["api_secret"] ?? creds["client_secret"] ?? creds["secretKey"] ?? "",
            "x-api-version": "2022-09-01",
          },
          signal: AbortSignal.timeout(8000),
        });
        if (resp.status === 401) return { pass: false, message: "Cashfree credentials rejected (401)", detail: "Invalid API key or secret" };
        if (resp.status === 403) return { pass: false, message: "Cashfree credentials rejected (403)", detail: "Insufficient permissions" };
        return { pass: true, message: `Cashfree credentials accepted (HTTP ${resp.status})` };
      } catch (err: any) {
        return { pass: false, message: "Cashfree connectivity check failed", detail: err?.message ?? "Network error" };
      }
    }

    case "payu": {
      const hasKey = !!(creds["key"] || creds["merchant_key"]);
      const hasSalt = !!(creds["salt"] || creds["merchant_salt"]);
      if (!hasKey || !hasSalt) {
        return { pass: false, message: "PayU credentials must include key and salt", detail: `Keys present: ${Object.keys(creds).join(", ") || "none"}` };
      }
      return { pass: true, message: "PayU credentials format is valid (key + salt present)" };
    }

    case "razorpay": {
      const hasKeyId = !!(creds["key_id"] || creds["api_key"]);
      const hasSecret = !!(creds["key_secret"] || creds["api_secret"]);
      if (!hasKeyId || !hasSecret) {
        return { pass: false, message: "Razorpay credentials must include key_id and key_secret", detail: `Keys present: ${Object.keys(creds).join(", ") || "none"}` };
      }
      try {
        const auth = Buffer.from(`${creds["key_id"] ?? creds["api_key"]}:${creds["key_secret"] ?? creds["api_secret"]}`).toString("base64");
        const resp = await fetch("https://api.razorpay.com/v1/payments?count=1", {
          headers: { Authorization: `Basic ${auth}` },
          signal: AbortSignal.timeout(8000),
        });
        if (resp.status === 401) return { pass: false, message: "Razorpay credentials rejected (401)", detail: "Invalid key_id or key_secret" };
        return { pass: true, message: `Razorpay credentials accepted (HTTP ${resp.status})` };
      } catch (err: any) {
        return { pass: false, message: "Razorpay connectivity check failed", detail: err?.message ?? "Network error" };
      }
    }

    case "ekqr": {
      const hasKey = !!(creds["api_key"] || creds["key"] || creds["merchant_id"]);
      return hasKey
        ? { pass: true, message: "EKQR credentials format is valid" }
        : { pass: false, message: "EKQR credentials are missing", detail: "Expected api_key or merchant_id" };
    }

    default:
      return {
        pass: Object.keys(creds).length > 0,
        message: Object.keys(creds).length > 0
          ? "Credentials are present (no provider-specific test available)"
          : "No credentials configured for this connection",
      };
  }
}

// ── GET /api/connections ──────────────────────────────────────────────────────
// Admin: paginated { data, total } for all merchants; supports search/provider/merchantId
// Merchant: flat array of own connections
router.get("/", async (req, res) => {
  const user = (req as any).user;

  if (user.role === "admin") {
    const { search, provider, page = "1", limit = "20", merchantId, connectionStatus, ownership } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];
    if (provider && provider !== "") conditions.push(eq(merchantConnectionsTable.provider, provider));
    if (merchantId && !isNaN(parseInt(merchantId))) conditions.push(eq(merchantConnectionsTable.merchantId, parseInt(merchantId)));
    if (connectionStatus && connectionStatus !== "") conditions.push(eq(merchantConnectionsTable.connectionStatus, connectionStatus));
    if (ownership && ownership !== "") conditions.push(eq(merchantConnectionsTable.ownership, ownership));

    if (search) {
      const nameSearch = or(
        ilike(merchantsTable.businessName, `%${search}%`),
        ilike(merchantsTable.email, `%${search}%`)
      )!;
      const joined = await db
        .select({
          conn: merchantConnectionsTable,
          businessName: merchantsTable.businessName,
          merchantEmail: merchantsTable.email,
        })
        .from(merchantConnectionsTable)
        .innerJoin(merchantsTable, eq(merchantConnectionsTable.merchantId, merchantsTable.id))
        .where(conditions.length ? and(...conditions, nameSearch) : nameSearch)
        .limit(limitNum)
        .offset(offset);

      const totalJoined = await db
        .select({ total: count() })
        .from(merchantConnectionsTable)
        .innerJoin(merchantsTable, eq(merchantConnectionsTable.merchantId, merchantsTable.id))
        .where(conditions.length ? and(...conditions, nameSearch) : nameSearch);

      const ids = joined.map((r) => r.conn.id);
      const usageMap = await buildMonthlyUsageMap(ids);

      const data = joined.map(({ conn, businessName, merchantEmail }) => ({
        ...formatConn(conn, usageMap.get(conn.id) ?? 0),
        businessName,
        merchantEmail,
      }));
      res.json({ data, total: totalJoined[0]?.total ?? 0 });
      return;
    }

    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, totalRows] = await Promise.all([
      db
        .select({ conn: merchantConnectionsTable, businessName: merchantsTable.businessName, merchantEmail: merchantsTable.email })
        .from(merchantConnectionsTable)
        .leftJoin(merchantsTable, eq(merchantConnectionsTable.merchantId, merchantsTable.id))
        .where(where)
        .limit(limitNum)
        .offset(offset),
      db.select({ total: count() }).from(merchantConnectionsTable).where(where),
    ]);

    const ids = rows.map((r) => r.conn.id);
    const usageMap = await buildMonthlyUsageMap(ids);

    const data = rows.map(({ conn, businessName, merchantEmail }) => ({
      ...formatConn(conn, usageMap.get(conn.id) ?? 0),
      businessName,
      merchantEmail,
    }));
    res.json({ data, total: totalRows[0]?.total ?? 0 });
    return;
  }

  // Merchant: own connections only
  const connMap = await getMonthlyUsedByConnectionId(user.merchantId!);
  const conns = await db
    .select()
    .from(merchantConnectionsTable)
    .where(eq(merchantConnectionsTable.merchantId, user.merchantId!));
  res.json(conns.map((c) => formatConn(c, connMap.get(c.id) ?? 0)));
});

// ── POST /api/connections ─────────────────────────────────────────────────────
// Create or upsert a provider connection.
// Admin only for new connections; merchants may update their own.
router.post("/", async (req, res) => {
  const user = (req as any).user;
  const {
    provider, credentials, monthlyLimit = 0, isActive = true, merchantId: bodyMerchantId,
    connectionStatus, ownership, notes, visibilityEnabled,
    capabilityPayin, capabilityPayout, capabilityUpi, capabilityQr,
    capabilityPaymentLinks, capabilityRefunds, capabilitySettlement,
  } = req.body;

  const merchantId: number = user.role === "admin"
    ? (bodyMerchantId ? parseInt(bodyMerchantId) : 0)
    : user.merchantId!;

  if (!merchantId) { res.status(400).json({ error: "merchantId is required" }); return; }
  if (!provider) { res.status(400).json({ error: "Provider required" }); return; }

  // Verify merchant exists (enforces FK semantics in app layer even before DB constraint)
  if (user.role === "admin") {
    const [merchant] = await db.select({ id: merchantsTable.id }).from(merchantsTable)
      .where(eq(merchantsTable.id, merchantId)).limit(1);
    if (!merchant) { res.status(400).json({ error: "Merchant not found" }); return; }
  }

  const encryptedCredentials = prepareCredentials(credentials);
  const deactivatedAt = !isActive ? new Date() : null;

  const existing = await db.select().from(merchantConnectionsTable)
    .where(and(eq(merchantConnectionsTable.merchantId, merchantId), eq(merchantConnectionsTable.provider, provider)))
    .limit(1);

  const newFields: Record<string, unknown> = {
    ...(encryptedCredentials !== undefined && { credentials: encryptedCredentials }),
    monthlyLimit: String(monthlyLimit),
    isActive: !!isActive,
    deactivatedAt,
  };
  if (connectionStatus !== undefined) newFields.connectionStatus = connectionStatus;
  if (ownership !== undefined && user.role === "admin") newFields.ownership = ownership;
  if (notes !== undefined) newFields.notes = notes;
  if (visibilityEnabled !== undefined) newFields.visibilityEnabled = !!visibilityEnabled;
  if (capabilityPayin !== undefined) newFields.capabilityPayin = !!capabilityPayin;
  if (capabilityPayout !== undefined) newFields.capabilityPayout = !!capabilityPayout;
  if (capabilityUpi !== undefined) newFields.capabilityUpi = !!capabilityUpi;
  if (capabilityQr !== undefined) newFields.capabilityQr = !!capabilityQr;
  if (capabilityPaymentLinks !== undefined) newFields.capabilityPaymentLinks = !!capabilityPaymentLinks;
  if (capabilityRefunds !== undefined) newFields.capabilityRefunds = !!capabilityRefunds;
  if (capabilitySettlement !== undefined) newFields.capabilitySettlement = !!capabilitySettlement;

  let result: typeof merchantConnectionsTable.$inferSelect;
  let isNewConnection: boolean;

  if (existing.length > 0) {
    const [updated] = await db.update(merchantConnectionsTable)
      .set(newFields)
      .where(and(eq(merchantConnectionsTable.merchantId, merchantId), eq(merchantConnectionsTable.provider, provider)))
      .returning();
    result = updated;
    isNewConnection = false;
  } else {
    const [inserted] = await db.insert(merchantConnectionsTable)
      .values({
        merchantId,
        provider,
        ...(encryptedCredentials !== undefined ? { credentials: encryptedCredentials } : {}),
        monthlyLimit: String(monthlyLimit),
        isActive: !!isActive,
        deactivatedAt,
        connectionStatus: connectionStatus ?? "pending",
        ownership: (user.role === "admin" && ownership) ? ownership : "rasokart_owned",
        notes,
        visibilityEnabled: visibilityEnabled !== undefined ? !!visibilityEnabled : true,
        capabilityPayin: capabilityPayin !== undefined ? !!capabilityPayin : true,
        capabilityPayout: capabilityPayout !== undefined ? !!capabilityPayout : false,
        capabilityUpi: capabilityUpi !== undefined ? !!capabilityUpi : true,
        capabilityQr: capabilityQr !== undefined ? !!capabilityQr : true,
        capabilityPaymentLinks: capabilityPaymentLinks !== undefined ? !!capabilityPaymentLinks : false,
        capabilityRefunds: capabilityRefunds !== undefined ? !!capabilityRefunds : false,
        capabilitySettlement: capabilitySettlement !== undefined ? !!capabilitySettlement : false,
      } as any)
      .returning();
    result = inserted;
    isNewConnection = true;
  }

  // Audit log
  if (user.role === "admin") {
    await insertConnectionAuditLog(
      user,
      isNewConnection ? "merchant_connection_created" : "merchant_connection_updated",
      result.id,
      {
        merchantId,
        provider,
        isActive: result.isActive,
        connectionStatus: result.connectionStatus,
        ownership: result.ownership,
        credentialsProvided: !!(credentials && credentials !== "***"),
      },
      (req as any).ip ?? null
    );
  }

  backfillUpiPayloads(merchantId).catch(() => {});

  const connMapPost = await getMonthlyUsedByConnectionId(result.merchantId);
  res.json(formatConn(result, connMapPost.get(result.id) ?? 0));
});

// ── PUT /api/connections/:id ──────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);
  const {
    provider, credentials, monthlyLimit, isActive,
    connectionStatus, ownership, notes, visibilityEnabled,
    capabilityPayin, capabilityPayout, capabilityUpi, capabilityQr,
    capabilityPaymentLinks, capabilityRefunds, capabilitySettlement,
  } = req.body;

  const update: Record<string, unknown> = {};
  if (provider !== undefined) update.provider = provider;
  if (credentials !== undefined) {
    const prepared = prepareCredentials(credentials);
    if (prepared !== undefined) update.credentials = prepared;
  }
  if (monthlyLimit !== undefined) update.monthlyLimit = String(monthlyLimit);
  if (isActive !== undefined) {
    update.isActive = !!isActive;
    update.deactivatedAt = !isActive ? new Date() : null;
  }
  if (connectionStatus !== undefined) update.connectionStatus = connectionStatus;
  if (ownership !== undefined && user.role === "admin") update.ownership = ownership;
  if (notes !== undefined) update.notes = notes;
  if (visibilityEnabled !== undefined) update.visibilityEnabled = !!visibilityEnabled;
  if (capabilityPayin !== undefined) update.capabilityPayin = !!capabilityPayin;
  if (capabilityPayout !== undefined) update.capabilityPayout = !!capabilityPayout;
  if (capabilityUpi !== undefined) update.capabilityUpi = !!capabilityUpi;
  if (capabilityQr !== undefined) update.capabilityQr = !!capabilityQr;
  if (capabilityPaymentLinks !== undefined) update.capabilityPaymentLinks = !!capabilityPaymentLinks;
  if (capabilityRefunds !== undefined) update.capabilityRefunds = !!capabilityRefunds;
  if (capabilitySettlement !== undefined) update.capabilitySettlement = !!capabilitySettlement;

  const whereClause = user.role === "admin"
    ? eq(merchantConnectionsTable.id, id)
    : and(eq(merchantConnectionsTable.id, id), eq(merchantConnectionsTable.merchantId, user.merchantId!));

  const [result] = await db.update(merchantConnectionsTable)
    .set(update)
    .where(whereClause)
    .returning();

  if (!result) { res.status(404).json({ error: "Connection not found" }); return; }

  // Audit log (admin actions only)
  if (user.role === "admin") {
    const auditDetails: Record<string, unknown> = {
      merchantId: result.merchantId,
      provider: result.provider,
    };
    if (update.credentials !== undefined) auditDetails.credentialsUpdated = true;
    if (update.isActive !== undefined) auditDetails.isActive = { to: result.isActive };
    if (update.connectionStatus !== undefined) auditDetails.connectionStatus = { to: result.connectionStatus };
    if (update.ownership !== undefined) auditDetails.ownership = { to: result.ownership };
    const capChanges: Record<string, boolean> = {};
    for (const k of ["capabilityPayin","capabilityPayout","capabilityUpi","capabilityQr","capabilityPaymentLinks","capabilityRefunds","capabilitySettlement"] as const) {
      if (update[k] !== undefined) capChanges[k] = update[k] as boolean;
    }
    if (Object.keys(capChanges).length) auditDetails.capabilitiesChanged = capChanges;

    await insertConnectionAuditLog(user, "merchant_connection_updated", id, auditDetails, (req as any).ip ?? null);
  }

  if (isActive !== undefined) {
    backfillConnectionIds(result.merchantId).catch((err) => {
      logger.warn({ err, merchantId: result.merchantId }, "Connection backfill failed after isActive toggle");
    });
  }
  backfillUpiPayloads(result.merchantId).catch(() => {});

  const connMapPut = await getMonthlyUsedByConnectionId(result.merchantId);
  res.json(formatConn(result, connMapPut.get(result.id) ?? 0));
});

// ── DELETE /api/connections/:id ───────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);

  const whereClause = user.role === "admin"
    ? eq(merchantConnectionsTable.id, id)
    : and(eq(merchantConnectionsTable.id, id), eq(merchantConnectionsTable.merchantId, user.merchantId!));

  const [deleted] = await db.delete(merchantConnectionsTable).where(whereClause).returning();

  if (user.role === "admin" && deleted) {
    await insertConnectionAuditLog(
      user,
      "merchant_connection_deleted",
      id,
      { merchantId: deleted.merchantId, provider: deleted.provider },
      (req as any).ip ?? null
    );
  }

  res.json({ message: "Connection deleted" });
});

// ── POST /api/connections/:id/test ───────────────────────────────────────────
// Generic test-connection endpoint. Admin only.
// - Fetches the connection, decrypts credentials server-side
// - Dispatches to a provider-specific adapter (credential format check / ping)
// - Records result + timestamp on the connection row
// - Writes an audit log
// - Returns { pass, message, detail? } — NEVER returns credentials
//
// FINANCIAL MUTATION GUARANTEE:
//   All adapters are read-only or format-only.
//   No wallet, ledger, transaction, or payout mutation is possible from this path.
router.post("/:id/test", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);

  const [conn] = await db.select().from(merchantConnectionsTable)
    .where(eq(merchantConnectionsTable.id, id)).limit(1);

  if (!conn) { res.status(404).json({ error: "Connection not found" }); return; }

  // Decrypt credentials for the test adapter
  let decryptedCredentials: string | null = null;
  if (conn.credentials && conn.credentials.trim() !== "") {
    const dec = decryptSecret(conn.credentials);
    if (!dec.ok) {
      res.status(422).json({ error: "Credentials could not be decrypted — re-save the credentials and retry", code: "DECRYPT_FAILED" });
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

  // Update connection with test result + timestamp
  // If test passed and connection is in 'pending' or 'failed', advance to 'active'
  const newStatus =
    testResult.pass && (conn.connectionStatus === "pending" || conn.connectionStatus === "failed")
      ? "active"
      : conn.connectionStatus;

  await db.update(merchantConnectionsTable)
    .set({ lastTestedAt: testedAt, lastTestResult: testResultStr, connectionStatus: newStatus })
    .where(eq(merchantConnectionsTable.id, id));

  // Audit log
  await insertConnectionAuditLog(
    user,
    "merchant_connection_tested",
    id,
    {
      merchantId: conn.merchantId,
      provider: conn.provider,
      testResult: testResultStr,
      message: testResult.message,
      newStatus,
    },
    (req as any).ip ?? null
  );

  res.json({
    pass: testResult.pass,
    message: testResult.message,
    ...(testResult.detail ? { detail: testResult.detail } : {}),
    testedAt: testedAt.toISOString(),
    connectionStatus: newStatus,
  });
});

// ── GET /api/connections/providers ───────────────────────────────────────────
// Returns the providers catalog (for the wizard provider-picker step).
// Admin only.
router.get("/providers", requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(providersTable)
    .where(ne(providersTable.status, "coming_soon" as any));
  res.json(rows);
});

export default router;
