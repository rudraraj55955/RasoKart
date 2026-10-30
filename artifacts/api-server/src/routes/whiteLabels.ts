import { Router } from "express";
import { db, whiteLabelTenantsTable, whiteLabelBrandingTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireSuperAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth, requireSuperAdmin);

const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Platform Super Admin only. No provider credentials or tenant financial data returned. */
router.get("/", async (req, res) => {
  try {
    const tenants = await db.select({
      id: whiteLabelTenantsTable.id, slug: whiteLabelTenantsTable.slug,
      displayName: whiteLabelTenantsTable.displayName,
      status: whiteLabelTenantsTable.status,
      createdAt: whiteLabelTenantsTable.createdAt,
    }).from(whiteLabelTenantsTable).orderBy(desc(whiteLabelTenantsTable.createdAt)).limit(100);
    res.json({ data: tenants });
  } catch (err) {
    req.log.error({ err }, "white_label_list_failed");
    res.status(503).json({ error: "White-label management unavailable" });
  }
});

router.post("/", async (req, res) => {
  const { slug, displayName, primaryColor } = req.body ?? {};
  if (typeof slug !== "string" || slug.length > 48 || !SLUG.test(slug) ||
      typeof displayName !== "string" || !displayName.trim() || displayName.trim().length > 120 ||
      (primaryColor !== undefined && (typeof primaryColor !== "string" || !HEX.test(primaryColor)))) {
    res.status(400).json({ error: "Invalid company name, slug or color" }); return;
  }
  if (["rasokart", "admin", "superadmin", "api", "merchant", "www", "payoutmerchant"].includes(slug)) {
    res.status(400).json({ error: "Reserved company slug" }); return;
  }
  try {
    const tenant = await db.transaction(async tx => {
      const [created] = await tx.insert(whiteLabelTenantsTable)
        .values({ slug, displayName: displayName.trim(), status: "draft" }).returning();
      if (!created) throw new Error("Unable to create tenant");
      await tx.insert(whiteLabelBrandingTable).values({
        tenantId: created.id, ...(primaryColor ? { primaryColor } : {}),
      });
      return created;
    });
    res.status(201).json({ data: tenant, message: "Draft created; domains and payments are not enabled" });
  } catch (err: any) {
    if (err?.code === "23505") { res.status(409).json({ error: "Slug already exists" }); return; }
    req.log.error({ err }, "white_label_create_failed");
    res.status(503).json({ error: "Unable to create draft white-label company" });
  }
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid tenant id" }); return; }
  try {
    const [tenant] = await db.select().from(whiteLabelTenantsTable)
      .where(eq(whiteLabelTenantsTable.id, id)).limit(1);
    if (!tenant) { res.status(404).json({ error: "Not found" }); return; }
    const [branding] = await db.select().from(whiteLabelBrandingTable)
      .where(eq(whiteLabelBrandingTable.tenantId, id)).limit(1);
    res.json({ data: { ...tenant, branding: branding ?? null } });
  } catch (err) {
    req.log.error({ err }, "white_label_detail_failed");
    res.status(503).json({ error: "White-label management unavailable" });
  }
});
export default router;
