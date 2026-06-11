import { createHmac, timingSafeEqual } from "crypto";
import { Request, Response, NextFunction } from "express";
import { db, apiKeysTable, merchantsTable, callbackLogsTable, callbackNoncesTable } from "@workspace/db";
import { eq, lt, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * How far in the past (or future) an X-Timestamp may be, in seconds.
 * Override with the CALLBACK_TIMESTAMP_WINDOW_SECONDS environment variable.
 */
const TIMESTAMP_WINDOW_SECONDS = (() => {
  const raw = process.env["CALLBACK_TIMESTAMP_WINDOW_SECONDS"];
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    logger.warn({ raw }, "CALLBACK_TIMESTAMP_WINDOW_SECONDS is not a valid positive integer; using default 300");
  }
  return 5 * 60; // 5 minutes
})();

/**
 * Middleware: authenticate an inbound callback request via the X-Api-Key header.
 * On success, sets `req.callbackMerchantId` and `req.callbackApiKeyId` for downstream use.
 */
export async function requireApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const apiKeyHeader = (req.headers["x-api-key"] as string | undefined)?.trim();
  if (!apiKeyHeader) {
    res.status(401).json({ error: "X-Api-Key header is required" });
    return;
  }

  const [keyRow] = await db
    .select()
    .from(apiKeysTable)
    .where(eq(apiKeysTable.apiKey, apiKeyHeader))
    .limit(1);

  if (!keyRow || !keyRow.isActive) {
    res.status(401).json({ error: "Invalid or inactive API key" });
    return;
  }

  (req as any).callbackMerchantId = keyRow.merchantId;
  (req as any).callbackApiKeyId = keyRow.id;
  next();
}

/**
 * Compute and compare HMAC-SHA256 signatures in constant time.
 * Accepts both `sha256=<hex>` and bare `<hex>` formats in the header.
 */
function verifyHmacSignature(secret: string, rawBody: Buffer, signatureHeader: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice(7)
    : signatureHeader;

  if (provided.length !== expected.length) return false;

  try {
    return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/**
 * Check whether a nonce has already been seen (replay detection).
 *
 * Queries the `callback_nonces` table.  If the DB is unavailable this logs a
 * warning and returns false (i.e. does NOT block the request) so that a
 * transient outage doesn't take down the callback endpoint — the timestamp
 * window check is still enforced regardless.
 *
 * Returns true  → nonce was already used (block the request).
 * Returns false → nonce is new (or DB unavailable — allow through with warning).
 */
async function isNonceSeen(nonceKey: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ key: callbackNoncesTable.key })
      .from(callbackNoncesTable)
      .where(
        sql`${callbackNoncesTable.key} = ${nonceKey}
            AND ${callbackNoncesTable.expiresAt} > now()`,
      )
      .limit(1);
    return row !== undefined;
  } catch (err) {
    logger.warn({ err, nonceKey }, "Nonce store unavailable; skipping nonce check (timestamp window still enforced)");
    return false;
  }
}

/**
 * Record a nonce in the persistent store and lazily prune any expired rows.
 *
 * The nonce is only written AFTER HMAC verification succeeds so unauthenticated
 * callers cannot poison the store.
 *
 * Returns true  → nonce was freshly inserted or an expired row was atomically
 *                 replaced (request is unique, allow it).
 * Returns false → a non-expired row already exists (active duplicate — treat as
 *                 replay and reject), OR the DB write failed entirely (request
 *                 is rejected as a precaution; the caller should not allow
 *                 through when persistence cannot be confirmed).
 *
 * Race safety: the unique constraint on `key` is the real atomic gate.  Even
 * if two concurrent requests both pass `isNonceSeen` before either write
 * completes, only one INSERT can win — the loser gets rowCount 0.
 *
 * Expired-nonce reuse: uses ON CONFLICT DO UPDATE ... WHERE expires_at <=
 * now() so that a legitimately reused nonce (after expiry) atomically replaces
 * the stale row (rowCount 1 → allow).  A still-active conflicting row does NOT
 * match the WHERE, so no UPDATE occurs and rowCount stays 0 → reject.
 */
async function recordNonce(nonceKey: string, expiresAt: Date): Promise<boolean> {
  try {
    const result = await db
      .insert(callbackNoncesTable)
      .values({ key: nonceKey, expiresAt })
      .onConflictDoUpdate({
        target: callbackNoncesTable.key,
        set: { expiresAt },
        where: lt(callbackNoncesTable.expiresAt, new Date()),
      });

    const succeeded = (result.rowCount ?? 0) === 1;

    // Lazy prune of OTHER expired nonces (fire-and-forget, independent of
    // whether this insert succeeded so pruning is never blocked by conflicts).
    db.delete(callbackNoncesTable)
      .where(lt(callbackNoncesTable.expiresAt, new Date()))
      .catch((err: unknown) => {
        logger.warn({ err }, "Failed to prune expired nonces");
      });

    return succeeded;
  } catch (err) {
    logger.warn({ err, nonceKey }, "Failed to persist nonce; request rejected as precaution");
    return false;
  }
}

