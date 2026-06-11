import { db, callbackLogsTable, callbackLogAttemptsTable, usersTable, notificationsTable, webhooksTable, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS } from "@workspace/db";
import { eq, and, lte, sql, inArray, desc, ne } from "drizzle-orm";
import { logger } from "../lib/logger";
import { createNotification, createBulkNotifications } from "./notifications";
import { notifyAdminsOfWebhookFailureEmail } from "./adminNotifyEmail";
import { sendWebhookFailureAlertEmail } from "./webhookFailureAlertEmail";

const WEBHOOK_FAILURE_WINDOW_HOURS = 1;

async function notifyWebhookFailure(merchantId: number, url: string, attempts: number, qrCodeId: number | null): Promise<void> {
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.merchantId, merchantId))
    .limit(1);

  if (!user) return;

  // Deduplication: at most one alert per merchant per configurable window.
  // The hour bucket (UTC "YYYY-MM-DDTHH") encodes the window boundary so the
  // same key cannot match across hours.
  const now = new Date();
  const windowHour = Math.floor(now.getUTCHours() / WEBHOOK_FAILURE_WINDOW_HOURS) * WEBHOOK_FAILURE_WINDOW_HOURS;
  const hourBucket = `${now.toISOString().slice(0, 11)}${String(windowHour).padStart(2, "0")}`;
  const dedupeKey = `webhook_failure_${merchantId}_${hourBucket}`;

  const [existing] = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(and(
      eq(notificationsTable.userId, user.id),
      eq(notificationsTable.type, "webhook_failure"),
      sql`${notificationsTable.metadata}->>'dedupeKey' = ${dedupeKey}`,
    ))
    .limit(1);

  if (existing) {
    logger.info({ merchantId, dedupeKey }, "Webhook failure notification suppressed (duplicate within window)");
    return;
  }

  const qrLabel = qrCodeId != null ? ` (QR Code #${qrCodeId})` : "";
  await createNotification({
    userId: user.id,
    type: "webhook_failure",
    title: "Webhook Delivery Failed",
    body: `Callback to ${url} failed after ${attempts} attempt${attempts !== 1 ? "s" : ""}${qrLabel}. Please check your endpoint and ensure it returns a 2xx response.`,
    metadata: { qrCodeId, url, attempts, dedupeKey },
  });
}

async function notifyAdminsOfWebhookFailure(merchantId: number, url: string, attempts: number, qrCodeId: number | null): Promise<void> {
  // Deduplication: at most one admin alert per merchant per hour window.
  const now = new Date();
  const windowHour = Math.floor(now.getUTCHours() / WEBHOOK_FAILURE_WINDOW_HOURS) * WEBHOOK_FAILURE_WINDOW_HOURS;
  const hourBucket = `${now.toISOString().slice(0, 11)}${String(windowHour).padStart(2, "0")}`;
  const dedupeKey = `admin_webhook_failure_${merchantId}_${hourBucket}`;

  const admins = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)));

  if (admins.length === 0) return;

  // Check dedup against any one admin (they all share the same dedupeKey pattern)
  const [existing] = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(and(
      eq(notificationsTable.userId, admins[0]!.id),
      eq(notificationsTable.type, "webhook_failure"),
      sql`${notificationsTable.metadata}->>'dedupeKey' = ${dedupeKey}`,
    ))
    .limit(1);

  if (existing) {
    logger.info({ merchantId, dedupeKey }, "Admin webhook failure notification suppressed (duplicate within window)");
    return;
  }

  const qrLabel = qrCodeId != null ? ` (QR Code #${qrCodeId})` : "";
  await createBulkNotifications(
    admins.map(admin => ({
      userId: admin.id,
      type: "webhook_failure" as const,
      title: "Merchant Webhook Permanently Failed",
      body: `Merchant #${merchantId} webhook to ${url} permanently failed after ${attempts} attempt${attempts !== 1 ? "s" : ""}${qrLabel}. Consider reaching out to the merchant.`,
      metadata: { merchantId, qrCodeId, url, attempts, dedupeKey },
    }))
  );
}

const DEFAULT_MAX_ATTEMPTS = parseInt(SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_MAX_ATTEMPTS]);
const DEFAULT_DELAYS_SECONDS = [
  parseInt(SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_1]),
  parseInt(SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_2]),
  parseInt(SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_3]),
];

const FAILURE_ALERT_WINDOW_HOURS = 6;

/**
 * After a delivery reaches terminal "failed" state, check whether the last N
 * non-test callback logs for this merchant are all failures.  If so, and the
 * merchant has failure alerts enabled, send a single deduplicated email.
 */
