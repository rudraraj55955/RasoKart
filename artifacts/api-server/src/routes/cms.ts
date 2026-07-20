import { Router } from "express";
import { db, promotionalCampaignsTable, promotionalAnalyticsTable, auditLogsTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { requireAuth, requireAdmin, requireSuperAdmin } from "../middlewares/auth";

const router = Router();

const VALID_TYPES = ["text_banner", "image_banner", "carousel", "announcement_bar", "countdown", "feature_launch", "merchant_offer", "api_promotion", "security_announcement", "referral_campaign", "full_width"];
const VALID_PLACEMENTS = ["announcement_bar", "hero_bottom", "services_bottom", "features_bottom", "plans_bottom", "settlement_bottom", "api_bottom", "payout_bottom", "trust_bottom", "contact_bottom", "pre_footer"];
const VALID_STATUSES = ["draft", "scheduled", "published", "paused", "expired"];
const VALID_THEMES = ["dark", "light", "gradient", "custom", "cyan", "violet", "emerald", "amber"];
const VALID_ANIMATIONS = ["fade", "slide", "zoom", "none"];
const VALID_DEVICE_TARGETING = ["all", "mobile", "desktop", "tablet"];
const VALID_AUDIENCE = ["all", "logged_out", "merchants"];

function sanitizeCampaign(body: Record<string, unknown>) {
  return {
    internalName: typeof body.internalName === "string" ? body.internalName.slice(0, 200) : undefined,
    publicTitle: typeof body.publicTitle === "string" ? body.publicTitle.slice(0, 200) : null,
    subtitle: typeof body.subtitle === "string" ? body.subtitle.slice(0, 300) : null,
    description: typeof body.description === "string" ? body.description.slice(0, 2000) : null,
    badge: typeof body.badge === "string" ? body.badge.slice(0, 100) : null,
    ctaText: typeof body.ctaText === "string" ? body.ctaText.slice(0, 100) : null,
    ctaUrl: typeof body.ctaUrl === "string" ? body.ctaUrl.slice(0, 500) : null,
    secondaryCtaText: typeof body.secondaryCtaText === "string" ? body.secondaryCtaText.slice(0, 100) : null,
    secondaryCtaUrl: typeof body.secondaryCtaUrl === "string" ? body.secondaryCtaUrl.slice(0, 500) : null,
    desktopImageUrl: typeof body.desktopImageUrl === "string" ? body.desktopImageUrl.slice(0, 1000) : null,
    tabletImageUrl: typeof body.tabletImageUrl === "string" ? body.tabletImageUrl.slice(0, 1000) : null,
    mobileImageUrl: typeof body.mobileImageUrl === "string" ? body.mobileImageUrl.slice(0, 1000) : null,
    videoUrl: typeof body.videoUrl === "string" ? body.videoUrl.slice(0, 1000) : null,
    altText: typeof body.altText === "string" ? body.altText.slice(0, 300) : null,
    type: VALID_TYPES.includes(body.type as string) ? (body.type as string) : "text_banner",
    theme: VALID_THEMES.includes(body.theme as string) ? (body.theme as string) : "dark",
    backgroundColor: typeof body.backgroundColor === "string" ? body.backgroundColor.slice(0, 50) : null,
    gradientFrom: typeof body.gradientFrom === "string" ? body.gradientFrom.slice(0, 50) : null,
    gradientTo: typeof body.gradientTo === "string" ? body.gradientTo.slice(0, 50) : null,
    overlayOpacity: typeof body.overlayOpacity === "number" ? Math.min(100, Math.max(0, body.overlayOpacity)) : 40,
    animation: VALID_ANIMATIONS.includes(body.animation as string) ? (body.animation as string) : "fade",
    placement: VALID_PLACEMENTS.includes(body.placement as string) ? (body.placement as string) : undefined,
    priority: typeof body.priority === "number" ? Math.min(999, Math.max(0, body.priority)) : 0,
    displayOrder: typeof body.displayOrder === "number" ? Math.min(999, Math.max(0, body.displayOrder)) : 0,
    audience: VALID_AUDIENCE.includes(body.audience as string) ? (body.audience as string) : "all",
    deviceTargeting: VALID_DEVICE_TARGETING.includes(body.deviceTargeting as string) ? (body.deviceTargeting as string) : "all",
    language: typeof body.language === "string" ? body.language.slice(0, 10) : "en",
    autoplay: typeof body.autoplay === "boolean" ? body.autoplay : true,
    slideSpeedMs: typeof body.slideSpeedMs === "number" ? Math.min(30000, Math.max(1000, body.slideSpeedMs)) : 5000,
    infiniteLoop: typeof body.infiniteLoop === "boolean" ? body.infiniteLoop : true,
    showNavArrows: typeof body.showNavArrows === "boolean" ? body.showNavArrows : true,
    showDots: typeof body.showDots === "boolean" ? body.showDots : true,
    pauseOnHover: typeof body.pauseOnHover === "boolean" ? body.pauseOnHover : true,
    isSlotEnabled: typeof body.isSlotEnabled === "boolean" ? body.isSlotEnabled : true,
    startAt: body.startAt ? new Date(body.startAt as string) : null,
    endAt: body.endAt ? new Date(body.endAt as string) : null,
    countdownEndAt: body.countdownEndAt ? new Date(body.countdownEndAt as string) : null,
  };
}

// ── Public endpoints (no auth) ────────────────────────────────────────────────

// GET /api/cms/public/banners?placement=hero_bottom
// Returns active campaigns for a given placement (or all active if no placement)
router.get("/public/banners", async (req, res) => {
  const { placement } = req.query as Record<string, string>;
  const now = new Date();

  try {
    const base = and(
      eq(promotionalCampaignsTable.status, "published"),
      eq(promotionalCampaignsTable.isSlotEnabled, true),
    );
    const rows = await db
      .select()
      .from(promotionalCampaignsTable)
      .where(
        placement
          ? and(base, eq(promotionalCampaignsTable.placement, placement))
          : base,
      )
      .orderBy(promotionalCampaignsTable.priority, promotionalCampaignsTable.displayOrder);

    const filtered = rows.filter((r) => {
      if (r.startAt && r.startAt > now) return false;
      if (r.endAt && r.endAt < now) return false;
      return true;
    });

    return res.json({ campaigns: filtered });
  } catch (err) {
    req.log.error({ err }, "cms_public_banners_error");
    return res.status(500).json({ error: "Failed to load banners" });
  }
});

// POST /api/cms/track — track impression or click (no auth required)
router.post("/track", async (req, res) => {
  const { campaignId, eventType, placement, deviceType, sessionId } = req.body as Record<string, unknown>;

  if (!campaignId || !["impression", "click"].includes(eventType as string)) {
    return res.status(400).json({ error: "Invalid tracking event" });
  }

  try {
    await db.insert(promotionalAnalyticsTable).values({
      campaignId: Number(campaignId),
      eventType: eventType as string,
      placement: typeof placement === "string" ? placement : null,
      deviceType: typeof deviceType === "string" ? deviceType : null,
      sessionId: typeof sessionId === "string" ? sessionId : null,
    });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "cms_track_error");
    return res.status(500).json({ error: "Tracking failed" });
  }
});

