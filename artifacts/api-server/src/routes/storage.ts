import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import rateLimit from "express-rate-limit";
import { safeIpKey } from "../helpers/makeRateLimiter";
import { and, eq } from "drizzle-orm";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { db, uploadedObjectsTable } from "@workspace/db";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { recordUploadIntent } from "../lib/uploadIntentStore";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const uploadUrlLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  validate: { ip: false },
  keyGenerator: (req: Request) => String((req as Request & { user?: { id: number } }).user?.id ?? safeIpKey(req)),
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

    // Persist the content hash so subsequent uploads of the same file can be
    // deduplicated without issuing a new presigned URL.
    if (contentHash) {
      await db.insert(uploadedObjectsTable).values({
        merchantId: uploaderId,
        contentHash,
        objectPath,
        contentType,
      });
    }

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

export default router;
