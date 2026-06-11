import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { db, usersTable, merchantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateToken, requireAuth } from "../middlewares/auth";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
});

// POST /api/auth/login
router.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Email and password required" });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
    if (!user || !user.isActive) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const token = generateToken({ userId: user.id, role: user.role });
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        isActive: user.isActive,
        merchantId: user.merchantId,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/register
router.post("/register", async (req, res, next) => {
  try {
    const { email, password, businessName, contactName, phone, website } = req.body;
    if (!email || !password || !businessName || !contactName || !phone) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }
    const existing = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
    if (existing.length > 0) {
      res.status(400).json({ error: "Email already registered" });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const [merchant] = await db.insert(merchantsTable).values({
      businessName,
      contactName,
      email: email.toLowerCase(),
      phone,
      website: website || null,
      status: "pending",
    }).returning();
    const [user] = await db.insert(usersTable).values({
      email: email.toLowerCase(),
      passwordHash,
      name: contactName,
      role: "merchant",
      isActive: true,
      merchantId: merchant.id,
    }).returning();
    const token = generateToken({ userId: user.id, role: user.role });
    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        isActive: user.isActive,
        merchantId: user.merchantId,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    let merchantStatus: string | null = null;
    if (user.role === "merchant" && user.merchantId) {
      const [merchant] = await db.select({ status: merchantsTable.status }).from(merchantsTable).where(eq(merchantsTable.id, user.merchantId)).limit(1);
      merchantStatus = merchant?.status ?? null;
    }
    const [row] = await db
      .select({
        reconciliationAlertEmails: usersTable.reconciliationAlertEmails,
        planExpiryAlertEmails: usersTable.planExpiryAlertEmails,
        settlementStateEmails: usersTable.settlementStateEmails,
      })
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .limit(1);
    res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      isActive: user.isActive,
      merchantId: user.merchantId,
      merchantStatus,
      reconciliationAlertEmails: row?.reconciliationAlertEmails ?? true,
      planExpiryAlertEmails: row?.planExpiryAlertEmails ?? true,
      settlementStateEmails: row?.settlementStateEmails ?? true,
      createdAt: user.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/auth/preferences
router.put("/preferences", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { reconciliationAlertEmails, planExpiryAlertEmails, settlementStateEmails } = req.body;

    const patch: Record<string, boolean> = {};

    if (reconciliationAlertEmails !== undefined) {
      if (typeof reconciliationAlertEmails !== "boolean") {
        res.status(400).json({ error: "reconciliationAlertEmails must be a boolean" });
        return;
      }
      patch["reconciliationAlertEmails"] = reconciliationAlertEmails;
    }

    if (planExpiryAlertEmails !== undefined) {
      if (typeof planExpiryAlertEmails !== "boolean") {
        res.status(400).json({ error: "planExpiryAlertEmails must be a boolean" });
        return;
      }
      patch["planExpiryAlertEmails"] = planExpiryAlertEmails;
    }

    if (settlementStateEmails !== undefined) {
      if (typeof settlementStateEmails !== "boolean") {
        res.status(400).json({ error: "settlementStateEmails must be a boolean" });
        return;
      }
      patch["settlementStateEmails"] = settlementStateEmails;
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "No valid preference fields provided" });
      return;
    }

    const [updated] = await db
      .update(usersTable)
      .set(patch)
      .where(eq(usersTable.id, user.id))
      .returning();

    res.json({
      id: updated.id,
      email: updated.email,
      role: updated.role,
      name: updated.name,
      isActive: updated.isActive,
      merchantId: updated.merchantId,
      merchantStatus: null,
      reconciliationAlertEmails: updated.reconciliationAlertEmails,
      planExpiryAlertEmails: updated.planExpiryAlertEmails,
      settlementStateEmails: updated.settlementStateEmails,
      createdAt: updated.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post("/logout", (_req, res) => {
  res.json({ message: "Logged out successfully" });
});

export default router;