// ── Admin endpoints (super admin) ────────────────────────────────────────────

// GET /api/cms/campaigns
router.get("/campaigns", requireAuth, requireAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(promotionalCampaignsTable)
      .orderBy(desc(promotionalCampaignsTable.updatedAt));
    return res.json({ campaigns: rows });
  } catch (err) {
    req.log.error({ err }, "cms_list_error");
    return res.status(500).json({ error: "Failed to load campaigns" });
  }
});

// POST /api/cms/campaigns
router.post("/campaigns", requireAuth, requireAdmin, requireSuperAdmin, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const data = sanitizeCampaign(body);

  if (!data.internalName) return res.status(400).json({ error: "internalName is required" });
  if (!data.placement) return res.status(400).json({ error: "placement is required" });

  try {
    const now = new Date();
    const [row] = await db
      .insert(promotionalCampaignsTable)
      .values({
        ...data,
        createdBy: (req as any).user?.id ?? null,
        updatedBy: (req as any).user?.id ?? null,
        createdAt: now,
        updatedAt: now,
      } as any)
      .returning();

    const actor = (req as any).user;
    await db.insert(auditLogsTable).values({
      adminId: actor?.id ?? null,
      adminEmail: actor?.email ?? null,
      action: "cms_campaign_created",
      targetType: "promotional_campaign",
      targetId: row.id,
      details: JSON.stringify({ internalName: row.internalName, placement: row.placement }),
      ipAddress: req.ip ?? null,
    });

    return res.status(201).json({ campaign: row });
  } catch (err) {
    req.log.error({ err }, "cms_create_error");
    return res.status(500).json({ error: "Failed to create campaign" });
  }
});

