import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import rateLimit from "express-rate-limit";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { db, uploadedObjectsTable, merchantsTable, providersTable, auditLogsTable, storageCleanupRunsTable } from "@workspace/db";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { recordUploadIntent } from "../lib/uploadIntentStore";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const uploadUrlLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req: Request) => String((req as Request & { user?: { id: number } }).user?.id ?? req.ip),
  message: { error: "Too many upload URL requests. Please try again later." },
});

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/gif",
]);

const MAX_LOGO_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * GET /storage/uploaded-objects
 *
 * Returns the authenticated merchant's upload history, newest-first.
 */
router.get("/storage/uploaded-objects", requireAuth, async (req: Request, res: Response) => {
  const merchantId = (req as Request & { user?: { id: number } }).user?.id ?? 0;
  try {
    const rows = await db
      .select({
        objectPath: uploadedObjectsTable.objectPath,
        contentType: uploadedObjectsTable.contentType,
        contentHash: uploadedObjectsTable.contentHash,
        createdAt: uploadedObjectsTable.createdAt,
      })
      .from(uploadedObjectsTable)
      .where(eq(uploadedObjectsTable.merchantId, merchantId))
      .orderBy(desc(uploadedObjectsTable.createdAt));

    res.json({ data: rows });
  } catch (error) {
    req.log.error({ err: error }, "Error listing uploaded objects");
    res.status(500).json({ error: "Failed to list uploaded objects" });
  }
});

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload. Requires authentication.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", requireAuth, uploadUrlLimiter, async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  const { name, size, contentType, contentHash } = parsed.data;

  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    res.status(400).json({ error: "Only image files are allowed (PNG, JPEG, WebP, SVG, GIF)" });
    return;
  }

  if (size > MAX_LOGO_SIZE_BYTES) {
    res.status(400).json({ error: "File too large. Maximum size is 5 MB" });
    return;
  }

  const uploaderId = (req as Request & { user?: { id: number } }).user?.id ?? 0;

  // Deduplication: if the client provided a content hash, check whether this
  // merchant has already uploaded an identical file. If so, return the existing
  // objectPath without issuing a new presigned URL.
  if (contentHash) {
    try {
      const [existing] = await db
        .select({ objectPath: uploadedObjectsTable.objectPath })
        .from(uploadedObjectsTable)
        .where(
          and(
            eq(uploadedObjectsTable.merchantId, uploaderId),
            eq(uploadedObjectsTable.contentHash, contentHash)
          )
        )
        .limit(1);

      if (existing) {
        res.json(
          RequestUploadUrlResponse.parse({
            objectPath: existing.objectPath,
            deduplicated: true,
            metadata: { name, size, contentType, contentHash },
          })
        );
        return;
      }
    } catch (error) {
      req.log.error({ err: error }, "Error checking upload deduplication");
      res.status(500).json({ error: "Failed to check for duplicate upload" });
      return;
    }
  }

  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    // Record the trusted declared content type keyed by objectPath so that
    // later confirmation calls (e.g. PATCH /merchants/:id/branding) can
    // validate the actual file bytes against what was declared here — without
    // relying on any client-supplied value at confirmation time.
    recordUploadIntent(objectPath, contentType, uploaderId);

    // Always record the presigned upload so the orphan-cleanup job can track
    // every issued URL, not just deduplicated ones.  When contentHash is
    // provided it also enables future deduplication (see check above).
    await db.insert(uploadedObjectsTable).values({
      merchantId: uploaderId,
      contentHash: contentHash ?? null,
      objectPath,
      contentType,
    });

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        deduplicated: false,
        metadata: { name, size, contentType, contentHash },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve merchant logo images uploaded via presigned URLs.
 * Logos are intentionally public — they are displayed on payment pages
 * shown to end customers who are not authenticated RasoKart users.
 * The path is an opaque UUID-based key so enumeration is not a concern.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

/**
 * Normalise any stored logo URL to its canonical `/objects/...` form.
 *
 * Logo URLs can be stored in several formats depending on when and how the
 * upload was saved:
 *   - canonical:  `/objects/uploads/<uuid>`         (object-path form)
 *   - served:     `/api/storage/objects/uploads/<uuid>` (no base prefix)
 *   - absolute:   `https://host/api/storage/objects/uploads/<uuid>`
 *   - external:   any other URL that does not contain `/objects/`
 *
 * Returns the canonical form if the URL references an object-storage path, or
 * `null` if it is an external/unrelated URL.
 */
