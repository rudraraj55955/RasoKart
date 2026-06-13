import { Router } from "express";
import { db, merchantKycTable, merchantsTable, usersTable } from "@workspace/db";
import { eq, and, count, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { ObjectStorageService } from "../lib/objectStorage";
import { recordUploadIntent, consumeUploadIntent } from "../lib/uploadIntentStore";
import { createNotification } from "../helpers/notifications";
import {
  sendKycDocApprovedEmail,
  sendKycDocRejectedEmail,
  sendKycFullyVerifiedEmail,
} from "../helpers/kycEmail";

const router = Router();
router.use(requireAuth);

const objectStorageService = new ObjectStorageService();

const ALLOWED_KYC_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
]);

const MAX_KYC_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const REQUIRED_DOC_TYPES = ["pan", "gst", "bank_details", "business_proof"];

function serializeKycDoc(doc: typeof merchantKycTable.$inferSelect) {
  return {
    ...doc,
    reviewedAt: doc.reviewedAt ? doc.reviewedAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

// POST /api/kyc/upload-url — request presigned URL for KYC document upload
router.post("/upload-url", async (req, res) => {
  const user = (req as any).user;
  const { name, size, contentType } = req.body as { name?: string; size?: number; contentType?: string };

  if (!name || !size || !contentType) {
    res.status(400).json({ error: "name, size, and contentType are required" });
    return;
  }

  if (!ALLOWED_KYC_TYPES.has(contentType)) {
    res.status(400).json({ error: "Only PNG, JPEG, WebP, and PDF files are allowed for KYC documents" });
    return;
  }

  if (size > MAX_KYC_SIZE_BYTES) {
    res.status(400).json({ error: "File too large. Maximum size is 10 MB" });
    return;
  }

  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    recordUploadIntent(objectPath, contentType, user.id);
    res.json({ uploadURL, objectPath });
  } catch (error) {
    req.log.error({ err: error }, "Error generating KYC upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// GET /api/kyc — list KYC documents (merchant: own; admin: all or by merchantId)
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const { merchantId, status } = req.query as Record<string, string>;

  const conditions = [];

  if (user.role === "merchant") {
    if (!user.merchantId) {
      res.json({ data: [], total: 0 });
      return;
    }
    conditions.push(eq(merchantKycTable.merchantId, user.merchantId));
  } else if (merchantId) {
    conditions.push(eq(merchantKycTable.merchantId, parseInt(merchantId)));
  }

  if (status) conditions.push(eq(merchantKycTable.status, status));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db.select({ total: count() }).from(merchantKycTable).where(where);
  const rows = await db.select().from(merchantKycTable).where(where).orderBy(merchantKycTable.createdAt);

  res.json({ data: rows.map(serializeKycDoc), total });
});

const OBJECT_STORAGE_PATH_PREFIX = "/objects/";

// POST /api/kyc — submit a KYC document
router.post("/", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "merchant" || !user.merchantId) {
    res.status(403).json({ error: "Merchants only" });
    return;
  }

  const { docType, fileUrl, fileName } = req.body as { docType?: string; fileUrl?: string; fileName?: string };

  if (!docType || !fileUrl) {
    res.status(400).json({ error: "docType and fileUrl are required" });
    return;
  }

  const validDocTypes = ["pan", "gst", "bank_details", "business_proof"];
  if (!validDocTypes.includes(docType)) {
    res.status(400).json({ error: `docType must be one of: ${validDocTypes.join(", ")}` });
    return;
  }

  // Validate fileUrl is a trusted object-storage path created via the KYC upload endpoint.
  // Must start with /objects/ (the PRIVATE_OBJECT_DIR prefix) and must have a consumed
  // upload intent recorded by POST /api/kyc/upload-url.
  if (!fileUrl.startsWith(OBJECT_STORAGE_PATH_PREFIX)) {
    res.status(400).json({ error: "Invalid fileUrl: must be an object-storage path returned by the upload endpoint" });
    return;
  }

  const intent = consumeUploadIntent(fileUrl);
  if (!intent) {
    res.status(400).json({ error: "Invalid or expired fileUrl: request a new upload URL and re-upload the file" });
    return;
  }

  if (intent.uploaderId !== user.id) {
    res.status(403).json({ error: "Forbidden: this upload was not issued to your account" });
    return;
  }

  // Check if there's already a pending/approved doc of this type
  const [existing] = await db
    .select()
    .from(merchantKycTable)
    .where(and(
      eq(merchantKycTable.merchantId, user.merchantId),
      eq(merchantKycTable.docType, docType),
      inArray(merchantKycTable.status, ["pending", "approved"])
    ))
    .limit(1);

  if (existing) {
    res.status(409).json({ error: `A ${docType} document is already ${existing.status}. Delete it first to resubmit.` });
    return;
  }

  try {
    const [doc] = await db
      .insert(merchantKycTable)
      .values({
        merchantId: user.merchantId,
        docType,
        fileUrl,
        fileName: fileName ?? null,
        status: "pending",
      })
      .returning();

    res.status(201).json(serializeKycDoc(doc));
  } catch (error) {
    req.log.error({ err: error }, "Error submitting KYC document");
    res.status(500).json({ error: "Failed to submit KYC document" });
  }
});

// DELETE /api/kyc/:id — delete a pending KYC document (merchant: own; admin: any)
router.delete("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);

  const [doc] = await db.select().from(merchantKycTable).where(eq(merchantKycTable.id, id)).limit(1);
  if (!doc) {
    res.status(404).json({ error: "KYC document not found" });
    return;
  }

  if (user.role === "merchant") {
    if (doc.merchantId !== user.merchantId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (doc.status !== "pending") {
      res.status(400).json({ error: "Only pending documents can be deleted" });
      return;
    }
  }

  await db.delete(merchantKycTable).where(eq(merchantKycTable.id, id));
  res.json({ message: "KYC document deleted" });
});

// PATCH /api/kyc/:id/review — approve or reject (admin only)
router.patch("/:id/review", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);
  const { status, adminNote } = req.body as { status?: string; adminNote?: string };

  if (!status || !["approved", "rejected"].includes(status)) {
    res.status(400).json({ error: "status must be 'approved' or 'rejected'" });
    return;
  }

  const [doc] = await db.select().from(merchantKycTable).where(eq(merchantKycTable.id, id)).limit(1);
  if (!doc) {
    res.status(404).json({ error: "KYC document not found" });
    return;
  }

  if (doc.status !== "pending") {
    res.status(400).json({ error: "Only pending documents can be reviewed" });
    return;
  }

  const [updated] = await db
    .update(merchantKycTable)
    .set({
      status,
      adminNote: adminNote ?? null,
      reviewedBy: user.id,
      reviewedAt: new Date(),
    })
    .where(eq(merchantKycTable.id, id))
    .returning();

  // Notify the merchant about the review decision
  const docTypeLabels: Record<string, string> = {
    pan: "PAN Card",
    gst: "GST Certificate",
    bank_details: "Bank Details",
    business_proof: "Business Proof",
  };
  const docLabel = docTypeLabels[doc.docType] ?? doc.docType;

  const [[merchantUser], [merchant]] = await Promise.all([
    db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.merchantId, doc.merchantId))
      .limit(1),
    db
      .select({ email: merchantsTable.email, businessName: merchantsTable.businessName })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, doc.merchantId))
      .limit(1),
  ]);

  if (merchantUser) {
    const isApproved = status === "approved";
    await createNotification({
      userId: merchantUser.id,
      type: isApproved ? "kyc_approved" : "kyc_rejected",
      title: isApproved ? `KYC Document Approved` : `KYC Document Rejected`,
      body: isApproved
        ? `Your ${docLabel} document has been approved.`
        : `Your ${docLabel} document was rejected.${adminNote ? ` Reason: ${adminNote}` : " Please resubmit with the correct document."}`,
      metadata: { kycId: updated.id, docType: doc.docType, docLabel },
    }).catch((err: unknown) => {
      req.log.error({ err }, "Failed to create KYC review notification");
    });
  }

  // Send email notification to merchant
  if (merchant) {
    const { email, businessName } = merchant;
    const isApproved = status === "approved";

    if (isApproved) {
      sendKycDocApprovedEmail({ to: email, businessName, docLabel }).catch((err: unknown) => {
        req.log.error({ err }, "Failed to send KYC approved email");
      });

      // Check if merchant is now fully verified (all required docs approved)
      const remainingDocs = await db
        .select({ docType: merchantKycTable.docType, status: merchantKycTable.status })
        .from(merchantKycTable)
        .where(eq(merchantKycTable.merchantId, doc.merchantId));

      // Include the just-approved doc in our check
      const allDocs = remainingDocs.map(d =>
        d.docType === doc.docType ? { ...d, status: "approved" } : d
      );

      const isFullyVerified = REQUIRED_DOC_TYPES.every(dt =>
        allDocs.some(d => d.docType === dt && d.status === "approved")
      );

      if (isFullyVerified) {
        sendKycFullyVerifiedEmail({ to: email, businessName }).catch((err: unknown) => {
          req.log.error({ err }, "Failed to send KYC fully-verified email");
        });
      }
    } else {
      sendKycDocRejectedEmail({
        to: email,
        businessName,
        docLabel,
        reason: adminNote ?? undefined,
      }).catch((err: unknown) => {
        req.log.error({ err }, "Failed to send KYC rejected email");
      });
    }
  }

  res.json(serializeKycDoc(updated));
});

// GET /api/kyc/summary/:merchantId — KYC summary for a merchant
router.get("/summary/:merchantId", async (req, res) => {
  const user = (req as any).user;
  const merchantId = parseInt(req.params['merchantId'] as string);

  if (user.role === "merchant" && user.merchantId !== merchantId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const docs = await db
    .select()
    .from(merchantKycTable)
    .where(eq(merchantKycTable.merchantId, merchantId));

  const pendingCount = docs.filter(d => d.status === "pending").length;
  const approvedCount = docs.filter(d => d.status === "approved").length;
  const rejectedCount = docs.filter(d => d.status === "rejected").length;

  const submittedDocTypes = [...new Set(docs.map(d => d.docType))];
  const isVerified = REQUIRED_DOC_TYPES.every(dt =>
    docs.some(d => d.docType === dt && d.status === "approved")
  );

  res.json({
    merchantId,
    isVerified,
    totalDocs: docs.length,
    pendingCount,
    approvedCount,
    rejectedCount,
    requiredDocTypes: REQUIRED_DOC_TYPES,
    submittedDocTypes,
  });
});

export default router;
