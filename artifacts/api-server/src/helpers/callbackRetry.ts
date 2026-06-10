import { db, callbackLogsTable } from "@workspace/db";
import { eq, and, lte, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const MAX_ATTEMPTS = 4; // 1 initial + 3 retries

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

export async function scheduleCallbackRetry(logId: number, attempts: number): Promise<void> {
  if (attempts >= MAX_ATTEMPTS) {
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

      if (newAttempts >= MAX_ATTEMPTS) {
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