export async function checkAndSendWebhookFailureAlert(
  merchantId: number,
  url: string,
): Promise<void> {
  try {
    const [whConfig] = await db
      .select({ failureAlertEnabled: webhooksTable.failureAlertEnabled, failureAlertThreshold: webhooksTable.failureAlertThreshold })
      .from(webhooksTable)
      .where(eq(webhooksTable.merchantId, merchantId))
      .limit(1);

    if (!whConfig?.failureAlertEnabled) return;

    const threshold = whConfig.failureAlertThreshold;
    if (threshold <= 0) return;

    // Fetch the most recent `threshold` non-test terminal logs (success or failed, not pending_retry)
    const recentLogs = await db
      .select({ status: callbackLogsTable.status })
      .from(callbackLogsTable)
      .where(
        and(
          eq(callbackLogsTable.merchantId, merchantId),
          eq(callbackLogsTable.isTest, false),
          ne(callbackLogsTable.status, "pending_retry"),
        ),
      )
      .orderBy(desc(callbackLogsTable.createdAt))
      .limit(threshold);

    if (recentLogs.length < threshold) return;

    const allFailed = recentLogs.every(l => l.status === "failed");
    if (!allFailed) return;

    // Deduplication: at most one alert per merchant per 6-hour window
    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.merchantId, merchantId))
      .limit(1);

    if (!user) return;

    const now = new Date();
    const windowSlot = Math.floor(now.getUTCHours() / FAILURE_ALERT_WINDOW_HOURS) * FAILURE_ALERT_WINDOW_HOURS;
    const hourBucket = `${now.toISOString().slice(0, 11)}${String(windowSlot).padStart(2, "0")}`;
    const dedupeKey = `webhook_failure_alert_${merchantId}_${hourBucket}`;

    const [existing] = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, user.id),
          eq(notificationsTable.type, "webhook_failure"),
          sql`${notificationsTable.metadata}->>'dedupeKey' = ${dedupeKey}`,
        ),
      )
      .limit(1);

    if (existing) {
      logger.info({ merchantId, dedupeKey }, "Webhook failure alert email suppressed (duplicate within window)");
      return;
    }

    // Record the dedup notification so future calls within the window are suppressed
    await createNotification({
      userId: user.id,
      type: "webhook_failure",
      title: "Webhook Failure Alert Sent",
      body: `Email alert sent: ${threshold} consecutive delivery failures on ${url}.`,
      metadata: { url, consecutiveFailures: threshold, dedupeKey },
    });

    await sendWebhookFailureAlertEmail({ merchantId, webhookUrl: url, consecutiveFailures: threshold, threshold });
  } catch (err) {
    logger.error({ err, merchantId }, "checkAndSendWebhookFailureAlert failed");
  }
}

export interface WebhookRetryConfig {
  maxAttempts: number;
  delaysMs: number[]; // per-retry delays in milliseconds (index 0 = after 1st failure)
}

export async function loadWebhookRetryConfig(): Promise<WebhookRetryConfig> {
  const keys = [
    SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_MAX_ATTEMPTS,
    SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_1,
    SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_2,
    SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_3,
  ];

  const rows = await db
    .select()
    .from(systemConfigTable)
    .where(inArray(systemConfigTable.key, keys));

  const map = new Map(rows.map((r) => [r.key, r.value]));

  const maxAttempts = parseInt(map.get(SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_MAX_ATTEMPTS) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_MAX_ATTEMPTS]);
  const delay1s = parseInt(map.get(SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_1) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_1]);
  const delay2s = parseInt(map.get(SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_2) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_2]);
  const delay3s = parseInt(map.get(SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_3) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_3]);

  return {
    maxAttempts,
    delaysMs: [delay1s * 1000, delay2s * 1000, delay3s * 1000],
  };
}

function getNextRetryDelayFromConfig(attempts: number, config: WebhookRetryConfig): number {
  // attempts = number of attempts already made (including the just-failed one)
  // index 0 = delay after attempt 1, index 1 = delay after attempt 2, etc.
  const idx = attempts - 1;
  if (idx >= 0 && idx < config.delaysMs.length) {
    return config.delaysMs[idx]!;
  }
  // Fall back to the last configured delay for any extra retries
  return config.delaysMs[config.delaysMs.length - 1] ?? DEFAULT_DELAYS_SECONDS[DEFAULT_DELAYS_SECONDS.length - 1]! * 1000;
}

export async function scheduleCallbackRetry(logId: number, attempts: number, overrideMaxRetries?: number): Promise<void> {
  // overrideMaxRetries = per-webhook number of retries (not total attempts); total cap = maxRetries + 1.
  // When no per-webhook override, fall back to the DB-configured global maxAttempts.
  let maxTotalAttempts: number;
  let config: WebhookRetryConfig;

  if (overrideMaxRetries != null) {
    maxTotalAttempts = overrideMaxRetries + 1;
    config = await loadWebhookRetryConfig();
  } else {
    config = await loadWebhookRetryConfig();
    maxTotalAttempts = config.maxAttempts;
  }

  if (attempts >= maxTotalAttempts) {
    await db
      .update(callbackLogsTable)
      .set({ status: "failed", nextRetryAt: null })
      .where(eq(callbackLogsTable.id, logId));
    return;
  }

  const delayMs = getNextRetryDelayFromConfig(attempts, config);
  const nextRetryAt = new Date(Date.now() + delayMs);

  await db
    .update(callbackLogsTable)
    .set({ status: "pending_retry", nextRetryAt })
    .where(eq(callbackLogsTable.id, logId));
}