function normalizeToObjectPath(logoUrl: string): string | null {
  const idx = logoUrl.indexOf("/objects/");
  if (idx === -1) return null;
  // Strip any query string or fragment that could cause comparison mismatches.
  const canonical = logoUrl.slice(idx);
  const qIdx = canonical.search(/[?#]/);
  return qIdx === -1 ? canonical : canonical.slice(0, qIdx);
}

/**
 * POST /storage/cleanup-orphans
 *
 * Admin-only job: finds uploaded_objects rows whose objectPath is not
 * referenced by any merchant's or provider's logoUrl, deletes the GCS
 * object, and removes the DB row.  Safe to run repeatedly.
 *
 * Logo URLs are normalised to canonical `/objects/...` form before comparison
 * so that served-path variants (e.g. `/api/storage/objects/...`) are correctly
 * matched to their uploaded_objects row and never treated as orphans.
 */
router.post("/storage/cleanup-orphans", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const user = (req as Request & { user?: { id: number; email: string } }).user;

  try {
    // Collect every canonical objectPath currently in active use.
    const merchantLogos = await db
      .select({ logoUrl: merchantsTable.logoUrl })
      .from(merchantsTable)
      .where(sql`${merchantsTable.logoUrl} is not null`);

    const providerLogos = await db
      .select({ logoUrl: providersTable.logoUrl })
      .from(providersTable)
      .where(sql`${providersTable.logoUrl} is not null`);

    const usedPaths = new Set<string>(
      [
        ...merchantLogos.map((r) => normalizeToObjectPath(r.logoUrl as string)),
        ...providerLogos.map((r) => normalizeToObjectPath(r.logoUrl as string)),
      ].filter((p): p is string => p !== null)
    );

    // Load all tracked upload rows.
    const allRows = await db
      .select({ id: uploadedObjectsTable.id, objectPath: uploadedObjectsTable.objectPath })
      .from(uploadedObjectsTable);

    // An uploaded_objects row is orphaned when its canonical objectPath
    // appears in no active logo reference.
    const orphans = allRows.filter((r) => !usedPaths.has(r.objectPath));

    let deleted = 0;
    let errors = 0;

    for (const orphan of orphans) {
      try {
        await objectStorageService.deleteObjectEntity(orphan.objectPath);
        await db
          .delete(uploadedObjectsTable)
          .where(eq(uploadedObjectsTable.id, orphan.id));
        deleted++;
      } catch (err) {
        req.log.error({ err, objectPath: orphan.objectPath }, "Failed to delete orphaned storage object");
        errors++;
      }
    }

    const totalScanned = allRows.length;
    const triggeredBy = user?.email ?? "unknown";

    req.log.info(
      { totalScanned, deleted, errors },
      "Storage orphan cleanup completed"
    );

    // Persist run record and audit log (fire-and-forget, don't block response).
    void db.insert(storageCleanupRunsTable).values({
      totalScanned,
      deleted,
      errors,
      triggeredBy,
    }).catch((e) => req.log.error({ err: e }, "Failed to persist storage cleanup run"));

    if (user) {
      void db.insert(auditLogsTable).values({
        adminId: user.id,
        adminEmail: user.email,
        action: "storage_cleanup",
        targetType: "storage",
        targetId: null,
        details: JSON.stringify({ totalScanned, deleted, errors }),
        ipAddress: req.ip ?? null,
      }).catch(() => {});
    }

    res.json({ totalScanned, deleted, errors });
  } catch (err) {
    req.log.error({ err }, "Storage cleanup job failed");
    res.status(500).json({ error: "Storage cleanup failed" });
  }
});

/**
 * GET /storage/cleanup-runs
 *
 * Admin-only: returns the last N storage cleanup run records, newest first.
 */
router.get("/storage/cleanup-runs", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const rawLimit = parseInt(req.query['limit'] as string ?? "20", 10);
    const limit = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 100);

    const runs = await db
      .select()
      .from(storageCleanupRunsTable)
      .orderBy(desc(storageCleanupRunsTable.runAt))
      .limit(limit);

    res.json({ data: runs });
  } catch (err) {
    req.log.error({ err }, "Failed to list storage cleanup runs");
    res.status(500).json({ error: "Failed to list cleanup runs" });
  }
});

export default router;
