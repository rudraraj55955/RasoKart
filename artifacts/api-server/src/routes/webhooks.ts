import { Router } from "express";
import { db, webhooksTable, callbackLogsTable, auditLogsTable } from "@workspace/db";
import { and, count, eq, gte, lte, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { fireCallback } from "../helpers/callbackRetry";
import crypto from "crypto";
import dns from "dns";
import net from "net";

const router = Router();
router.use(requireAuth);

// ─── SSRF guard ──────────────────────────────────────────────────────────────

/**
 * Returns true if the given IPv4 or IPv6 address belongs to a private,
 * loopback, link-local, or otherwise reserved range.
 */
function isPrivateOrReservedIP(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0) return true;                                  // 0.0.0.0/8
    if (a === 10) return true;                                 // 10.0.0.0/8 (RFC1918)
    if (a === 100 && b >= 64 && b <= 127) return true;        // 100.64.0.0/10 (CGNAT)
    if (a === 127) return true;                                // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true;                   // 169.254.0.0/16 link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;         // 172.16.0.0/12 (RFC1918)
    if (a === 192 && b === 0 && parts[2] === 0) return true;  // 192.0.0.0/24
    if (a === 192 && b === 168) return true;                   // 192.168.0.0/16 (RFC1918)
    if (a === 198 && (b === 18 || b === 19)) return true;     // 198.18.0.0/15 benchmarking
    if (a === 198 && b === 51 && parts[2] === 100) return true; // 198.51.100.0/24 TEST-NET-2
    if (a === 203 && b === 0 && parts[2] === 113) return true;  // 203.0.113.0/24 TEST-NET-3
    if (a === 240) return true;                                // 240.0.0.0/4 reserved
    if (ip === "255.255.255.255") return true;
    return false;
  }

  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
    if (norm === "::1") return true;                          // loopback
    if (norm === "::") return true;                           // unspecified
    if (norm.startsWith("fe80:")) return true;               // link-local fe80::/10
    if (norm.startsWith("fc") || norm.startsWith("fd")) return true; // unique local fc00::/7
    if (norm.startsWith("::ffff:")) {
      // IPv4-mapped — check the embedded v4 address
      const v4 = norm.slice(7);
      if (net.isIPv4(v4)) return isPrivateOrReservedIP(v4);
    }
    return false;
  }

  return true; // unknown format — block by default
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "169.254.169.254",        // AWS/Azure/GCP metadata (also covered by IP check)
  "metadata.internal",
]);

/**
 * Validates that a URL is safe to use as a webhook target:
 *  1. Must be https://
 *  2. Hostname must not be a known-blocked name
 *  3. All DNS-resolved IPs must be public (not private/link-local/loopback)
 *
 * Throws a descriptive Error on any violation.
 */
