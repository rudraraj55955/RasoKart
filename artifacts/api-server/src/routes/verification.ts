import { Router } from "express";
import {
  db,
  merchantVerificationsTable,
  merchantDocumentsTable,
  merchantsTable,
  usersTable,
  auditLogsTable,
  notificationsTable,
} from "@workspace/db";
import { eq, desc, or, ilike, sql, and, count } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { ObjectStorageService } from "../lib/objectStorage";
import { recordUploadIntent } from "../lib/uploadIntentStore";
import { createNotification } from "../helpers/notifications";

const router = Router();
router.use(requireAuth);

const objectStorageService = new ObjectStorageService();

const ALLOWED_UPLOAD_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
]);
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

// ── Masking helpers ───────────────────────────────────────────────────────────

function maskBankAccount(num: string | null): string | null {
  if (!num) return null;
  if (num.length <= 4) return "••••";
  return "••••" + num.slice(-4);
}

function maskPan(pan: string | null): string | null {
  if (!pan) return null;
  if (pan.length < 5) return pan;
  return pan.slice(0, 5) + "•".repeat(Math.max(0, pan.length - 6)) + pan.slice(-1);
}

function maskGst(gst: string | null): string | null {
  if (!gst) return null;
  if (gst.length < 5) return gst;
  return gst.slice(0, 2) + "•".repeat(Math.max(0, gst.length - 5)) + gst.slice(-3);
}