/**
 * Middleware: enforce HMAC-SHA256 callback signature verification plus replay-attack
 * prevention via timestamp and nonce checks.
 *
 * Must run AFTER `requireApiKey` (reads `req.callbackMerchantId`).
 *
 * When the merchant has a `callbackSecret` configured:
 *
 *   1. **Timestamp**: `X-Timestamp` (Unix epoch seconds) must be present and within
 *      ±TIMESTAMP_WINDOW_SECONDS of the server clock (configurable via env var,
 *      default 300 s). Stale or missing timestamps are rejected with 401.
 *
 *   2. **Nonce** (optional): if `X-Nonce` is present it must not have been seen for
 *      *this merchant* within the current window. Nonces are scoped per-merchant to
 *      prevent cross-merchant collisions. **The nonce is only recorded after the
 *      HMAC check passes**, so unauthenticated callers cannot poison the store.
 *      Nonces are persisted in Postgres so replay protection survives restarts and
 *      works correctly across multiple server instances.
 *
 *   3. **HMAC signature**: `X-Signature: sha256=<hex>` must match
 *      HMAC-SHA256(secret, rawBody).
 *
 * If no secret is configured the request passes through (opt-in enforcement).
 * Sets `req.signatureVerified` (true | null) for downstream logging.
 */
export async function verifyCallbackSignature(req: Request, res: Response, next: NextFunction): Promise<void> {
  const merchantId: number | undefined = (req as any).callbackMerchantId;
  if (merchantId === undefined) {
    res.status(500).json({ error: "verifyCallbackSignature must run after requireApiKey" });
    return;
  }

  const [merchant] = await db
    .select({ callbackSecret: merchantsTable.callbackSecret, callbackTimestampWindowSeconds: merchantsTable.callbackTimestampWindowSeconds })
    .from(merchantsTable)
    .where(eq(merchantsTable.id, merchantId))
    .limit(1);

  if (!merchant?.callbackSecret) {
    (req as any).signatureVerified = null;
    next();
    return;
  }

  // Use the per-merchant window when set, otherwise fall back to the global default.
  const windowSeconds = merchant.callbackTimestampWindowSeconds ?? TIMESTAMP_WINDOW_SECONDS;

  // ── 1. Timestamp check ──────────────────────────────────────────────────────
  const timestampHeader = (req.headers["x-timestamp"] as string | undefined)?.trim();
  if (!timestampHeader) {
    logAndReject(res, merchantId, req.originalUrl, "X-Timestamp header is required");
    return;
  }

  const timestampSec = Number(timestampHeader);
  if (!Number.isFinite(timestampSec)) {
    logAndReject(res, merchantId, req.originalUrl, "X-Timestamp must be a Unix epoch integer");
    return;
  }

  const nowSec = Date.now() / 1000;
  const ageSec = nowSec - timestampSec;
  if (Math.abs(ageSec) > windowSeconds) {
    logAndReject(
      res,
      merchantId,
      req.originalUrl,
      `X-Timestamp is outside the allowed window (±${windowSeconds}s)`,
    );
    return;
  }

  // ── 2. Pre-flight nonce uniqueness check (read-only — do NOT write yet) ─────
  const nonce = (req.headers["x-nonce"] as string | undefined)?.trim();
  const nonceKey = nonce ? `${merchantId}:${nonce}` : null;

  if (nonceKey) {
    const seen = await isNonceSeen(nonceKey);
    if (seen) {
      logAndReject(res, merchantId, req.originalUrl, "X-Nonce has already been used (replay detected)");
      return;
    }
  }

  // ── 3. HMAC signature check ──────────────────────────────────────────────────
  const signatureHeader = (req.headers["x-signature"] as string | undefined)?.trim();

  if (!signatureHeader) {
    logAndReject(res, merchantId, req.originalUrl, "X-Signature header is required for this merchant");
    return;
  }

  const rawBody = (req as any).rawBody as Buffer | undefined;
  if (!rawBody) {
    res.status(500).json({ error: "Unable to verify signature: raw body unavailable" });
    return;
  }

  if (!verifyHmacSignature(merchant.callbackSecret, rawBody, signatureHeader)) {
    logAndReject(res, merchantId, req.originalUrl, "Invalid X-Signature");
    return;
  }

  // ── 4. Record nonce AFTER successful HMAC verification ──────────────────────
  // Only authenticated requests reach this point, so the store cannot be
  // poisoned by unauthenticated callers.
  //
  // recordNonce returns:
  //   true  → insert succeeded (fresh nonce or expired-row replacement) — allow.
  //   false → active duplicate exists OR DB write failed — reject as replay.
  if (nonceKey) {
    // Expire slightly after the window ends to cover boundary-edge timestamps.
    const expiresAt = new Date((timestampSec + windowSeconds + 60) * 1000);
    const recorded = await recordNonce(nonceKey, expiresAt);
    if (!recorded) {
      logAndReject(res, merchantId, req.originalUrl, "X-Nonce has already been used (replay detected)");
      return;
    }
  }

  (req as any).signatureVerified = true;
  next();
}

/**
 * Fire-and-forget callback log insert then send 401.
 */
function logAndReject(
  res: Response,
  merchantId: number,
  url: string,
  message: string,
): void {
  // eventType is null here because these are inbound payment-provider callback
  // requests (body contains orderId/merchantReference, not an event field).
  // Signature/timestamp/nonce rejections happen before the business payload is
  // processed, so there is no event type to extract.
  db.insert(callbackLogsTable)
    .values({
      merchantId,
      url,
      status: "failed",
      attempts: 1,
      lastAttemptAt: new Date(),
      signatureVerified: false,
      responseBody: message,
      eventType: null,
    })
    .catch((err: unknown) => {
      logger.warn({ err }, "Failed to write callback rejection log");
    });

  res.status(401).json({ error: message });
}
