import { Router, type Request } from "express";
import { db, apiKeysTable, merchantsTable, credentialEventsTable, usersTable } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import crypto from "crypto";
import { sendApiKeyGeneratedEmail, sendApiKeyRevokedEmail, maskIp } from "../helpers/apiKeyEmail";
import { makeRateLimiter } from "../helpers/makeRateLimiter";

const apiKeyCreateLimiter = makeRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => (req as Request & { user?: { merchantId?: number | null } }).user?.merchantId,
  message: { error: "Too many API key generation requests. Please try again later." },
});

const router = Router();
router.use(requireAuth);

// GET /api/api-keys
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const merchantId = user.role === "admin" ? undefined : user.merchantId;
  const where = merchantId ? eq(apiKeysTable.merchantId, merchantId) : undefined;
  const keys = await db.select({
    id: apiKeysTable.id,
    merchantId: apiKeysTable.merchantId,
    keyPrefix: apiKeysTable.keyPrefix,
    isActive: apiKeysTable.isActive,
    lastUsedAt: apiKeysTable.lastUsedAt,
    createdAt: apiKeysTable.createdAt,
  }).from(apiKeysTable).where(where);
  res.json(keys);
});

// GET /api/api-keys/history — credential event history from credential_events table
router.get("/history", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "merchant") {
    res.status(403).json({ error: "Merchant access only" });
    return;
  }

  const rows = await db
    .select({
      eventType: credentialEventsTable.eventType,
      keyPrefix: credentialEventsTable.keyPrefix,
      ipAddress: credentialEventsTable.ipAddress,
      actorEmail: credentialEventsTable.actorEmail,
      createdAt: credentialEventsTable.createdAt,
    })
    .from(credentialEventsTable)
    .where(
      and(
        eq(credentialEventsTable.merchantId, user.merchantId),
        inArray(credentialEventsTable.eventType, ["api_key_generated", "api_key_revoked"])
      )
    )
    .orderBy(desc(credentialEventsTable.createdAt));

  const events = rows.map(r => ({
    eventType: r.eventType === "api_key_generated" ? "api_key_created" : "api_key_revoked",
    occurredAt: r.createdAt.toISOString(),
    keyPrefix: r.keyPrefix ?? null,
    description: r.eventType === "api_key_generated"
      ? `API key generated (${r.keyPrefix ?? ""})`
      : `API key revoked (${r.keyPrefix ?? ""})`,
    isRevoked: r.eventType === "api_key_revoked",
    ipAddress: r.ipAddress ? maskIp(r.ipAddress) : null,
    actorEmail: r.actorEmail ?? null,
  }));

  res.json({ data: events });
});

// POST /api/api-keys
router.post("/", apiKeyCreateLimiter, async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "merchant") {
    res.status(403).json({ error: "Only merchants can generate API keys" });
    return;
  }
  const apiKey = `rasokart_live_${crypto.randomBytes(24).toString("hex")}`;
  const secretKey = `rasokart_secret_${crypto.randomBytes(32).toString("hex")}`;
  const keyPrefix = apiKey.slice(0, 20) + "...";

  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    ?? req.socket.remoteAddress
    ?? "";

  const [key] = await db.insert(apiKeysTable).values({
    merchantId: user.merchantId!,
    apiKey,
    secretKey,
    keyPrefix,
    isActive: true,
  }).returning();

  await db.insert(credentialEventsTable).values({
    merchantId: user.merchantId!,
    eventType: "api_key_generated",
    actorId: user.id,
    actorEmail: user.email,
    keyPrefix,
    ipAddress: ip || null,
  });

  res.status(201).json(key);

  // Fire-and-forget security email
  (async () => {
    const [userPrefs] = await db
      .select({ apiKeyGeneratedEmails: usersTable.apiKeyGeneratedEmails })
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .limit(1);

    if (userPrefs?.apiKeyGeneratedEmails === false) return;

    const [merchant] = await db
      .select({ businessName: merchantsTable.businessName, email: merchantsTable.email })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, user.merchantId!))
      .limit(1);

    if (!merchant?.email) return;

    await sendApiKeyGeneratedEmail({
      to: merchant.email,
      businessName: merchant.businessName,
      keyPrefix,
      generatedAt: key!.createdAt ?? new Date(),
      ipAddress: ip,
    });
  })().catch((err: unknown) => {
    req.log.warn({ err, merchantId: user.merchantId }, "Failed to send API key generated email");
  });
});

// DELETE /api/api-keys/:id
router.delete("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);
  const conditions = [eq(apiKeysTable.id, id)];
  if (user.role !== "admin") conditions.push(eq(apiKeysTable.merchantId, user.merchantId!));
  const [key] = await db.update(apiKeysTable).set({ isActive: false, revokedAt: new Date() }).where(and(...conditions)).returning();
  if (!key) {
    res.status(404).json({ error: "API key not found" });
    return;
  }

  const revokeIp = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    ?? req.socket.remoteAddress
    ?? "";

  await db.insert(credentialEventsTable).values({
    merchantId: key.merchantId,
    eventType: "api_key_revoked",
    actorId: user.id,
    actorEmail: user.email,
    keyPrefix: key.keyPrefix,
    ipAddress: revokeIp || null,
  });

  res.json({ message: "API key revoked" });

  // Fire-and-forget security email
  (async () => {
    const [userPrefs] = await db
      .select({ apiKeyRevokedEmails: usersTable.apiKeyRevokedEmails })
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .limit(1);

    if (userPrefs?.apiKeyRevokedEmails === false) return;

    const [merchant] = await db
      .select({ businessName: merchantsTable.businessName, email: merchantsTable.email })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, key.merchantId))
      .limit(1);

    if (!merchant?.email) return;

    await sendApiKeyRevokedEmail({
      to: merchant.email,
      businessName: merchant.businessName,
      keyPrefix: key.keyPrefix,
      revokedAt: new Date(),
      ipAddress: revokeIp,
    });
  })().catch((err: unknown) => {
    req.log.warn({ err, keyId: id }, "Failed to send API key revoked email");
  });
});

export default router;