export async function fireCallback(
  url: string,
  body: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; httpStatus: number | null; responseBody: string | null }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: signal ?? AbortSignal.timeout(10_000),
    });
    const responseBody = await res.text().catch(() => null);
    return { ok: res.ok, httpStatus: res.status, responseBody };
  } catch (err) {
    return {
      ok: false,
      httpStatus: null,
      responseBody: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function processPendingRetries(): Promise<void> {
  const now = new Date();

  const pending = await db
    .select()
    .from(callbackLogsTable)
    .where(
      and(
        eq(callbackLogsTable.status, "pending_retry"),
        lte(callbackLogsTable.nextRetryAt, now),
      ),
    )
    .limit(50);

  if (pending.length === 0) return;

  logger.info({ count: pending.length }, "Processing pending callback retries");

  // Load the global retry config (DB-configured) once for the whole batch.
  const globalConfig = await loadWebhookRetryConfig();

  // Load per-merchant webhook maxRetries for all unique merchants in this batch.
  const merchantIds = [...new Set(pending.map(l => l.merchantId))];
  const webhookRows = await db
    .select({ merchantId: webhooksTable.merchantId, maxRetries: webhooksTable.maxRetries })
    .from(webhooksTable)
    .where(inArray(webhooksTable.merchantId, merchantIds));
  const webhookMaxRetriesMap = new Map(webhookRows.map(r => [r.merchantId, r.maxRetries]));

  for (const log of pending) {
    if (!log.requestBody) {
      await db
        .update(callbackLogsTable)
        .set({ status: "failed", nextRetryAt: null, lastAttemptAt: now })
        .where(eq(callbackLogsTable.id, log.id));
      continue;
    }

    const newAttempts = log.attempts + 1;
    const firedAt = new Date();
    const { ok, httpStatus, responseBody } = await fireCallback(log.url, log.requestBody);

    db.insert(callbackLogAttemptsTable).values({
      callbackLogId: log.id,
      attemptNumber: newAttempts,
      firedAt,
      httpStatus: httpStatus ?? null,
      responseBody: responseBody ?? null,
    }).catch((err: unknown) => {
      logger.warn({ err, logId: log.id, attemptNumber: newAttempts }, "Failed to insert callback_log_attempt record");
    });

    if (ok) {
      await db
        .update(callbackLogsTable)
        .set({
          status: "success",
          httpStatus,
          responseBody,
          attempts: newAttempts,
          nextRetryAt: null,
          lastAttemptAt: now,
        })
        .where(eq(callbackLogsTable.id, log.id));

      logger.info({ logId: log.id, attempts: newAttempts }, "Callback retry succeeded");
    } else {
      logger.warn(
        { logId: log.id, attempts: newAttempts, httpStatus, url: log.url },
        "Callback retry failed",
      );

      // Live deliveries respect the per-webhook maxRetries (number of retries allowed).
      // Test deliveries and logs without a per-webhook config fall back to the DB-configured global maxAttempts.
      let reachedCap: boolean;
      if (log.isTest) {
        reachedCap = newAttempts >= globalConfig.maxAttempts;
      } else {
        const webhookMaxRetries = webhookMaxRetriesMap.get(log.merchantId);
        if (webhookMaxRetries != null) {
          // webhookMaxRetries = number of retries; total cap = maxRetries + 1
          reachedCap = newAttempts > webhookMaxRetries;
        } else {
          // No per-webhook config — use DB-configured global maxAttempts
          reachedCap = newAttempts >= globalConfig.maxAttempts;
        }
      }

      if (reachedCap) {
        await db
          .update(callbackLogsTable)
          .set({
            status: "failed",
            httpStatus,
            responseBody,
            attempts: newAttempts,
            nextRetryAt: null,
            lastAttemptAt: now,
          })
          .where(eq(callbackLogsTable.id, log.id));

        if (!log.isTest) {
          await notifyWebhookFailure(log.merchantId, log.url, newAttempts, log.qrCodeId ?? null).catch((err) => {
            logger.error({ err, logId: log.id }, "Failed to send webhook failure notification");
          });
          await notifyAdminsOfWebhookFailure(log.merchantId, log.url, newAttempts, log.qrCodeId ?? null).catch((err) => {
            logger.error({ err, logId: log.id }, "Failed to send admin webhook failure notification");
          });
          await notifyAdminsOfWebhookFailureEmail({ merchantId: log.merchantId, url: log.url, attempts: newAttempts, qrCodeId: log.qrCodeId ?? null }).catch((err) => {
            logger.error({ err, logId: log.id }, "Failed to send admin webhook failure email");
          });
          await checkAndSendWebhookFailureAlert(log.merchantId, log.url).catch((err) => {
            logger.error({ err, logId: log.id }, "Failed to check/send webhook failure alert email");
          });
        }
      } else {
        const delayMs = getNextRetryDelayFromConfig(newAttempts, globalConfig);
        const nextRetryAt = new Date(Date.now() + delayMs);

        await db
          .update(callbackLogsTable)
          .set({
            httpStatus,
            responseBody,
            attempts: newAttempts,
            nextRetryAt,
            lastAttemptAt: now,
          })
          .where(eq(callbackLogsTable.id, log.id));
      }
    }
  }
}
