import { db, callbackLogsTable, usersTable, notificationsTable, webhooksTable } from "@workspace/db";
import { eq, and, lte, sql, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { createNotification, createBulkNotifications } from "./notifications";
import { notifyAdminsOfWebhookFailureEmail } from "./adminNotifyEmail";

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

const MAX_ATTEMPTS = 4; // 1 initial + 3 retries (default when no per-webhook config)

function getNextRetryDelay(attempts: number): number {
  // attempts is the number of attempts already made (including the just-failed one)
  // Retry schedule: 30s, 5min, 30min
  switch (attempts) {
    case 1: return 30 * 1000;          // 30 seconds after 1st failure
    case 2: return 5 * 60 * 1000;      // 5 minutes after 2nd failure
    case 3: return 30 * 60 * 1000;     // 30 minutes after 3rd failure
    default: return 0;
  }
}

export async function scheduleCallbackRetry(logId: number, attempts: number, overrideMaxRetries?: number): Promise<void> {
  // overrideMaxRetries = number of retries (not total attempts), so total cap = maxRetries + 1.
  // Falls back to MAX_ATTEMPTS (total) when no per-webhook config is provided.
  const maxTotalAttempts = overrideMaxRetries != null ? overrideMaxRetries + 1 : MAX_ATTEMPTS;

  if (attempts >= maxTotalAttempts) {
    await db
      .update(callbackLogsTable)
      .set({ status: "failed", nextRetryAt: null })
      .where(eq(callbackLogsTable.id, logId));
    return;
  }

  const delayMs = getNextRetryDelay(attempts);
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
    const { ok, httpStatus, responseBody } = await fireCallback(log.url, log.requestBody);

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
      // Test deliveries and logs without a webhook config fall back to MAX_ATTEMPTS (total).
      let reachedCap: boolean;
      if (log.isTest) {
        reachedCap = newAttempts >= MAX_ATTEMPTS;
      } else {
        const webhookMaxRetries = webhookMaxRetriesMap.get(log.merchantId);
        if (webhookMaxRetries != null) {
          // webhookMaxRetries = number of retries; total cap = maxRetries + 1
          reachedCap = newAttempts > webhookMaxRetries;
        } else {
          // No webhook config found for this merchant — use default
          reachedCap = newAttempts >= MAX_ATTEMPTS;
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
        }
      } else {
        const delayMs = getNextRetryDelay(newAttempts);
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
