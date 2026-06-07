import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, merchantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateToken, requireAuth } from "../middlewares/auth";

const router = Router();

// POST /api/auth/login
router.post("/login", async (req, res) => {
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
});

// POST /api/auth/register
router.post("/register", async (req, res) => {
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
  // Create merchant
  const [merchant] = await db.insert(merchantsTable).values({
    businessName,
    contactName,
    email: email.toLowerCase(),
    phone,
    website: website || null,
    status: "pending",
  }).returning();
  // Create user linked to merchant
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
});

// GET /api/auth/me
router.get("/me", requireAuth, async (req, res) => {
  const user = (req as any).user;
  res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    isActive: user.isActive,
    merchantId: user.merchantId,
    createdAt: user.createdAt,
  });
});

// POST /api/auth/logout
router.post("/logout", (_req, res) => {
  res.json({ message: "Logged out successfully" });
});

export default router;
