import { Router } from "express";
import { db, policyAcceptancesTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { and, eq, desc } from "drizzle-orm";

const router = Router();

const VALID_SLUGS = [
  "terms-and-conditions",
  "privacy-policy",
  "merchant-agreement",
  "refund-cancellation-policy",
  "service-delivery-policy",
  "kyc-aml-policy",
  "payment-payout-settlement-policy",
  "chargeback-dispute-policy",
  "pricing-fees-settlement-policy",
  "prohibited-businesses",
  "cookie-policy",
  "security-policy",
  "disclaimer",
  "grievance-redressal-policy",
];

// POST /policy-acceptance — record a user accepting a policy
router.post("/policy-acceptance", async (req, res) => {
  try {
    const { policySlug, policyVersion, userId, merchantId } = req.body ?? {};

    if (!policySlug || !VALID_SLUGS.includes(policySlug)) {
      return res.status(400).json({ error: "Invalid policy slug." });
    }

    const ipAddress = (req.headers["cf-connecting-ip"] as string) || req.ip || null;
    const userAgent = (req.headers["user-agent"] as string) || null;
    const resolvedVersion = typeof policyVersion === "string" ? policyVersion : "1.0";
    const resolvedUserId = typeof userId === "number" ? userId : null;
    const resolvedMerchantId = typeof merchantId === "number" ? merchantId : null;

    await db.insert(policyAcceptancesTable).values({
      policySlug,
      policyVersion: resolvedVersion,
      userId: resolvedUserId,
      merchantId: resolvedMerchantId,
      ipAddress,
      userAgent,
    });

    req.log.info({ policySlug, resolvedVersion }, "policy_acceptance_recorded");

    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "policy_acceptance_record_failed");
    return res.status(500).json({ error: "Failed to record policy acceptance." });
  }
});

// GET /admin/policy-acceptances — admin view
router.get("/admin/policy-acceptances", requireAuth, requireAdmin, async (req, res) => {
  try {
    const slug = req.query["slug"] as string | undefined;
    const conditions = slug && VALID_SLUGS.includes(slug)
      ? [eq(policyAcceptancesTable.policySlug, slug)]
      : [];

    const rows = await db
      .select()
      .from(policyAcceptancesTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(policyAcceptancesTable.acceptedAt))
      .limit(50);

    return res.json({ data: rows });
  } catch (err) {
    req.log.error({ err }, "admin_policy_acceptances_fetch_failed");
    return res.status(500).json({ error: "Failed to load policy acceptances." });
  }
});

export default router;