async function assertSafeWebhookUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("The webhook URL is not a valid URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Only HTTPS webhook URLs are supported.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error(`Webhook URL hostname "${hostname}" is not allowed.`);
  }

  // If the hostname is already an IP literal, check it immediately.
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIP(hostname)) {
      throw new Error("Webhook URL resolves to a private or reserved IP address.");
    }
    return;
  }

  // Resolve hostname and verify every returned IP is public.
  let addresses: string[];
  try {
    // resolve4 + resolve6 — if only one family fails that's fine; we only block if
    // a resolved address lands in a reserved range.
    const results = await Promise.allSettled([
      dns.promises.resolve4(hostname),
      dns.promises.resolve6(hostname),
    ]);
    addresses = results.flatMap(r => r.status === "fulfilled" ? r.value : []);
  } catch {
    throw new Error("Webhook URL hostname could not be resolved.");
  }

  if (addresses.length === 0) {
    throw new Error("Webhook URL hostname could not be resolved.");
  }

  for (const addr of addresses) {
    if (isPrivateOrReservedIP(addr)) {
      throw new Error("Webhook URL resolves to a private or reserved IP address.");
    }
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/webhooks/logs — recent delivery logs for the merchant
router.get("/logs", async (req, res) => {
  const user = (req as any).user;
  const merchantId = user.role === "merchant" ? user.merchantId! : undefined;
  if (!merchantId) {
    res.status(403).json({ error: "Merchants only" });
    return;
  }

  const limitNum = Math.min(50, Math.max(1, parseInt((req.query['limit'] as string) || "10")));
  const fromRaw = req.query['from'] as string | undefined;
  const toRaw = req.query['to'] as string | undefined;
  const eventTypeFilter = req.query['eventType'] as string | undefined;

  const fromDate = fromRaw ? new Date(fromRaw) : null;
  const toDate = toRaw ? new Date(toRaw) : null;

  const conditions = [
    eq(callbackLogsTable.merchantId, merchantId),
    ...(fromDate && !isNaN(fromDate.getTime()) ? [gte(callbackLogsTable.createdAt, fromDate)] : []),
    ...(toDate && !isNaN(toDate.getTime()) ? [lte(callbackLogsTable.createdAt, toDate)] : []),
    ...(eventTypeFilter ? [eq(callbackLogsTable.eventType, eventTypeFilter)] : []),
  ];

  const data = await db
    .select()
    .from(callbackLogsTable)
    .where(and(...conditions))
    .orderBy(sql`${callbackLogsTable.createdAt} DESC`)
    .limit(limitNum);

  res.json({ data, total: data.length, page: 1, limit: limitNum });
});

// GET /api/webhooks/logs/stats — per-event-type delivery stats for the merchant
router.get("/logs/stats", async (req, res) => {
  const user = (req as any).user;
  const merchantId = user.role === "merchant" ? user.merchantId! : undefined;
  if (!merchantId) {
    res.status(403).json({ error: "Merchants only" });
    return;
  }

  const rows = await db
    .select({
      eventType: callbackLogsTable.eventType,
      total: count(),
      success: sql<number>`COUNT(*) FILTER (WHERE ${callbackLogsTable.status} = 'success')`,
      failed: sql<number>`COUNT(*) FILTER (WHERE ${callbackLogsTable.status} != 'success')`,
    })
    .from(callbackLogsTable)
    .where(
      sql`${callbackLogsTable.merchantId} = ${merchantId} AND ${callbackLogsTable.eventType} IS NOT NULL`
    )
    .groupBy(callbackLogsTable.eventType);

  res.json({
    data: rows.map(r => ({
      eventType: r.eventType!,
      total: Number(r.total),
      success: Number(r.success),
      failed: Number(r.failed),
    })),
  });
});

// POST /api/webhooks/logs/:id/retry — merchant retries a failed webhook delivery
router.post("/logs/:id/retry", async (req, res) => {
  const user = (req as any).user;
  const merchantId = user.role === "merchant" ? user.merchantId! : undefined;
  if (!merchantId) {
    res.status(403).json({ error: "Merchants only" });
    return;
  }

  const id = parseInt(req.params['id'] as string);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid log id" });
    return;
  }

  const [log] = await db
    .select()
    .from(callbackLogsTable)
    .where(eq(callbackLogsTable.id, id))
    .limit(1);

  if (!log) {
    res.status(404).json({ error: "Webhook log not found" });
    return;
  }

  if (log.merchantId !== merchantId) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  if (log.status !== "failed" && log.status !== "pending_retry") {
    res.status(400).json({ error: "Only failed or pending-retry deliveries can be retried" });
    return;
  }

  if (!log.requestBody) {
    res.status(400).json({ error: "No request body stored — cannot replay this delivery" });
    return;
  }

  const now = new Date();
  const { ok, httpStatus, responseBody } = await fireCallback(log.url, log.requestBody);

  const newAttempts = log.attempts + 1;
  const newStatus = ok ? "success" : "failed";

  const [updated] = await db
    .update(callbackLogsTable)
    .set({
      status: newStatus,
      httpStatus,
      responseBody,
      attempts: newAttempts,
      nextRetryAt: null,
      lastAttemptAt: now,
    })
    .where(eq(callbackLogsTable.id, id))
    .returning();

  req.log.info({ logId: id, ok, httpStatus, merchantId }, "Merchant-triggered webhook retry");

  res.json({ success: ok, delivered: ok, log: updated });
});

const SUPPORTED_TEST_EVENTS = [
  "payment.success",
  "payment.failed",
  "payment.pending",
  "withdrawal.approved",
  "withdrawal.rejected",
  "settlement.processed",
] as const;

type SupportedTestEvent = typeof SUPPORTED_TEST_EVENTS[number];

