import { Router, type Request } from "express";
import { db, apiKeysTable, merchantsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { sendApiKeyGeneratedEmail, sendApiKeyRevokedEmail } from "../helpers/apiKeyEmail";

const apiKeyCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  validate: { ip: false },
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req: Request) => String((req as Request & { user?: { merchantId?: number | null; id: number } }).user?.merchantId ?? req.ip),
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

  const [key] = await db.insert(apiKeysTable).values({
    merchantId: user.merchantId!,
    apiKey,
    secretKey,
    keyPrefix,
    isActive: true,
  }).returning();

  res.status(201).json(key);

  // Fire-and-forget security email
  (async () => {
    const [merchant] = await db
      .select({ businessName: merchantsTable.businessName, email: merchantsTable.email })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, user.merchantId!))
      .limit(1);

    if (!merchant?.email) return;

    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
      ?? req.socket.remoteAddress
      ?? "";

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
  res.json({ message: "API key revoked" });

  // Fire-and-forget security email
  (async () => {
    const [merchant] = await db
      .select({ businessName: merchantsTable.businessName, email: merchantsTable.email })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, key.merchantId))
      .limit(1);

    if (!merchant?.email) return;

    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
      ?? req.socket.remoteAddress
      ?? "";

    await sendApiKeyRevokedEmail({
      to: merchant.email,
      businessName: merchant.businessName,
      keyPrefix: key.keyPrefix,
      revokedAt: new Date(),
      ipAddress: ip,
    });
  })().catch((err: unknown) => {
    req.log.warn({ err, keyId: id }, "Failed to send API key revoked email");
  });
});

export default router;