// GET /api/cms/campaigns/:id
router.get("/campaigns/:id", requireAuth, requireAdmin, requireSuperAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [row] = await db
      .select()
      .from(promotionalCampaignsTable)
      .where(eq(promotionalCampaignsTable.id, id));
    if (!row) return res.status(404).json({ error: "Campaign not found" });
    return res.json({ campaign: row });
  } catch (err) {
    req.log.error({ err }, "cms_get_error");
    return res.status(500).json({ error: "Failed to load campaign" });
  }
});

// PUT /api/cms/campaigns/:id
router.put("/campaigns/:id", requireAuth, requireAdmin, requireSuperAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const body = req.body as Record<string, unknown>;
  const data = sanitizeCampaign(body);

  if (!data.internalName) return res.status(400).json({ error: "internalName is required" });
  if (!data.placement) return res.status(400).json({ error: "placement is required" });

  try {
    const [row] = await db
      .update(promotionalCampaignsTable)
      .set({
        ...data,
        updatedBy: (req as any).user?.id ?? null,
        updatedAt: new Date(),
      } as any)
      .where(eq(promotionalCampaignsTable.id, id))
      .returning();

    if (!row) return res.status(404).json({ error: "Campaign not found" });

    const actor = (req as any).user;
    await db.insert(auditLogsTable).values({
      adminId: actor?.id ?? null,
      adminEmail: actor?.email ?? null,
      action: "cms_campaign_updated",
      targetType: "promotional_campaign",
      targetId: id,
      details: JSON.stringify({ internalName: row.internalName }),
      ipAddress: req.ip ?? null,
    });

    return res.json({ campaign: row });
  } catch (err) {
    req.log.error({ err }, "cms_update_error");
    return res.status(500).json({ error: "Failed to update campaign" });
  }
});

// DELETE /api/cms/campaigns/:id
router.delete("/campaigns/:id", requireAuth, requireAdmin, requireSuperAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [row] = await db
      .delete(promotionalCampaignsTable)
      .where(eq(promotionalCampaignsTable.id, id))
      .returning();

    if (!row) return res.status(404).json({ error: "Campaign not found" });

    const actor = (req as any).user;
    await db.insert(auditLogsTable).values({
      adminId: actor?.id ?? null,
      adminEmail: actor?.email ?? null,
      action: "cms_campaign_deleted",
      targetType: "promotional_campaign",
      targetId: id,
      details: JSON.stringify({ internalName: row.internalName }),
      ipAddress: req.ip ?? null,
    });

    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "cms_delete_error");
    return res.status(500).json({ error: "Failed to delete campaign" });
  }
});

// POST /api/cms/campaigns/:id/duplicate
router.post("/campaigns/:id/duplicate", requireAuth, requireAdmin, requireSuperAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [src] = await db
      .select()
      .from(promotionalCampaignsTable)
      .where(eq(promotionalCampaignsTable.id, id));
    if (!src) return res.status(404).json({ error: "Campaign not found" });

    const now = new Date();
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = src;
    const [copy] = await db
      .insert(promotionalCampaignsTable)
      .values({
        ...rest,
        internalName: `${src.internalName} (Copy)`,
        status: "draft",
        createdBy: (req as any).user?.id ?? null,
        updatedBy: (req as any).user?.id ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const actor = (req as any).user;
    await db.insert(auditLogsTable).values({
      adminId: actor?.id ?? null,
      adminEmail: actor?.email ?? null,
      action: "cms_campaign_duplicated",
      targetType: "promotional_campaign",
      targetId: copy.id,
      details: JSON.stringify({ sourceId: id, internalName: copy.internalName }),
      ipAddress: req.ip ?? null,
    });

    return res.status(201).json({ campaign: copy });
  } catch (err) {
    req.log.error({ err }, "cms_duplicate_error");
    return res.status(500).json({ error: "Failed to duplicate campaign" });
  }
});

