import { Router } from "express";
import { randomBytes } from "node:crypto";
import { db, whiteLabelTenantsTable, whiteLabelBrandingTable, whiteLabelDomainsTable, whiteLabelMerchantAssignmentsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { normalizeTenantHostname } from "../lib/whiteLabelDomain";
import { checkOwnershipTxt, hashOwnershipToken, ownershipTxtName, ownershipTokenMatches } from "../lib/whiteLabelDns";
import { and } from "drizzle-orm";
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
/** Record a requested domain as pending only; DNS and TLS cannot be enabled here. */
router.post("/:id/domains", async (req, res) => {
  const id = Number(req.params.id);
  const hostname = typeof req.body?.hostname === "string"
    ? normalizeTenantHostname(req.body.hostname) : null;
  if (!Number.isSafeInteger(id) || id < 1 || !hostname ||
      hostname === "rasokart.com" || hostname.endsWith(".rasokart.com")) {
    res.status(400).json({ error: "Invalid or reserved domain" }); return;
  }
  try {
    const [tenant] = await db.select({ id: whiteLabelTenantsTable.id })
      .from(whiteLabelTenantsTable).where(eq(whiteLabelTenantsTable.id, id)).limit(1);
    if (!tenant) { res.status(404).json({ error: "Company not found" }); return; }
    const challenge = `rk-wl-${randomBytes(32).toString("hex")}`;
    const [domain] = await db.insert(whiteLabelDomainsTable).values({
      tenantId: id, hostname, portalKind: "admin", ownershipStatus: "pending",
      tlsStatus: "pending", verificationTokenHash: hashOwnershipToken(challenge),
    }).returning();
    // The secret is delivered once. DNS challenge does not authorize payment activity.
    res.status(201).json({ data: { id: domain!.id, hostname, ownershipStatus: "pending", tlsStatus: "pending" },
      dns: { type: "TXT", name: ownershipTxtName(hostname), value: challenge },
      message: "Add the TXT record, then run verification. SSL and routing remain disabled." });
  } catch (err: any) {
    if (err?.code === "23505") { res.status(409).json({ error: "Domain already registered" }); return; }
    req.log.error({ err }, "white_label_domain_create_failed");
    res.status(503).json({ error: "Domain registration unavailable" });
  }
});
router.get("/:id/domains", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "Invalid tenant id" }); return; }
  try {
    const rows = await db.select({
      id: whiteLabelDomainsTable.id, hostname: whiteLabelDomainsTable.hostname,
      ownershipStatus: whiteLabelDomainsTable.ownershipStatus,
      tlsStatus: whiteLabelDomainsTable.tlsStatus,
    }).from(whiteLabelDomainsTable).where(eq(whiteLabelDomainsTable.tenantId, id));
    res.json({ data: rows });
  } catch (err) {
    req.log.error({ err }, "white_label_domains_list_failed");
    res.status(503).json({ error: "Unable to list domains" });
  }
});
router.post("/:id/domains/:domainId/verify", async (req, res) => {
  const tenantId = Number(req.params.id);
  const domainId = Number(req.params.domainId);
  if (![tenantId, domainId].every(n => Number.isSafeInteger(n) && n > 0)) {
    res.status(400).json({ error: "Invalid domain or tenant" }); return;
  }
  try {
    const [domain] = await db.select().from(whiteLabelDomainsTable)
      .where(and(eq(whiteLabelDomainsTable.id, domainId), eq(whiteLabelDomainsTable.tenantId, tenantId))).limit(1);
    if (!domain) { res.status(404).json({ error: "Domain not found" }); return; }
    if (domain.ownershipStatus === "verified") {
      res.json({ verified: true, tlsStatus: domain.tlsStatus }); return;
    }
    // The challenge is stored hashed. TXT lookup can compare to plaintext only if
    // caller submits the once-shown challenge, which is authenticated and hash-checked.
    const challenge = req.body?.challenge;
    if (typeof challenge !== "string" ||
        !/^rk-wl-[a-f0-9]{64}$/.test(challenge) ||
        !ownershipTokenMatches(challenge, domain.verificationTokenHash)) {
      res.status(400).json({ error: "Invalid verification challenge" }); return;
    }
    const verified = await checkOwnershipTxt(domain.hostname, challenge);
    if (!verified) { res.status(409).json({ verified: false, error: "DNS TXT record not found or mismatched" }); return; }
    await db.update(whiteLabelDomainsTable)
      .set({ ownershipStatus: "verified", verifiedAt: new Date() })
      .where(and(eq(whiteLabelDomainsTable.id, domainId), eq(whiteLabelDomainsTable.tenantId, tenantId),
        eq(whiteLabelDomainsTable.ownershipStatus, "pending")));
    res.json({ verified: true, tlsStatus: "pending", message: "DNS ownership verified; SSL and routing remain disabled." });
  } catch (err) {
    req.log.error({ err }, "white_label_domain_verify_failed");
    res.status(503).json({ error: "DNS verification unavailable" });
  }
});
router.get("/:id/merchant-assignments", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "Invalid tenant id" }); return; }
  try {
    const rows = await db.select({ merchantId: whiteLabelMerchantAssignmentsTable.merchantId })
      .from(whiteLabelMerchantAssignmentsTable)
      .where(eq(whiteLabelMerchantAssignmentsTable.tenantId, id)).limit(100);
    res.json({ data: rows });
  } catch (err) {
    req.log.error({ err }, "white_label_assignments_list_failed");
    res.status(503).json({ error: "Unable to list assignments" });
  }
});
export default router;