function buildTestPayload(eventType: SupportedTestEvent, merchantId: number): object {
  const ts = new Date().toISOString();
  const txnId = "txn_test_" + crypto.randomBytes(8).toString("hex");
  const orderId = "order_test_" + crypto.randomBytes(6).toString("hex");

  switch (eventType) {
    case "payment.success":
      return {
        event: "payment.success",
        test: true,
        timestamp: ts,
        data: {
          transactionId: txnId,
          amount: 1000,
          currency: "INR",
          status: "success",
          merchantId,
          orderId,
          description: "Test event from RasoKart webhook tester",
        },
      };

    case "payment.failed":
      return {
        event: "payment.failed",
        test: true,
        timestamp: ts,
        data: {
          transactionId: txnId,
          amount: 1000,
          currency: "INR",
          status: "failed",
          merchantId,
          orderId,
          failureReason: "Insufficient funds",
          description: "Test event from RasoKart webhook tester",
        },
      };

    case "payment.pending":
      return {
        event: "payment.pending",
        test: true,
        timestamp: ts,
        data: {
          transactionId: txnId,
          amount: 1000,
          currency: "INR",
          status: "pending",
          merchantId,
          orderId,
          description: "Test event from RasoKart webhook tester",
        },
      };

    case "withdrawal.approved":
      return {
        event: "withdrawal.approved",
        test: true,
        timestamp: ts,
        data: {
          withdrawalId: "wdr_test_" + crypto.randomBytes(8).toString("hex"),
          amount: 5000,
          currency: "INR",
          status: "approved",
          merchantId,
          bankAccount: "XXXX1234",
          utr: "UTR" + crypto.randomBytes(6).toString("hex").toUpperCase(),
          description: "Test event from RasoKart webhook tester",
        },
      };

    case "withdrawal.rejected":
      return {
        event: "withdrawal.rejected",
        test: true,
        timestamp: ts,
        data: {
          withdrawalId: "wdr_test_" + crypto.randomBytes(8).toString("hex"),
          amount: 5000,
          currency: "INR",
          status: "rejected",
          merchantId,
          rejectionReason: "Bank account verification pending",
          description: "Test event from RasoKart webhook tester",
        },
      };

    case "settlement.processed":
      return {
        event: "settlement.processed",
        test: true,
        timestamp: ts,
        data: {
          settlementId: "stl_test_" + crypto.randomBytes(8).toString("hex"),
          amount: 25000,
          currency: "INR",
          status: "processed",
          merchantId,
          periodFrom: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          periodTo: new Date().toISOString().slice(0, 10),
          transactionCount: 42,
          description: "Test event from RasoKart webhook tester",
        },
      };
  }
}

// POST /api/webhooks/test — send a test event to the merchant's webhook URL
router.post("/test", async (req, res) => {
  const user = (req as any).user;
  const merchantId = user.role === "merchant" ? user.merchantId! : undefined;
  if (!merchantId) {
    res.status(403).json({ error: "Merchants only" });
    return;
  }

  const rawEventType = (req.body?.eventType as string | undefined) ?? "payment.success";
  if (!SUPPORTED_TEST_EVENTS.includes(rawEventType as SupportedTestEvent)) {
    res.status(400).json({ error: `Unsupported event type. Must be one of: ${SUPPORTED_TEST_EVENTS.join(", ")}` });
    return;
  }
  const eventType = rawEventType as SupportedTestEvent;

  const [webhook] = await db
    .select()
    .from(webhooksTable)
    .where(eq(webhooksTable.merchantId, merchantId))
    .limit(1);

  if (!webhook || !webhook.url) {
    res.status(400).json({ error: "No webhook URL configured. Save a webhook URL first." });
    return;
  }

  const targetUrl = webhook.url;

  // SSRF guard — reject private/internal/metadata URLs before making any outbound request.
  try {
    await assertSafeWebhookUrl(targetUrl);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Invalid webhook URL" });
    return;
  }

  const payload = buildTestPayload(eventType, merchantId);
  const body = JSON.stringify(payload);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "RasoKart-Webhooks/1.0",
    "X-RasoKart-Event": eventType,
    "X-RasoKart-Delivery": crypto.randomUUID(),
  };

  const signed = !!(webhook.secret);
  let signatureHeader: string | undefined;
  if (webhook.secret) {
    signatureHeader = "sha256=" + crypto.createHmac("sha256", webhook.secret).update(body).digest("hex");
    headers["X-Signature"] = signatureHeader;
  }

  const start = Date.now();
  let httpStatus: number | null = null;
  let responseBody: string | null = null;
  let delivered = false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(targetUrl, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    httpStatus = response.status;
    delivered = response.status >= 200 && response.status < 300;

    const raw = await response.text();
    // Truncate aggressively — enough to show a status message, not enough to exfiltrate data.
    responseBody = raw.length > 500 ? raw.slice(0, 500) + "…" : raw || null;
  } catch (err: any) {
    delivered = false;
    responseBody = err?.name === "AbortError" ? "Request timed out after 10s" : String(err?.message ?? err);
  }

  const durationMs = Date.now() - start;

  // Insert a log row so test deliveries appear in Recent Deliveries with an isTest flag.
  try {
    const deliveryStatus = delivered ? "success" : "failed";
    await db.insert(callbackLogsTable).values({
      merchantId,
      url: targetUrl,
      status: deliveryStatus,
      httpStatus,
      requestBody: body,
      responseBody,
      attempts: 1,
      lastAttemptAt: new Date(),
      signatureVerified: signed ? true : null,
      isTest: true,
    });
  } catch (err) {
    req.log.warn({ err, merchantId }, "Failed to insert test webhook delivery log");
  }

  res.json({ delivered, httpStatus, responseBody, durationMs, targetUrl, signed, requestBody: body, ...(signatureHeader ? { signatureHeader } : {}) });
});

