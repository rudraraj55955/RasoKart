/**
 * In-memory store for upload intents.
 *
 * When a presigned upload URL is issued, the server records the trusted
 * declared content type keyed by the resulting objectPath.  At confirmation
 * time (e.g. PATCH /merchants/:id/branding) the server retrieves this record
 * to validate that the actual file bytes match what was declared — without
 * trusting any client-supplied value at confirmation time.
 *
 * TTL matches the presigned URL lifetime (15 min) plus a small grace period.
 * Records are pruned lazily on every write to avoid a background timer.
 */

export interface UploadIntent {
  contentType: string;
  uploaderId: number;
  expiresAt: Date;
}

const INTENT_TTL_MS = 20 * 60 * 1000;

const store = new Map<string, UploadIntent>();

/** Record a new upload intent. Existing entry for the same path is replaced. */
export function recordUploadIntent(
  objectPath: string,
  contentType: string,
  uploaderId: number
): void {
  pruneExpired();
  store.set(objectPath, {
    contentType,
    uploaderId,
    expiresAt: new Date(Date.now() + INTENT_TTL_MS),
  });
}

/**
 * Retrieve and immediately remove the upload intent for `objectPath`.
 * Returns null when no valid (non-expired) record exists.
 * One-shot: the intent is consumed on first retrieval.
 */
export function consumeUploadIntent(objectPath: string): UploadIntent | null {
  const intent = store.get(objectPath);
  store.delete(objectPath);
  if (!intent || intent.expiresAt <= new Date()) {
    return null;
  }
  return intent;
}

function pruneExpired(): void {
  const now = new Date();
  for (const [key, intent] of store) {
    if (intent.expiresAt <= now) {
      store.delete(key);
    }
  }
}