// POST /api/cms/campaigns/:id/status
router.post("/campaigns/:id/status", requireAuth, requireAdmin, requireSuperAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { status } = req.body as Record<string, unknown>;
  if (!VALID_STATUSES.includes(status as string)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  try {
    const [row] = await db
      .update(promotionalCampaignsTable)
      .set({ status: status as string, updatedAt: new Date(), updatedBy: (req as any).user?.id ?? null })
      .where(eq(promotionalCampaignsTable.id, id))
      .returning();

    if (!row) return res.status(404).json({ error: "Campaign not found" });

    const actor = (req as any).user;
    await db.insert(auditLogsTable).values({
      adminId: actor?.id ?? null,
      adminEmail: actor?.email ?? null,
      action: `cms_campaign_${status}`,
      targetType: "promotional_campaign",
      targetId: id,
      details: JSON.stringify({ status, internalName: row.internalName }),
      ipAddress: req.ip ?? null,
    });

    return res.json({ campaign: row });
  } catch (err) {
    req.log.error({ err }, "cms_status_error");
    return res.status(500).json({ error: "Failed to update status" });
  }
});

// ── Analytics ─────────────────────────────────────────────────────────────────

// GET /api/cms/analytics
router.get("/analytics", requireAuth, requireAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const stats = await db.execute(sql`
      SELECT
        pa.campaign_id,
        pc.internal_name,
        pc.placement,
        pc.status,
        COUNT(*) FILTER (WHERE pa.event_type = 'impression') AS impressions,
        COUNT(*) FILTER (WHERE pa.event_type = 'click') AS clicks,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE pa.event_type = 'click') /
          NULLIF(COUNT(*) FILTER (WHERE pa.event_type = 'impression'), 0),
          2
        ) AS ctr,
        COUNT(*) FILTER (WHERE pa.device_type = 'mobile') AS mobile_events,
        COUNT(*) FILTER (WHERE pa.device_type = 'desktop') AS desktop_events,
        COUNT(*) FILTER (WHERE pa.device_type = 'tablet') AS tablet_events
      FROM promotional_analytics pa
      JOIN promotional_campaigns pc ON pc.id = pa.campaign_id
      GROUP BY pa.campaign_id, pc.internal_name, pc.placement, pc.status
      ORDER BY impressions DESC
    `);

    const summary = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'published') AS active,
        COUNT(*) FILTER (WHERE status = 'scheduled') AS scheduled,
        COUNT(*) FILTER (WHERE status = 'expired') AS expired,
        COUNT(*) FILTER (WHERE status = 'draft') AS draft,
        COUNT(*) FILTER (WHERE status = 'paused') AS paused
      FROM promotional_campaigns
    `);

    return res.json({ stats: stats.rows, summary: summary.rows[0] });
  } catch (err) {
    req.log.error({ err }, "cms_analytics_error");
    return res.status(500).json({ error: "Failed to load analytics" });
  }
});

// GET /api/cms/analytics/export — CSV
router.get("/analytics/export", requireAuth, requireAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT
        pa.campaign_id,
        pc.internal_name,
        pc.placement,
        pc.status,
        pa.event_type,
        pa.device,
        pa.page,
        pa.created_at
      FROM promotional_analytics pa
      JOIN promotional_campaigns pc ON pc.id = pa.campaign_id
      ORDER BY pa.created_at DESC
      LIMIT 50000
    `);

    const headers = ["campaign_id", "internal_name", "placement", "status", "event_type", "device", "page", "created_at"];
    const csv = [
      headers.join(","),
      ...rows.rows.map((r: any) =>
        headers.map((h) => JSON.stringify(r[h] ?? "")).join(",")
      ),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="cms-analytics-${Date.now()}.csv"`);
    return res.send(csv);
  } catch (err) {
    req.log.error({ err }, "cms_analytics_export_error");
    return res.status(500).json({ error: "Export failed" });
  }
});

export default router;