// POST /api/webhooks/backfill (admin only)
// Finds webhook records with an empty events array and populates them with the
// full set of supported event types. Logs the repair action to the audit trail.
router.post("/backfill", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const allWebhooks = await db
    .select({ id: webhooksTable.id, events: webhooksTable.events })
    .from(webhooksTable);

  const targets = allWebhooks.filter((w) => !w.events || w.events.length === 0);

  let rowsUpdated = 0;
  for (const w of targets) {
    await db
      .update(webhooksTable)
      .set({ events: [...SUPPORTED_TEST_EVENTS] })
      .where(eq(webhooksTable.id, w.id));
    rowsUpdated++;
  }

  await db.insert(auditLogsTable).values({
    adminId: user.id,
    adminEmail: user.email,
    action: "webhook_event_type_backfill",
    targetType: "webhook",
    targetId: null,
    details: JSON.stringify({ rowsUpdated }),
    ipAddress: req.ip ?? null,
  });

  req.log.info({ rowsUpdated }, "webhook_event_type_backfill_complete");
  res.json({ rowsUpdated });
});

// GET /api/webhooks
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const merchantId = user.role === "merchant" ? user.merchantId! : undefined;
  if (!merchantId) {
    res.status(403).json({ error: "Merchants only" });
    return;
  }
  const [webhook] = await db.select().from(webhooksTable).where(eq(webhooksTable.merchantId, merchantId)).limit(1);
  if (!webhook) {
    res.json({ id: 0, merchantId, url: "", isActive: false, events: [], secret: null, createdAt: new Date().toISOString() });
    return;
  }
  res.json(webhook);
});

// PUT /api/webhooks
router.put("/", async (req, res) => {
  const user = (req as any).user;
  const merchantId = user.role === "merchant" ? user.merchantId! : undefined;
  if (!merchantId) {
    res.status(403).json({ error: "Merchants only" });
    return;
  }
  const { url, isActive, events, secret, maxRetries, failureAlertEnabled, failureAlertThreshold } = req.body;
  if (!url || !Array.isArray(events)) {
    res.status(400).json({ error: "url and events required" });
    return;
  }

  const maxRetriesNum = maxRetries != null ? parseInt(String(maxRetries), 10) : 3;
  if (!isFinite(maxRetriesNum) || maxRetriesNum < 0 || maxRetriesNum > 5) {
    res.status(400).json({ error: "maxRetries must be an integer between 0 and 5" });
    return;
  }

  const alertEnabled = failureAlertEnabled != null ? Boolean(failureAlertEnabled) : true;
  const alertThresholdNum = failureAlertThreshold != null ? parseInt(String(failureAlertThreshold), 10) : 3;
  if (!isFinite(alertThresholdNum) || alertThresholdNum < 1 || alertThresholdNum > 10) {
    res.status(400).json({ error: "failureAlertThreshold must be an integer between 1 and 10" });
    return;
  }

  // Upsert
  const existing = await db.select().from(webhooksTable).where(eq(webhooksTable.merchantId, merchantId)).limit(1);
  let webhook;
  if (existing.length > 0) {
    [webhook] = await db
      .update(webhooksTable)
      .set({ url, isActive: isActive ?? true, events, secret: secret ?? null, maxRetries: maxRetriesNum, failureAlertEnabled: alertEnabled, failureAlertThreshold: alertThresholdNum })
      .where(eq(webhooksTable.merchantId, merchantId))
      .returning();
  } else {
    [webhook] = await db
      .insert(webhooksTable)
      .values({ merchantId, url, isActive: isActive ?? true, events, secret: secret ?? null, maxRetries: maxRetriesNum, failureAlertEnabled: alertEnabled, failureAlertThreshold: alertThresholdNum })
      .returning();
  }
  res.json(webhook);
});

export default router;