function serializeVerification(v: typeof merchantVerificationsTable.$inferSelect, isAdmin = false) {
  return {
    id: v.id,
    merchantId: v.merchantId,
    status: v.status,
    businessName: v.businessName,
    ownerName: v.ownerName,
    mobile: v.mobile,
    email: v.email,
    pan: isAdmin ? v.pan : maskPan(v.pan),
    gst: isAdmin ? v.gst : maskGst(v.gst),
    businessType: v.businessType,
    websiteUrl: v.websiteUrl,
    address: v.address,
    expectedMonthlyVolume: v.expectedMonthlyVolume,
    useCase: v.useCase,
    bankAccountName: v.bankAccountName,
    bankAccountNumber: isAdmin ? v.bankAccountNumber : maskBankAccount(v.bankAccountNumber),
    ifscCode: v.ifscCode,
    upiId: isAdmin ? v.upiId : (v.upiId ? v.upiId.replace(/^(.{3}).*(@.*)$/, "$1•••••$2") : null),
    adminNote: v.adminNote,
    reviewedBy: v.reviewedBy,
    reviewedAt: v.reviewedAt ? v.reviewedAt.toISOString() : null,
    submittedAt: v.submittedAt ? v.submittedAt.toISOString() : null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

function serializeDocument(d: typeof merchantDocumentsTable.$inferSelect) {
  return {
    id: d.id,
    verificationId: d.verificationId,
    merchantId: d.merchantId,
    docType: d.docType,
    fileUrl: d.fileUrl,
    fileName: d.fileName,
    createdAt: d.createdAt.toISOString(),
  };
}

// ── Merchant routes ───────────────────────────────────────────────────────────

// GET /api/verification — get own verification
router.get("/", async (req, res) => {
  const user = (req as any).user;
  if (!user.merchantId) {
    res.status(403).json({ error: "Not a merchant account" });
    return;
  }
  const [v] = await db
    .select()
    .from(merchantVerificationsTable)
    .where(eq(merchantVerificationsTable.merchantId, user.merchantId))
    .limit(1);
  if (!v) {
    res.json({ verification: null });
    return;
  }
  res.json({ verification: serializeVerification(v) });
});

// POST /api/verification/submit — submit or update KYC application
router.post("/submit", async (req, res) => {
  const user = (req as any).user;
  if (!user.merchantId) {
    res.status(403).json({ error: "Not a merchant account" });
    return;
  }

  const {
    businessName, ownerName, mobile, email, pan, gst, businessType,
    websiteUrl, address, expectedMonthlyVolume, useCase,
    bankAccountName, bankAccountNumber, ifscCode, upiId,
  } = req.body as Record<string, string>;

  // Check existing verification
  const [existing] = await db
    .select()
    .from(merchantVerificationsTable)
    .where(eq(merchantVerificationsTable.merchantId, user.merchantId))
    .limit(1);

  // Only allow resubmit when status is pending/rejected/needs_info
  if (existing && !["pending", "rejected", "needs_info"].includes(existing.status)) {
    res.status(400).json({
      error: `Cannot update verification while status is '${existing.status}'.`,
    });
    return;
  }

  const now = new Date();
  const values = {
    merchantId: user.merchantId,
    status: "pending" as const,
    businessName: businessName ?? null,
    ownerName: ownerName ?? null,
    mobile: mobile ?? null,
    email: email ?? null,
    pan: pan ? pan.toUpperCase().trim() : null,
    gst: gst ? gst.toUpperCase().trim() : null,
    businessType: businessType ?? null,
    websiteUrl: websiteUrl ?? null,
    address: address ?? null,
    expectedMonthlyVolume: expectedMonthlyVolume ?? null,
    useCase: useCase ?? null,
    bankAccountName: bankAccountName ?? null,
    bankAccountNumber: bankAccountNumber ?? null,
    ifscCode: ifscCode ? ifscCode.toUpperCase().trim() : null,
    upiId: upiId ?? null,
    adminNote: null as string | null,
    submittedAt: now,
    reviewedBy: null as number | null,
    reviewedAt: null as Date | null,
  };

  let v: typeof merchantVerificationsTable.$inferSelect;
  if (existing) {
    const [updated] = await db
      .update(merchantVerificationsTable)
      .set({ ...values, updatedAt: now })
      .where(eq(merchantVerificationsTable.id, existing.id))
      .returning();
    v = updated;
  } else {
    const [inserted] = await db
      .insert(merchantVerificationsTable)
      .values(values)
      .returning();
    v = inserted;
  }

  // Update merchant verificationStatus
  await db
    .update(merchantsTable)
    .set({ verificationStatus: "pending" })
    .where(eq(merchantsTable.id, user.merchantId));

  res.json({ verification: serializeVerification(v) });
});

// GET /api/verification/documents — list own documents
router.get("/documents", async (req, res) => {
  const user = (req as any).user;
  if (!user.merchantId) {
    res.status(403).json({ error: "Not a merchant account" });
    return;
  }
  const docs = await db
    .select()
    .from(merchantDocumentsTable)
    .where(eq(merchantDocumentsTable.merchantId, user.merchantId))
    .orderBy(desc(merchantDocumentsTable.createdAt));
  res.json({ documents: docs.map(serializeDocument) });
});

// POST /api/verification/documents/upload-url — get presigned upload URL
router.post("/documents/upload-url", async (req, res) => {
  const user = (req as any).user;
  if (!user.merchantId) {
    res.status(403).json({ error: "Not a merchant account" });
    return;
  }
  const { name, size, contentType } = req.body as {
    name?: string;
    size?: number;
    contentType?: string;
  };
  if (!name || !size || !contentType) {
    res.status(400).json({ error: "name, size, and contentType are required" });
    return;
  }
  if (!ALLOWED_UPLOAD_TYPES.has(contentType)) {
    res.status(400).json({ error: "Only PNG, JPEG, WebP, and PDF files are allowed" });
    return;
  }
  if (size > MAX_UPLOAD_SIZE) {
    res.status(400).json({ error: "File too large. Maximum size is 10 MB" });
    return;
  }
  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    recordUploadIntent(objectPath, contentType, user.id);
    res.json({ uploadURL, objectPath });
  } catch (err) {
    req.log.error({ err }, "Error generating verification upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// POST /api/verification/documents — attach a document to this merchant's verification
router.post("/documents", async (req, res) => {
  const user = (req as any).user;
  if (!user.merchantId) {
    res.status(403).json({ error: "Not a merchant account" });
    return;
  }

  const { docType, fileUrl, fileName } = req.body as {
    docType?: string;
    fileUrl?: string;
    fileName?: string;
  };
  if (!docType || !fileUrl) {
    res.status(400).json({ error: "docType and fileUrl are required" });
    return;
  }

  // Must have a verification application first
  const [v] = await db
    .select()
    .from(merchantVerificationsTable)
    .where(eq(merchantVerificationsTable.merchantId, user.merchantId))
    .limit(1);
  if (!v) {
    res.status(400).json({ error: "Please submit your verification application first" });
    return;
  }

  const [doc] = await db
    .insert(merchantDocumentsTable)
    .values({
      verificationId: v.id,
      merchantId: user.merchantId,
      docType,
      fileUrl,
      fileName: fileName ?? null,
    })
    .returning();

  res.status(201).json({ document: serializeDocument(doc) });
});

// DELETE /api/verification/documents/:id — remove own document
router.delete("/documents/:id", async (req, res) => {
  const user = (req as any).user;
  if (!user.merchantId) {
    res.status(403).json({ error: "Not a merchant account" });
    return;
  }
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid document id" });
    return;
  }
  const [doc] = await db
    .select()
    .from(merchantDocumentsTable)
    .where(
      and(
        eq(merchantDocumentsTable.id, id),
        eq(merchantDocumentsTable.merchantId, user.merchantId),
      )
    )
    .limit(1);
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  await db.delete(merchantDocumentsTable).where(eq(merchantDocumentsTable.id, id));
  res.json({ success: true });
});

// ── Admin routes ──────────────────────────────────────────────────────────────

// GET /api/verification/admin/list — list all verifications
router.get("/admin/list", requireAdmin, async (req, res) => {
  const { status, search, page = "1", limit = "50" } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  const rows = await db
    .select({
      v: merchantVerificationsTable,
      m: {
        id: merchantsTable.id,
        businessName: merchantsTable.businessName,
        email: merchantsTable.email,
        status: merchantsTable.status,
        verificationStatus: merchantsTable.verificationStatus,
      },
    })
    .from(merchantVerificationsTable)
    .innerJoin(merchantsTable, eq(merchantVerificationsTable.merchantId, merchantsTable.id))
    .where(
      and(
        status && status !== "all" ? eq(merchantVerificationsTable.status, status) : undefined,
        search
          ? or(
              ilike(merchantsTable.businessName, `%${search}%`),
              ilike(merchantsTable.email, `%${search}%`),
              ilike(merchantVerificationsTable.ownerName, `%${search}%`),
            )
          : undefined,
      )
    )
    .orderBy(desc(merchantVerificationsTable.updatedAt))
    .limit(limitNum)
    .offset(offset);

  // total count
  const [{ total }] = await db
    .select({ total: count() })
    .from(merchantVerificationsTable)
    .innerJoin(merchantsTable, eq(merchantVerificationsTable.merchantId, merchantsTable.id))
    .where(
      and(
        status && status !== "all" ? eq(merchantVerificationsTable.status, status) : undefined,
        search
          ? or(
              ilike(merchantsTable.businessName, `%${search}%`),
              ilike(merchantsTable.email, `%${search}%`),
            )
          : undefined,
      )
    );

  res.json({
    data: rows.map((r) => ({
      ...serializeVerification(r.v, true),
      merchant: r.m,
    })),
    total,
    page: pageNum,
    limit: limitNum,
  });
});

// GET /api/verification/admin/stats — status counts
router.get("/admin/stats", requireAdmin, async (req, res) => {
  const rows = await db
    .select({
      status: merchantVerificationsTable.status,
      total: count(),
    })
    .from(merchantVerificationsTable)
    .groupBy(merchantVerificationsTable.status);

  const stats: Record<string, number> = {
    pending: 0,
    under_review: 0,
    approved: 0,
    rejected: 0,
    needs_info: 0,
    suspended: 0,
    total: 0,
  };
  for (const r of rows) {
    stats[r.status] = r.total;
    stats.total += r.total;
  }
  res.json({ stats });
});

// GET /api/verification/admin/:merchantId — full details (unmasked)
router.get("/admin/:merchantId", requireAdmin, async (req, res) => {
  const merchantId = parseInt(req.params["merchantId"] as string);
  if (isNaN(merchantId)) {
    res.status(400).json({ error: "Invalid merchantId" });
    return;
  }

  const [v] = await db
    .select()
    .from(merchantVerificationsTable)
    .where(eq(merchantVerificationsTable.merchantId, merchantId))
    .limit(1);
  if (!v) {
    res.status(404).json({ error: "Verification not found" });
    return;
  }

  const docs = await db
    .select()
    .from(merchantDocumentsTable)
    .where(eq(merchantDocumentsTable.merchantId, merchantId))
    .orderBy(desc(merchantDocumentsTable.createdAt));

  res.json({
    verification: serializeVerification(v, true),
    documents: docs.map(serializeDocument),
  });
});

// PUT /api/verification/admin/:merchantId/status — approve/reject/suspend/etc.
router.put("/admin/:merchantId/status", requireAdmin, async (req, res) => {
  const admin = (req as any).user;
  const merchantId = parseInt(req.params["merchantId"] as string);
  if (isNaN(merchantId)) {
    res.status(400).json({ error: "Invalid merchantId" });
    return;
  }

  const { status, adminNote } = req.body as { status?: string; adminNote?: string };
  const VALID = ["pending", "under_review", "approved", "rejected", "needs_info", "suspended"];
  if (!status || !VALID.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${VALID.join(", ")}` });
    return;
  }

  const [v] = await db
    .select()
    .from(merchantVerificationsTable)
    .where(eq(merchantVerificationsTable.merchantId, merchantId))
    .limit(1);
  if (!v) {
    res.status(404).json({ error: "Verification not found" });
    return;
  }

  const now = new Date();
  const [updated] = await db
    .update(merchantVerificationsTable)
    .set({
      status,
      adminNote: adminNote ?? v.adminNote,
      reviewedBy: admin.id,
      reviewedAt: now,
    })
    .where(eq(merchantVerificationsTable.id, v.id))
    .returning();

  // Sync verificationStatus on merchants table
  await db
    .update(merchantsTable)
    .set({ verificationStatus: status })
    .where(eq(merchantsTable.id, merchantId));

  // Audit log
  void db.insert(auditLogsTable).values({
    adminId: admin.id,
    adminEmail: admin.email,
    action: `verification_${status}`,
    targetType: "merchant_verification",
    targetId: merchantId,
    details: JSON.stringify({ merchantId, status, adminNote: adminNote ?? null }),
    ipAddress: req.ip ?? null,
  }).catch(() => {});

  // Notify merchant
  const [merchantUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.merchantId, merchantId))
    .limit(1);

  if (merchantUser) {
    const notifMessages: Record<string, { title: string; body: string }> = {
      approved: {
        title: "KYC Verification Approved",
        body: "Your business verification has been approved! You now have full access to all platform services.",
      },
      rejected: {
        title: "KYC Verification Rejected",
        body: adminNote
          ? `Your verification was rejected: ${adminNote}. Please resubmit with the correct information.`
          : "Your verification was rejected. Please review and resubmit your application.",
      },
      needs_info: {
        title: "Additional Information Required",
        body: adminNote
          ? `We need more information to process your verification: ${adminNote}`
          : "We need additional information to complete your verification. Please update your application.",
      },
      suspended: {
        title: "Account Suspended",
        body: adminNote
          ? `Your account has been suspended: ${adminNote}`
          : "Your account has been suspended. Please contact support for assistance.",
      },
      under_review: {
        title: "Verification Under Review",
        body: "Your verification application is now under review. We will notify you once a decision is made.",
      },
    };
    const msg = notifMessages[status];
    if (msg) {
      void createNotification({
        userId: merchantUser.id,
        type: "kyc_status_updated",
        title: msg.title,
        body: msg.body,
        metadata: { link: "/merchant/verification" },
      }).catch(() => {});
    }
  }

  res.json({ verification: serializeVerification(updated, true) });
});

// GET /api/verification/admin/:merchantId/documents — list documents (admin)
router.get("/admin/:merchantId/documents", requireAdmin, async (req, res) => {
  const merchantId = parseInt(req.params["merchantId"] as string);
  if (isNaN(merchantId)) {
    res.status(400).json({ error: "Invalid merchantId" });
    return;
  }
  const docs = await db
    .select()
    .from(merchantDocumentsTable)
    .where(eq(merchantDocumentsTable.merchantId, merchantId))
    .orderBy(desc(merchantDocumentsTable.createdAt));
  res.json({ documents: docs.map(serializeDocument) });
});

// DELETE /api/verification/admin/:merchantId/documents/:docId — admin delete doc
router.delete("/admin/:merchantId/documents/:docId", requireAdmin, async (req, res) => {
  const docId = parseInt(req.params["docId"] as string);
  if (isNaN(docId)) {
    res.status(400).json({ error: "Invalid docId" });
    return;
  }
  await db.delete(merchantDocumentsTable).where(eq(merchantDocumentsTable.id, docId));
  res.json({ success: true });
});

export default router;
