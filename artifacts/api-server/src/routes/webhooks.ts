import { Router } from "express";
import { db, webhooksTable, callbackLogsTable, callbackLogAttemptsTable, auditLogsTable, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS } from "@workspace/db";
import { and, count, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { fireCallback, loadWebhookRetryConfig } from "../helpers/callbackRetry";
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

// GET /api/webhooks/retry-defaults — system default retry delays (merchant-accessible)
router.get("/retry-defaults", async (req, res, next) => {
  try {
    const keys = [
      SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_1,
      SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_2,
      SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_3,
    ];

    const rows = await db
      .select()
      .from(systemConfigTable)
      .where(inArray(systemConfigTable.key, keys));

    const map = new Map(rows.map((r) => [r.key, r.value]));

    res.json({
      delay1: parseInt(map.get(SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_1) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_1]),
      delay2: parseInt(map.get(SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_2) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_2]),
      delay3: parseInt(map.get(SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_3) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_3]),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/webhooks/platform-defaults — platform-wide retry defaults visible to merchants
router.get("/platform-defaults", async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(systemConfigTable)
      .where(inArray(systemConfigTable.key, [SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_MAX_ATTEMPTS]));

    const map = new Map(rows.map((r) => [r.key, r.value]));
    const maxAttempts = parseInt(
      map.get(SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_MAX_ATTEMPTS) ??
        SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_MAX_ATTEMPTS]
    );

    res.json({ platformDefaultRetries: Math.max(0, maxAttempts - 1) });
  } catch (err) {
    next(err);
  }
});

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
  const statusRaw = req.query['status'] as string | undefined;
  const statusFilter = (statusRaw === "success" || statusRaw === "failed" || statusRaw === "pending_retry")
    ? statusRaw
    : undefined;

  const fromDate = fromRaw ? new Date(fromRaw) : null;
  const toDate = toRaw ? new Date(toRaw) : null;

  const conditions = [
    eq(callbackLogsTable.merchantId, merchantId),
    ...(fromDate && !isNaN(fromDate.getTime()) ? [gte(callbackLogsTable.createdAt, fromDate)] : []),
    ...(toDate && !isNaN(toDate.getTime()) ? [lte(callbackLogsTable.createdAt, toDate)] : []),
    ...(eventTypeFilter ? [eq(callbackLogsTable.eventType, eventTypeFilter)] : []),
    ...(statusFilter ? [eq(callbackLogsTable.status, statusFilter)] : []),
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

  // Overall totals per event type (all-time)
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

  // Daily trend for last 7 days per event type
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const trendRows = await db
    .select({
      eventType: callbackLogsTable.eventType,
      date: sql<string>`DATE(${callbackLogsTable.createdAt} AT TIME ZONE 'UTC')`,
      success: sql<number>`COUNT(*) FILTER (WHERE ${callbackLogsTable.status} = 'success')`,
      failed: sql<number>`COUNT(*) FILTER (WHERE ${callbackLogsTable.status} != 'success')`,
    })
    .from(callbackLogsTable)
    .where(
      sql`${callbackLogsTable.merchantId} = ${merchantId}
        AND ${callbackLogsTable.eventType} IS NOT NULL
        AND ${callbackLogsTable.createdAt} >= ${sevenDaysAgo}`
    )
    .groupBy(callbackLogsTable.eventType, sql`DATE(${callbackLogsTable.createdAt} AT TIME ZONE 'UTC')`);

  // Build the 7-day date scaffolding
  const last7Days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    last7Days.push(d.toISOString().slice(0, 10));
  }

  // Group trend rows by event type
  const trendByEventType: Record<string, Record<string, { success: number; failed: number }>> = {};
  for (const tr of trendRows) {
    const et = tr.eventType!;
    if (!trendByEventType[et]) trendByEventType[et] = {};
    trendByEventType[et][tr.date] = { success: Number(tr.success), failed: Number(tr.failed) };
  }

  res.json({
    data: rows.map(r => {
      const et = r.eventType!;
      const dayMap = trendByEventType[et] ?? {};
      const trend = last7Days.map(date => ({
        date,
        success: dayMap[date]?.success ?? 0,
        failed: dayMap[date]?.failed ?? 0,
      }));
      return {
        eventType: et,
        total: Number(r.total),
        success: Number(r.success),
        failed: Number(r.failed),
        trend,
      };
    }),
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

  const [[updated]] = await Promise.all([
    db
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
      .returning(),
    db.insert(callbackLogAttemptsTable).values({
      callbackLogId: id,
      attemptNumber: newAttempts,
      firedAt: now,
      httpStatus: httpStatus ?? null,
      responseBody: responseBody ?? null,
    }),
  ]);

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

// POST /api/webhooks/simulate — send a signed test event to ANY URL the merchant provides.
// Unlike /test (which fires to the merchant's saved webhook URL), this lets merchants
// paste any endpoint URL to verify their handler before saving it.
router.post("/simulate", async (req, res) => {
  const user = (req as any).user;
  const merchantId = user.role === "merchant" ? user.merchantId! : undefined;
  if (!merchantId) {
    res.status(403).json({ error: "Merchants only" });
    return;
  }

  const { webhookUrl, eventType: rawEventType, amount: rawAmount, reference: rawReference } = req.body as {
    webhookUrl?: string;
    eventType?: string;
    amount?: string | number;
    reference?: string;
  };

  if (!webhookUrl || typeof webhookUrl !== "string") {
    res.status(400).json({ error: "webhookUrl is required" });
    return;
  }

  const eventType = (rawEventType ?? "payment.success") as SupportedTestEvent;
  if (!SUPPORTED_TEST_EVENTS.includes(eventType)) {
    res.status(400).json({ error: `Unsupported event type. Must be one of: ${SUPPORTED_TEST_EVENTS.join(", ")}` });
    return;
  }

  // SSRF guard
  try {
    await assertSafeWebhookUrl(webhookUrl);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Invalid webhook URL" });
    return;
  }

  // Build base payload then apply caller-supplied overrides for amount / reference
  const payload = buildTestPayload(eventType, merchantId) as Record<string, any>;
  if (payload.data) {
    if (rawAmount !== undefined && rawAmount !== "") {
      const parsed = parseFloat(String(rawAmount));
      if (!isNaN(parsed)) payload.data.amount = parsed;
    }
    if (rawReference !== undefined && rawReference !== "") {
      payload.data.reference = rawReference;
    }
  }

  const body = JSON.stringify(payload);

  // Sign with the merchant's webhook secret if one is configured
  const [webhook] = await db
    .select({ secret: webhooksTable.secret })
    .from(webhooksTable)
    .where(eq(webhooksTable.merchantId, merchantId))
    .limit(1);

  const signed = !!(webhook?.secret);
  let signatureHeader: string | undefined;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "RasoKart-Webhooks/1.0",
    "X-RasoKart-Event": eventType,
    "X-RasoKart-Delivery": crypto.randomUUID(),
  };
  if (webhook?.secret) {
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

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    httpStatus = response.status;
    delivered = response.status >= 200 && response.status < 300;

    const raw = await response.text();
    responseBody = raw.length > 500 ? raw.slice(0, 500) + "…" : raw || null;
  } catch (err: any) {
    delivered = false;
    responseBody = err?.name === "AbortError" ? "Request timed out after 10s" : String(err?.message ?? err);
  }

  const durationMs = Date.now() - start;

  req.log.info({ merchantId, eventType, webhookUrl, httpStatus, delivered }, "Webhook simulator fired");

  res.json({
    delivered,
    httpStatus,
    responseBody,
    durationMs,
    webhookUrl,
    signed,
    requestBody: body,
    ...(signatureHeader ? { signatureHeader } : {}),
  });
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
  const [globalConfig, webhook] = await Promise.all([
    loadWebhookRetryConfig(),
    db.select().from(webhooksTable).where(eq(webhooksTable.merchantId, merchantId)).limit(1).then(r => r[0]),
  ]);
  const globalMaxRetries = globalConfig.maxAttempts - 1;
  if (!webhook) {
    res.json({ id: 0, merchantId, url: "", isActive: false, events: [], secret: null, createdAt: new Date().toISOString(), maxRetries: 3, failureAlertEnabled: true, failureAlertThreshold: 3, globalMaxRetries });
    return;
  }
  res.json({ ...webhook, globalMaxRetries });
});

// PUT /api/webhooks
router.put("/", async (req, res) => {
  const user = (req as any).user;
  const merchantId = user.role === "merchant" ? user.merchantId! : undefined;
  if (!merchantId) {
    res.status(403).json({ error: "Merchants only" });
    return;
  }
  const { url, isActive, events, secret, maxRetries, retryDelay1, retryDelay2, retryDelay3, failureAlertEnabled, failureAlertThreshold } = req.body;
  if (!url || !Array.isArray(events)) {
    res.status(400).json({ error: "url and events required" });
    return;
  }

  const maxRetriesNum = maxRetries != null ? parseInt(String(maxRetries), 10) : 3;
  if (!isFinite(maxRetriesNum) || maxRetriesNum < 0 || maxRetriesNum > 10) {
    res.status(400).json({ error: "maxRetries must be an integer between 0 and 10" });
    return;
  }

  const globalConfig = await loadWebhookRetryConfig();
  const globalMaxRetries = globalConfig.maxAttempts - 1;
  if (maxRetriesNum > globalMaxRetries) {
    res.status(422).json({ error: `maxRetries cannot exceed the global cap of ${globalMaxRetries}` });
    return;
  }

  const VALID_DELAYS_SEC = [30, 60, 300, 900, 1800, 3600, 7200, 14400, 21600, 43200, 86400];

  function parseOptionalDelay(raw: unknown, field: string): number | null {
    if (raw == null) return null;
    const n = parseInt(String(raw), 10);
    if (!isFinite(n)) throw new Error(`${field} must be an integer`);
    if (!VALID_DELAYS_SEC.includes(n)) throw new Error(`${field} must be one of the allowed delay values`);
    return n;
  }

  let delay1: number | null, delay2: number | null, delay3: number | null;
  try {
    delay1 = parseOptionalDelay(retryDelay1, "retryDelay1");
    delay2 = parseOptionalDelay(retryDelay2, "retryDelay2");
    delay3 = parseOptionalDelay(retryDelay3, "retryDelay3");
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Invalid delay value" });
    return;
  }

  // Trim delay slots that exceed maxRetries. Storing overrides for slots that will never
  // fire is misleading: delay1 applies to retry #1, delay2 to #2, delay3 to #3+.
  if (maxRetriesNum < 1) delay1 = null;
  if (maxRetriesNum < 2) delay2 = null;
  if (maxRetriesNum < 3) delay3 = null;

  const alertEnabled = failureAlertEnabled != null ? Boolean(failureAlertEnabled) : true;
  const alertThresholdNum = failureAlertThreshold != null ? parseInt(String(failureAlertThreshold), 10) : 3;
  if (!isFinite(alertThresholdNum) || alertThresholdNum < 1 || alertThresholdNum > 10) {
    res.status(400).json({ error: "failureAlertThreshold must be an integer between 1 and 10" });
    return;
  }

  const fieldsToSet = {
    url,
    isActive: isActive ?? true,
    events,
    secret: secret ?? null,
    maxRetries: maxRetriesNum,
    retryDelay1: delay1,
    retryDelay2: delay2,
    retryDelay3: delay3,
    failureAlertEnabled: alertEnabled,
    failureAlertThreshold: alertThresholdNum,
  };

  // Upsert
  const existing = await db.select().from(webhooksTable).where(eq(webhooksTable.merchantId, merchantId)).limit(1);
  let webhook;
  if (existing.length > 0) {
    [webhook] = await db
      .update(webhooksTable)
      .set(fieldsToSet)
      .where(eq(webhooksTable.merchantId, merchantId))
      .returning();
  } else {
    [webhook] = await db
      .insert(webhooksTable)
      .values({ merchantId, ...fieldsToSet })
      .returning();
  }
  res.json({ ...webhook, globalMaxRetries });
});

export default router;
