import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, auditLogsTable } from "@workspace/db";
import { eq, and, count, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth, requireAdmin);

const formatUser = (u: any) => ({
  id: u.id,
  email: u.email,
  role: u.role,
  name: u.name,
  isActive: u.isActive,
  merchantId: u.merchantId,
  reconciliationAlertEmails: u.reconciliationAlertEmails,
  notifPrefsDisabledAt: u.notifPrefsDisabledAt?.toISOString() ?? null,
  notifReminderSentAt: u.notifReminderSentAt?.toISOString() ?? null,
  createdAt: u.createdAt,
});

async function logAudit(req: any, action: string, targetId: number | null, details: object) {
  await db.insert(auditLogsTable).values({
    adminId: req.user.id, adminEmail: req.user.email, action,
    targetType: "user", targetId, details: JSON.stringify(details), ipAddress: req.ip ?? null,
  });
}

// GET /api/users
router.get("/", async (req, res) => {
  const { role, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (role && role !== "all") conditions.push(eq(usersTable.role, role));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(usersTable).where(where);
  const data = await db.select().from(usersTable).where(where).limit(limitNum).offset(offset).orderBy(sql`${usersTable.createdAt} DESC`);

  res.json({ data: data.map(formatUser), total, page: pageNum, limit: limitNum });
});

// POST /api/users
router.post("/", async (req, res) => {
  const { email, password, name, role } = req.body;
  if (!email || !password || !name || !role) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(usersTable).values({
    email: email.toLowerCase(),
    passwordHash,
    name,
    role,
    isActive: true,
  }).returning();
  await logAudit(req, "user_created", user.id, { email: user.email, name: user.name, role: user.role });
  res.status(201).json(formatUser(user));
});

// PUT /api/users/:id
router.put("/:id", async (req, res) => {
  const id = parseInt(req.params['id'] as string);
  const { name, email, isActive, role } = req.body;

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const updates: any = {};
  if (name !== undefined) updates.name = name;
  if (email !== undefined) updates.email = email.toLowerCase();
  if (isActive !== undefined) updates.isActive = isActive;
  if (role !== undefined) updates.role = role;

  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (role !== undefined && role !== existing.role) {
    await logAudit(req, "user_role_changed", user.id, {
      email: user.email,
      fromRole: existing.role,
      toRole: role,
    });
  }

  res.json(formatUser(user));
});

// DELETE /api/users/:id
router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params['id'] as string);
  const currentUser = (req as any).user;
  if (id === currentUser.id) {
    res.status(400).json({ error: "Cannot delete your own account" });
    return;
  }
  const [user] = await db.delete(usersTable).where(eq(usersTable.id, id)).returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ message: "User deleted" });
});

export default router;
