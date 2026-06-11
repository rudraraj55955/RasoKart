import { Router, type Request } from "express";
import { db, apiKeysTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import crypto from "crypto";
import rateLimit from "express-rate-limit";

const apiKeyCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
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
});

// DELETE /api/api-keys/:id
router.delete("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id);
  const conditions = [eq(apiKeysTable.id, id)];
  if (user.role !== "admin") conditions.push(eq(apiKeysTable.merchantId, user.merchantId!));
  const [key] = await db.update(apiKeysTable).set({ isActive: false }).where(and(...conditions)).returning();
  if (!key) {
    res.status(404).json({ error: "API key not found" });
    return;
  }
  res.json({ message: "API key revoked" });
});

export default router;
