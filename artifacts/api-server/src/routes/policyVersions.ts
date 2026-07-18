import { Router } from "express";
import { db, policyVersionsTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { eq, desc, and } from "drizzle-orm";

const router = Router();

const VALID_SLUGS = [
  "privacy-policy",
  "terms-and-conditions",
  "refund-cancellation-policy",
  "service-delivery-policy",
  "contact-us",
  "grievance-redressal-policy",
  "pricing-fees-settlement-policy",
  "merchant-agreement",
  "prohibited-businesses",
  "kyc-aml-policy",
  "payment-payout-settlement-policy",
  "chargeback-dispute-policy",
  "cookie-policy",
  "security-policy",
  "disclaimer",
];

const VALID_STATUSES = ["draft", "published", "archived"];

// GET /admin/policy-versions — latest published/draft version per slug
router.get("/admin/policy-versions", requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(policyVersionsTable)
      .orderBy(desc(policyVersionsTable.createdAt));

    const bySlug: Record<string, typeof rows> = {};
    for (const row of rows) {
      if (!bySlug[row.slug]) bySlug[row.slug] = [];
      bySlug[row.slug].push(row);
    }

    const summary = VALID_SLUGS.map((slug) => {
      const versions = bySlug[slug] ?? [];
      const published = versions.find((v) => v.status === "published");
      const draft = versions.find((v) => v.status === "draft");
      return {
        slug,
        currentPublished: published ?? null,
        hasDraft: !!draft,
        totalVersions: versions.length,
      };
    });

    return res.json({ data: summary });
  } catch (err) {
    req.log.error({ err }, "policy_versions_list_failed");
    return res.status(500).json({ error: "Failed to list policy versions." });
  }
});

// GET /admin/policy-versions/:slug/history — full version history for one slug
router.get("/admin/policy-versions/:slug/history", requireAuth, requireAdmin, async (req, res) => {
  const slug = req.params["slug"] as string;
  if (!VALID_SLUGS.includes(slug)) {
    return res.status(404).json({ error: "Unknown policy slug." });
  }
  try {
    const rows = await db
      .select()
      .from(policyVersionsTable)
      .where(eq(policyVersionsTable.slug, slug))
      .orderBy(desc(policyVersionsTable.createdAt));
    return res.json({ slug, data: rows });
  } catch (err) {
    req.log.error({ err, slug }, "policy_version_history_failed");
    return res.status(500).json({ error: "Failed to load version history." });
  }
});

// POST /admin/policy-versions — create a new draft version
router.post("/admin/policy-versions", requireAuth, requireAdmin, async (req, res) => {
  const { slug, versionTag, title, effectiveDate, changelogNotes } = req.body ?? {};

  if (!slug || !VALID_SLUGS.includes(slug)) {
    return res.status(400).json({ error: "Invalid or missing policy slug." });
  }
  if (!versionTag || typeof versionTag !== "string" || !/^\d+\.\d+$/.test(versionTag.trim())) {
    return res.status(400).json({ error: "Version must be in format X.Y (e.g. 1.1)." });
  }
  if (!title || typeof title !== "string" || title.trim().length < 2) {
    return res.status(400).json({ error: "Title is required." });
  }
  if (!effectiveDate || typeof effectiveDate !== "string") {
    return res.status(400).json({ error: "Effective date is required." });
  }

  try {
    const existing = await db
      .select({ id: policyVersionsTable.id })
      .from(policyVersionsTable)
      .where(and(eq(policyVersionsTable.slug, slug), eq(policyVersionsTable.status, "draft")));
    if (existing.length > 0) {
      return res.status(409).json({ error: "A draft already exists for this policy. Publish or delete it first." });
    }

    const adminEmail = (req as any).user?.email ?? null;
    const [created] = await db.insert(policyVersionsTable).values({
      slug,
      versionTag: versionTag.trim(),
      title: title.trim(),
      status: "draft",
      effectiveDate: effectiveDate.trim(),
      changelogNotes: typeof changelogNotes === "string" ? changelogNotes.trim() : null,
      updatedByEmail: adminEmail,
    }).returning();

    req.log.info({ slug, versionTag, id: created.id }, "policy_version_draft_created");
    return res.status(201).json({ data: created });
  } catch (err) {
    req.log.error({ err }, "policy_version_create_failed");
    return res.status(500).json({ error: "Failed to create draft." });
  }
});

// PUT /admin/policy-versions/:id/publish — publish a draft
router.put("/admin/policy-versions/:id/publish", requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID." });

  try {
    const [draft] = await db
      .select()
      .from(policyVersionsTable)
      .where(and(eq(policyVersionsTable.id, id), eq(policyVersionsTable.status, "draft")));

    if (!draft) {
      return res.status(404).json({ error: "Draft not found. Only drafts can be published." });
    }

    // Archive current published version for this slug
    await db
      .update(policyVersionsTable)
      .set({ status: "archived" })
      .where(and(eq(policyVersionsTable.slug, draft.slug), eq(policyVersionsTable.status, "published")));

    const adminEmail = (req as any).user?.email ?? null;
    const now = new Date();
    const [published] = await db
      .update(policyVersionsTable)
      .set({ status: "published", publishedAt: now, updatedByEmail: adminEmail })
      .where(eq(policyVersionsTable.id, id))
      .returning();

    req.log.info({ slug: draft.slug, versionTag: draft.versionTag, id }, "policy_version_published");
    return res.json({ data: published });
  } catch (err) {
    req.log.error({ err, id }, "policy_version_publish_failed");
    return res.status(500).json({ error: "Failed to publish version." });
  }
});

// DELETE /admin/policy-versions/:id — delete a draft (only drafts can be deleted)
router.delete("/admin/policy-versions/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID." });

  try {
    const [row] = await db
      .select({ id: policyVersionsTable.id, status: policyVersionsTable.status })
      .from(policyVersionsTable)
      .where(eq(policyVersionsTable.id, id));

    if (!row) return res.status(404).json({ error: "Version not found." });
    if (row.status !== "draft") {
      return res.status(409).json({ error: "Only draft versions can be deleted." });
    }

    await db.delete(policyVersionsTable).where(eq(policyVersionsTable.id, id));
    req.log.info({ id }, "policy_version_draft_deleted");
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err, id }, "policy_version_delete_failed");
    return res.status(500).json({ error: "Failed to delete draft." });
  }
});

export default router;
